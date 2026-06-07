#!/usr/bin/env node
/**
 * Cross-pollinate a host project's locally-authored coding-agent definitions
 * across every agent the project supports.
 *
 * A host project that installs Lisa may hand-author a skill, subagent, rule,
 * command, hook, or MCP entry for ONE coding agent (e.g. a `.claude/skills/foo`
 * that only Claude sees). This engine detects those locally-authored
 * definitions, normalizes each to a canonical intermediate representation (IR),
 * and fans it out to the formats of the OTHER agents declared in the project's
 * `.lisa.config.json` `harness`.
 *
 * Architecture (see the cross-pollinate SKILL.md for the full spec):
 *   any agent's format  ->  Claude-format IR  ->  every other configured agent
 *
 * Claude format is the IR because every existing Lisa generator already sources
 * from it; emitting IR -> {cursor, codex, agy, copilot, opencode} reuses those
 * battle-tested transforms instead of an N x N translator matrix.
 *
 * PROVENANCE is authoritative via a committed lockfile,
 * `.lisa/cross-pollination.lock.json`. Path/location heuristics alone CANNOT
 * distinguish a generated translation from a hand-authored original (both live
 * in the same per-agent directory), so the lockfile is the only reliable way to:
 *   1. prevent loops    — a recorded target is never treated as a source
 *   2. garbage-collect  — an orphaned target (source deleted) is removed
 *   3. protect edits    — a target whose on-disk hash drifts from the recorded
 *                         generated hash was hand-edited; never clobber it
 *   4. stay idempotent  — unchanged source + intact targets => no-op
 *
 * This engine is the deterministic core. It is invoked standalone
 * (`node .../cross-pollinate.mjs <path> [--dry-run] [--json] [--write]`) and by
 * the cross-pollinate skill, which layers in the judgment-heavy translations the
 * engine reports as `pending`.
 *
 * @module cross-pollinate
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const LOCKFILE_REL = path.join(".lisa", "cross-pollination.lock.json");
const LOCK_VERSION = 1;

/**
 * Canonical coding agents Lisa can fan out to. Mirrors `EmitAgent` in
 * src/core/config.ts; kept inline because this engine ships inside the plugin
 * and runs in host projects without the Lisa TypeScript build on the path.
 */
const ALL_AGENTS = ["claude", "codex", "cursor", "agy", "copilot", "opencode"];

/**
 * Resolve the agent set a `harness` value targets. Mirrors
 * `harnessIncludesAgent` in src/core/config.ts (with the `all` -> `fleet`
 * alias already normalized away on the config read path).
 *
 * @param {string} harness Canonical harness string from `.lisa.config.json`.
 * @returns {string[]} Agents the harness includes.
 */
function agentsForHarness(harness) {
  if (harness === "fleet") return [...ALL_AGENTS];
  if (harness === "both") return ["claude", "codex"];
  if (harness === "all") return [...ALL_AGENTS]; // defensive: pre-normalized alias
  return ALL_AGENTS.includes(harness) ? [harness] : ["claude"];
}

/**
 * Per-(agent, primitive) host-project location + format registry.
 *
 * Only entries we can place with confidence are marked `supported: true` and
 * carry a `dir`/`ext`. Entries marked `supported: false` are intentionally NOT
 * guessed — the engine reports detected definitions of that kind as `pending`
 * so the skill (which reads the real on-disk layout) translates them with
 * judgment rather than the engine writing a wrong path. This is deliberate:
 * silently emitting to an unverified location is worse than reporting it.
 *
 * `kind` legend: skill | agent | rule | command | hook | mcp
 */
const HOST_LOCATIONS = {
  skill: {
    // Most agents consume the Claude SKILL.md format directly (OpenCode reads
    // .claude/skills natively; agy/copilot ship SKILL.md verbatim). Codex is
    // the one that needs a derived interface sidecar (agents/openai.yaml).
    claude: { supported: true, dir: ".claude/skills", layout: "skill-dir" },
    codex: { supported: true, dir: ".claude/skills", layout: "codex-sidecar" },
    opencode: {
      supported: true,
      dir: ".claude/skills",
      layout: "native-claude",
    },
    cursor: { supported: false },
    agy: { supported: false },
    copilot: { supported: false },
  },
  mcp: {
    claude: { supported: true, file: ".mcp.json", layout: "json" },
    cursor: { supported: true, file: ".cursor/mcp.json", layout: "json" },
    codex: { supported: false },
    agy: { supported: false },
    copilot: { supported: false },
    opencode: { supported: false },
  },
  rule: {
    // Claude <-> Cursor is the clean, verified pair: a flat per-rule file in
    // both, only the frontmatter + extension differ. codex/agy/opencode deliver
    // project rules by merging into a shared AGENTS.md (section-marker management
    // the engine does not fake) and copilot into .github/copilot-instructions.md
    // — those stay `pending` for the skill to merge with judgment.
    claude: {
      supported: true,
      dir: ".claude/rules",
      ext: ".md",
      layout: "rule-md",
    },
    cursor: {
      supported: true,
      dir: ".cursor/rules",
      ext: ".mdc",
      layout: "rule-mdc",
    },
  },
  // Subagents, commands, hooks: detected by the scanner and reported as
  // `pending` for the skill to translate. Their host locations differ per agent
  // (and some are lossy/unsupported), so the engine does not hardcode them.
  agent: {},
  command: {},
  hook: {},
};

/**
 * Source-detection patterns: where a HUMAN authors each primitive, keyed by the
 * agent whose format it is. The scanner walks these; the lockfile then filters
 * out anything that is actually a generated target (loop prevention).
 *
 * @type {Array<{ kind: string, agent: string, glob: (root: string) => string[] }>}
 */
const SOURCE_SCANNERS = [
  {
    kind: "skill",
    agent: "claude",
    glob: root => listSkillDirs(path.join(root, ".claude/skills")),
  },
  {
    kind: "agent",
    agent: "claude",
    glob: root => listFiles(path.join(root, ".claude/agents"), ".md"),
  },
  {
    kind: "command",
    agent: "claude",
    glob: root => listFiles(path.join(root, ".claude/commands"), ".md", true),
  },
  {
    kind: "rule",
    agent: "claude",
    glob: root => listFiles(path.join(root, ".claude/rules"), ".md", true),
  },
  {
    kind: "rule",
    agent: "cursor",
    glob: root => listFiles(path.join(root, ".cursor/rules"), ".mdc"),
  },
  {
    kind: "mcp",
    agent: "claude",
    glob: root => existing(path.join(root, ".mcp.json")),
  },
  {
    kind: "mcp",
    agent: "cursor",
    glob: root => existing(path.join(root, ".cursor/mcp.json")),
  },
];

/** @returns {string[]} Absolute paths to skill directories (those holding SKILL.md). */
function listSkillDirs(dir) {
  if (!isDir(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "SKILL.md"))
    )
    .map(e => path.join(dir, e.name));
}

/** @returns {string[]} Absolute file paths under `dir` with extension `ext`. */
function listFiles(dir, ext, recursive = false) {
  if (!isDir(dir)) return [];
  const out = [];
  const walk = current => {
    for (const e of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, e.name);
      if (e.isDirectory() && recursive) walk(p);
      else if (e.isFile() && e.name.endsWith(ext)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** @returns {string[]} `[file]` if it exists, else `[]`. */
function existing(file) {
  return fs.existsSync(file) ? [file] : [];
}

/** @returns {boolean} */
function isDir(p) {
  return fs.existsSync(p) && fs.statSync(p).isDirectory();
}

/**
 * Stable content hash for a definition. For a skill DIRECTORY we hash the
 * sorted (relpath, content) pairs of every file so a change anywhere in the
 * skill invalidates it; for a single file we hash its bytes.
 *
 * @param {string} target Absolute path to a file or skill directory.
 * @returns {string} Hex sha256.
 */
function hashDefinition(target) {
  const h = createHash("sha256");
  if (isDir(target)) {
    const files = listFiles(target, "", true).sort();
    for (const f of files) {
      h.update(path.relative(target, f));
      h.update("\0");
      h.update(fs.readFileSync(f));
      h.update("\0");
    }
  } else {
    h.update(fs.readFileSync(target));
  }
  return h.digest("hex");
}

/**
 * Logical identity of a definition, stable across agent formats. Two
 * definitions sharing a logicalId are "the same thing" in different formats —
 * the basis for both linking a source to its targets and detecting a
 * human-authored collision.
 *
 * @param {string} kind
 * @param {string} sourcePath Absolute path to the source definition.
 * @returns {string} e.g. "skill:security-review"
 */
function logicalId(kind, sourcePath) {
  // MCP config is a per-project singleton: `.mcp.json` (Claude) and
  // `.cursor/mcp.json` (Cursor) are the SAME logical thing in different
  // formats, so its identity must not derive from the (differing) filename —
  // otherwise a genuine cross-agent collision reads as two unrelated configs.
  if (kind === "mcp") return "mcp:project";
  const base = isDir(sourcePath)
    ? path.basename(sourcePath)
    : path.basename(sourcePath).replace(/\.[^.]+$/, "");
  return `${kind}:${base}`;
}

/** Read `.lisa.config.json` harness; default "claude". */
function readHarness(root) {
  const p = path.join(root, ".lisa.config.json");
  if (!fs.existsSync(p)) return "claude";
  try {
    const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
    return typeof cfg.harness === "string" ? cfg.harness : "claude";
  } catch {
    return "claude";
  }
}

/** Read the provenance lockfile; returns an empty lock when absent. */
function readLock(root) {
  const p = path.join(root, LOCKFILE_REL);
  if (!fs.existsSync(p)) return { version: LOCK_VERSION, entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    return parsed && typeof parsed === "object" && parsed.entries
      ? parsed
      : { version: LOCK_VERSION, entries: {} };
  } catch {
    return { version: LOCK_VERSION, entries: {} };
  }
}

/** Persist the provenance lockfile (deterministic key ordering). */
function writeLock(root, lock) {
  const p = path.join(root, LOCKFILE_REL);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const ordered = { version: LOCK_VERSION, entries: {} };
  for (const key of Object.keys(lock.entries).sort()) {
    ordered.entries[key] = lock.entries[key];
  }
  fs.writeFileSync(p, JSON.stringify(ordered, null, 2) + "\n");
}

/**
 * The set of absolute paths the lockfile records as GENERATED targets. A path
 * in this set is never treated as a source (loop prevention).
 *
 * @param {object} lock
 * @param {string} root
 * @returns {Set<string>} Absolute target paths.
 */
function generatedTargetPaths(lock, root) {
  const set = new Set();
  for (const entry of Object.values(lock.entries)) {
    for (const t of entry.targets ?? []) {
      set.add(path.resolve(root, t.path));
    }
  }
  return set;
}

/**
 * Plan cross-pollination: scan sources, classify against the lockfile, and
 * compute the actions needed. Pure with respect to the filesystem (reads only).
 *
 * @param {string} root Absolute host-project root.
 * @returns {object} A structured plan (see fields below).
 */
export function plan(root) {
  const harness = readHarness(root);
  const targetAgents = agentsForHarness(harness);
  const lock = readLock(root);
  const generated = generatedTargetPaths(lock, root);

  // Scan every source location, skipping anything the lock says is generated.
  const sources = [];
  const byLogicalId = new Map();
  for (const scanner of SOURCE_SCANNERS) {
    for (const abs of scanner.glob(root)) {
      if (generated.has(path.resolve(abs))) continue; // loop prevention
      const id = logicalId(scanner.kind, abs);
      const src = {
        logicalId: id,
        kind: scanner.kind,
        agent: scanner.agent,
        path: path.relative(root, abs),
        abs,
        hash: hashDefinition(abs),
      };
      sources.push(src);
      const bucket = byLogicalId.get(id) ?? [];
      bucket.push(src);
      byLogicalId.set(id, bucket);
    }
  }

  // Conflicts: same logicalId authored independently in >1 agent (neither is a
  // generated target). Never auto-translate over either — report for a human.
  const conflicts = [];
  for (const [id, bucket] of byLogicalId) {
    if (bucket.length > 1) {
      conflicts.push({
        logicalId: id,
        authoredIn: bucket.map(s => ({ agent: s.agent, path: s.path })),
      });
    }
  }
  const conflictIds = new Set(conflicts.map(c => c.logicalId));

  // For each non-conflicting source, decide which target agents need an emit,
  // and which kinds are pending (no confident host location).
  const emits = [];
  const pending = [];
  for (const src of sources) {
    if (conflictIds.has(src.logicalId)) continue;
    const entry = lock.entries[src.logicalId];
    const sourceChanged = !entry || entry.source?.hash !== src.hash;
    for (const agent of targetAgents) {
      if (agent === src.agent) continue;
      const loc = HOST_LOCATIONS[src.kind]?.[agent];
      if (!loc || !loc.supported) {
        pending.push({
          logicalId: src.logicalId,
          kind: src.kind,
          from: src.agent,
          to: agent,
        });
        continue;
      }
      // The agent consumes the source format natively (e.g. OpenCode reads
      // .claude/skills directly) — there is nothing to emit, and it must NOT be
      // reported as a perpetual "missing" emit. It is inherently satisfied.
      if (loc.layout === "native-claude") continue;
      const recordedTarget = entry?.targets?.find(t => t.agent === agent);
      const targetAbs = recordedTarget
        ? path.resolve(root, recordedTarget.path)
        : null;
      const targetExists = targetAbs ? fs.existsSync(targetAbs) : false;
      const targetDrifted =
        targetExists &&
        recordedTarget &&
        hashDefinition(targetAbs) !== recordedTarget.generatedHash;
      emits.push({
        logicalId: src.logicalId,
        kind: src.kind,
        from: src.agent,
        to: agent,
        sourceAbs: src.abs,
        reason: !targetExists
          ? "missing"
          : sourceChanged
            ? "source-changed"
            : targetDrifted
              ? "drift"
              : "up-to-date",
        drifted: Boolean(targetDrifted),
      });
    }
  }

  // Orphans: lockfile entries whose source no longer exists -> GC their targets.
  const liveIds = new Set(sources.map(s => s.logicalId));
  const orphans = [];
  for (const [id, entry] of Object.entries(lock.entries)) {
    if (!liveIds.has(id)) {
      orphans.push({
        logicalId: id,
        targets: (entry.targets ?? []).map(t => t.path),
      });
    }
  }

  return {
    root,
    harness,
    targetAgents,
    sources,
    emits,
    pending,
    conflicts,
    orphans,
  };
}

/**
 * Execute the deterministic emits a plan calls for (skills + mcp today),
 * skipping `drift` emits (never clobber hand-edited targets), and update the
 * lockfile. Judgment-heavy `pending` kinds are left for the skill.
 *
 * @param {object} p A plan from {@link plan}.
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ written: object[], skippedDrift: object[], gc: string[] }}
 */
export function apply(p, opts = {}) {
  const { root } = p;
  const lock = readLock(root);
  const written = [];
  const skippedDrift = [];
  const gc = [];

  for (const emit of p.emits) {
    if (emit.reason === "up-to-date") continue;
    if (emit.drifted) {
      skippedDrift.push(emit);
      continue;
    }
    const result = emitOne(root, emit, opts);
    if (!result) continue;
    written.push({ ...emit, target: path.relative(root, result.abs) });
    if (!opts.dryRun) recordTarget(lock, root, emit, result);
  }

  // GC orphaned targets.
  for (const orphan of p.orphans) {
    for (const rel of orphan.targets) {
      const abs = path.resolve(root, rel);
      if (fs.existsSync(abs)) {
        gc.push(rel);
        if (!opts.dryRun) fs.rmSync(abs, { recursive: true, force: true });
      }
    }
    if (!opts.dryRun) delete lock.entries[orphan.logicalId];
  }

  if (!opts.dryRun) writeLock(root, lock);
  return { written, skippedDrift, gc };
}

/**
 * Emit a single target. Returns the written target's {abs} or null when the
 * kind has no deterministic emitter (left to the skill).
 *
 * @param {string} root
 * @param {object} emit
 * @param {{ dryRun?: boolean }} opts
 * @returns {{ abs: string } | null}
 */
function emitOne(root, emit, opts) {
  const loc = HOST_LOCATIONS[emit.kind]?.[emit.to];
  if (!loc || !loc.supported) return null;

  if (emit.kind === "skill") return emitSkill(root, emit, loc, opts);
  if (emit.kind === "mcp") return emitMcp(root, emit, loc, opts);
  if (emit.kind === "rule") return emitRule(root, emit, loc, opts);
  return null;
}

/**
 * Emit a rule to a target agent, translating between the Claude `.md` and Cursor
 * `.mdc` flat-file formats.
 *
 * Cursor requires YAML frontmatter (`description` from the first H1, `alwaysApply`)
 * and discovers only `.mdc`; Claude reads plain `.md`. The transform mirrors
 * scripts/generate-cursor-plugin-artifacts.mjs (reimplemented inline because that
 * generator operates on the nested plugin layout and is not importable from the
 * plugin at host runtime).
 *
 * @param {string} root
 * @param {object} emit
 * @param {{ dir: string, ext: string, layout: string }} loc
 * @param {{ dryRun?: boolean }} opts
 * @returns {{ abs: string } | null}
 */
function emitRule(root, emit, loc, opts) {
  const name = path.basename(emit.sourceAbs).replace(/\.(md|mdc)$/, "");
  const outAbs = path.join(root, loc.dir, `${name}${loc.ext}`);
  if (path.resolve(outAbs) === path.resolve(emit.sourceAbs)) return null;

  const raw = fs.readFileSync(emit.sourceAbs, "utf8");
  const body = stripFrontmatter(raw);
  let contents;
  if (loc.layout === "rule-mdc") {
    const fm = `---\ndescription: ${yamlQuote(deriveRuleDescription(body, name))}\nalwaysApply: true\n---\n\n`;
    contents = fm + rewriteRuleLinks(body, ".mdc");
  } else {
    contents = rewriteRuleLinks(body, ".md");
  }
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, contents);
  }
  return { abs: outAbs };
}

/**
 * Emit a skill to a target agent. For native-Claude consumers (opencode) and
 * the canonical Claude dir this is a no-op (they already read the source). For
 * Codex, derive the `agents/openai.yaml` interface sidecar next to the SKILL.md.
 */
function emitSkill(_root, emit, loc, opts) {
  if (loc.layout === "native-claude") return null; // agent reads source as-is

  if (loc.layout === "codex-sidecar") {
    const skillName = path.basename(emit.sourceAbs);
    const skillMd = path.join(emit.sourceAbs, "SKILL.md");
    if (!fs.existsSync(skillMd)) return null;
    const fm = parseFrontmatter(fs.readFileSync(skillMd, "utf8"));
    const outAbs = path.join(emit.sourceAbs, "agents", "openai.yaml");
    const yaml = renderOpenAiInterface(
      fm.name ?? skillName,
      fm.description ?? ""
    );
    if (!opts.dryRun) {
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      fs.writeFileSync(outAbs, yaml);
    }
    return { abs: outAbs };
  }

  return null;
}

/** Emit an MCP config by re-shaping the source JSON to the target agent's file. */
function emitMcp(root, emit, loc, opts) {
  const raw = fs.readFileSync(emit.sourceAbs, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // malformed source; leave to the skill to surface
  }
  const outAbs = path.join(root, loc.file);
  if (path.resolve(outAbs) === path.resolve(emit.sourceAbs)) return null;
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, JSON.stringify(parsed, null, 2) + "\n");
  }
  return { abs: outAbs };
}

/** Record/refresh a target in the lockfile after a successful emit. */
function recordTarget(lock, root, emit, result) {
  const src = {
    agent: emit.from,
    path: path.relative(root, emit.sourceAbs),
    hash: hashDefinition(emit.sourceAbs),
  };
  const entry = lock.entries[emit.logicalId] ?? { source: src, targets: [] };
  entry.source = src;
  const rel = path.relative(root, result.abs);
  const generatedHash = hashDefinition(result.abs);
  const existingIdx = entry.targets.findIndex(t => t.agent === emit.to);
  const record = { agent: emit.to, path: rel, generatedHash };
  if (existingIdx >= 0) entry.targets[existingIdx] = record;
  else entry.targets.push(record);
  entry.targets.sort((a, b) => a.agent.localeCompare(b.agent));
  lock.entries[emit.logicalId] = entry;
}

/** Strip a leading `---`-fenced YAML frontmatter block, returning the body. */
function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/** YAML-quote a description value for `.mdc` frontmatter. */
function yamlQuote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Derive a single-line rule description: the first H1, else a titleized slug.
 * Mirrors generate-cursor-plugin-artifacts.mjs.
 *
 * @param {string} body Rule markdown body (frontmatter already stripped).
 * @param {string} name Rule slug.
 * @returns {string}
 */
function deriveRuleDescription(body, name) {
  const withoutFences = body.replace(/^(```|~~~).*$[\s\S]*?^\1.*$/gm, "");
  const h1 = /^#\s+(.+?)\s*$/m.exec(withoutFences);
  const text = (h1 ? h1[1] : "").replace(/\s+/g, " ").trim();
  if (text) return text;
  return name
    .split("-")
    .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ")
    .trim();
}

/**
 * Rewrite intra-rule markdown link extensions to the target rule format so links
 * still resolve after translation (e.g. `](foo.md)` -> `](foo.mdc)`). Only the
 * URL is touched; the link text is preserved. External/`http` links are left as-is.
 *
 * @param {string} body
 * @param {".md"|".mdc"} targetExt
 * @returns {string}
 */
function rewriteRuleLinks(body, targetExt) {
  const otherExt = targetExt === ".mdc" ? ".md" : ".mdc";
  const re = new RegExp(`\\]\\(([^)]+?)\\${otherExt}(#[^)]*)?\\)`, "g");
  return body.replace(re, (match, base, fragment = "") =>
    /^https?:/.test(base) ? match : `](${base}${targetExt}${fragment})`
  );
}

/** Minimal YAML/Markdown frontmatter parser for `name`/`description`. */
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

/** Render a Codex `openai.yaml` interface from a skill's name/description. */
function renderOpenAiInterface(name, description) {
  const display = name
    .split("-")
    .map(p => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join(" ");
  const short = description.split(/[.!?]/)[0].trim() || display;
  const esc = s => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return (
    `display_name: ${esc(display)}\n` +
    `short_description: ${esc(short)}\n` +
    `default_prompt:\n` +
    `  - ${esc(`Use $${name}: ${short}.`)}\n`
  );
}

/** Render a human-readable report of a plan + apply result. */
export function renderReport(p, result) {
  const lines = [];
  lines.push(
    `Cross-pollination — harness: ${p.harness} -> [${p.targetAgents.join(", ")}]`
  );
  lines.push(`  sources detected: ${p.sources.length}`);
  if (result) {
    lines.push(`  written:          ${result.written.length}`);
    if (result.skippedDrift.length)
      lines.push(`  skipped (edited): ${result.skippedDrift.length}`);
    if (result.gc.length) lines.push(`  garbage-collected:${result.gc.length}`);
  }
  if (p.conflicts.length) {
    lines.push(`  CONFLICTS (authored in >1 agent — not translated):`);
    for (const c of p.conflicts)
      lines.push(
        `    - ${c.logicalId}: ${c.authoredIn.map(a => a.agent).join(" + ")}`
      );
  }
  if (p.pending.length) {
    const byKind = {};
    for (const x of p.pending) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
    lines.push(
      `  PENDING (need skill-driven translation): ${Object.entries(byKind)
        .map(([k, n]) => `${k}×${n}`)
        .join(", ")}`
    );
  }
  return lines.join("\n");
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const root = path.resolve(args.find(a => !a.startsWith("-")) ?? ".");
  const dryRun = args.includes("--dry-run") || !args.includes("--write");
  const asJson = args.includes("--json");
  const p = plan(root);
  const result = apply(p, { dryRun });
  if (asJson) {
    console.log(
      JSON.stringify(
        { plan: p, result, dryRun },
        (k, v) => (k === "abs" ? undefined : v),
        2
      )
    );
  } else {
    console.log(renderReport(p, result));
    if (dryRun)
      console.log("\n(dry-run — pass --write to apply; default is dry-run)");
  }
}
