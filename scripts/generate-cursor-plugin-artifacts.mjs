#!/usr/bin/env node
/**
 * Generate the Cursor variant of a Lisa plugin from the built Claude artifact.
 *
 * The variant is reshaped to match the official Cursor plugin spec (issue
 * #1055). Rule application was verified empirically by loading the generated
 * `.mdc` at Cursor's canonical `.cursor/rules/` location (NEW `.mdc` = applied,
 * OLD nested `.md` = UNKNOWN, both with 0 tool calls). Note: the
 * `cursor-agent --plugin-dir` headless flag loads a plugin's skills/agents/
 * commands but does NOT inject its `rules/*.mdc` into model context, so it
 * cannot be used to prove rule application — see evidence/cursor-rule-probe-1055.md:
 *
 *   - Manifest: keep `.claude-plugin/plugin.json` — `cursor-agent --plugin-dir`
 *     loads it (CLI scope). The IDE marketplace's `.cursor-plugin/` + a Cursor
 *     `marketplace.json` is a separate, untested follow-up and is NOT emitted here.
 *   - Rules: Cursor discovers `rules/*.mdc` files carrying YAML frontmatter and
 *     ignores plain `.md`. The built Claude artifact ships a nested
 *     `rules/eager/*.md` + `rules/reference/*.md` tree, so the variant flattens it
 *     to top-level `rules/<name>.mdc` (eager → `alwaysApply: true`) and
 *     `rules/<name>-reference.mdc` (reference → `alwaysApply: false`). The
 *     `-reference` suffix avoids a same-path collision: eager and reference share
 *     all base names.
 *   - Hooks: emitted as a Cursor-native `hooks/hooks.json` (flattened schema,
 *     camelCase event names, `${CURSOR_PLUGIN_ROOT}/hooks/` command paths —
 *     plugin hooks run with the project root as cwd, so the plugin-root token is
 *     required, not a bare `./`) — NOT inline in the manifest. `inject-rules.sh`
 *     is dropped because rules now ship as native
 *     `.mdc` (the single delivery path; injecting would double-deliver);
 *     `enforce-team-first.sh` (Claude-team-specific) and the
 *     `entire hooks claude-code *` analytics calls (Claude-only) are dropped too.
 *   - MCP: renamed from `.mcp.json` to `mcp.json` — Cursor auto-discovers the
 *     un-dotted filename.
 *
 * The variant's `hooks/` directory mirrors the surviving script ship-list.
 *
 * Usage: node scripts/generate-cursor-plugin-artifacts.mjs <source-plugin-dir> <out-dir> <version>
 *
 * Where:
 *   source-plugin-dir: path to the built Claude plugin (e.g. plugins/lisa/)
 *   out-dir: path to write the Cursor variant (e.g. plugins/lisa-cursor/)
 *   version: version string injected into the manifest
 *
 * @module scripts/generate-cursor-plugin-artifacts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCursorHooksJson,
  filterScriptsForAgent,
} from "./lib/per-agent-hook-filter.mjs";
import { nestCommandsUnderLisa } from "./lib/nest-plugin-commands.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const POLICY_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "internal-cursor-skill-policy.json"
);

/**
 * Read the per-agent skill policy file. Missing-policy is treated as
 * "ship all skills" (no denylist).
 *
 * @returns {{ denylist?: string[] }}
 */
function readPolicy() {
  if (!fs.existsSync(POLICY_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Recursive directory copy with optional path-level filter.
 *
 * @param {string} src
 * @param {string} dst
 * @param {(relPath: string, stat: fs.Stats) => boolean} keep
 */
function copyDir(src, dst, keep = () => true) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const srcPath = path.join(current, entry.name);
      const relPath = path.join(rel, entry.name);
      const dstPath = path.join(dst, relPath);
      const stat = fs.statSync(srcPath);
      if (!keep(relPath, stat)) continue;
      if (entry.isDirectory()) {
        fs.mkdirSync(dstPath, { recursive: true });
        walk(srcPath, relPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  };
  walk(src, "");
}

/**
 * Titleize a rule slug for a fallback frontmatter description.
 *
 * @param {string} name e.g. "base-rules"
 * @returns {string} e.g. "Base Rules"
 */
function titleizeRuleName(name) {
  return name
    .split("-")
    .map(part => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ")
    .trim();
}

/**
 * Derive a single-line frontmatter description from a rule body.
 *
 * Prefers the first markdown H1 heading; falls back to the titleized slug. The
 * result is always a non-empty single line (Cursor frontmatter `description`).
 *
 * @param {string} body Rule markdown content.
 * @param {string} name Rule slug.
 * @returns {string}
 */
function deriveRuleDescription(body, name) {
  // Strip fenced code blocks first so a `#`-prefixed line inside one (a shell
  // comment, a Markdown example, etc.) is not mistaken for the rule's H1.
  const withoutFences = body.replace(/^(```|~~~).*$[\s\S]*?^\1.*$/gm, "");
  const h1 = /^#\s+(.+?)\s*$/m.exec(withoutFences);
  const text = (h1 ? h1[1] : "").replace(/\s+/g, " ").trim();
  return text || titleizeRuleName(name);
}

/**
 * YAML-quote a description value for `.mdc` frontmatter.
 *
 * @param {string} value
 * @returns {string}
 */
function yamlQuote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Rewrite intra-rule cross-link URLs from the nested `.md` layout to the flat
 * `.mdc` layout so links in flattened rules still resolve.
 *
 * Only the URL inside a Markdown `](...)` link is rewritten — the link TEXT is
 * left untouched (so `[reference/base-rules.md](../reference/base-rules.md)`
 * keeps its readable label while the target becomes `base-rules-reference.mdc`).
 * Two URL shapes are handled:
 *   - tier-prefixed: `(../)?eager/<slug>.md` → `<slug>.mdc`;
 *     `(../)?reference/<slug>.md` → `<slug>-reference.mdc`
 *   - bare same-dir: `<slug>.md` (no slash) → `<slug>.mdc`
 * Optional `#fragment` suffixes are preserved. Constraint: a bare same-dir link
 * is assumed to target the eager / top-level rule of that slug — the real eager
 * bodies always use an explicit `../reference/<name>.md` URL for the reference
 * tier, so bare links never need the `-reference` suffix. URLs with any other
 * shape (deeper paths, external `.md`, http links) are left as-is.
 *
 * @param {string} body Rule markdown content.
 * @returns {string}
 */
function rewriteRuleLinks(body) {
  return body.replace(/\]\(([^)]+)\)/g, (match, url) => {
    const tiered =
      /^(?:\.\.\/)?(eager|reference)\/([A-Za-z0-9._-]+)\.md(#[^)]*)?$/.exec(
        url
      );
    if (tiered) {
      const [, tier, slug, fragment = ""] = tiered;
      const base = tier === "reference" ? `${slug}-reference` : slug;
      return `](${base}.mdc${fragment})`;
    }
    const bare = /^([A-Za-z0-9._-]+)\.md(#[^)]*)?$/.exec(url);
    if (bare) {
      const [, slug, fragment = ""] = bare;
      return `](${slug}.mdc${fragment})`;
    }
    return match;
  });
}

/**
 * Transform the copied nested `rules/` tree into flat Cursor-native
 * `rules/<name>.mdc` files with YAML frontmatter.
 *
 * The base plugin splits rules into `rules/eager/*.md` (always-on) and
 * `rules/reference/*.md` (on-request); stack plugins instead ship a single
 * always-on `rules/<name>.md` at the top level. Both layouts are normalized:
 *   - eager rule → `rules/<name>.mdc` with `alwaysApply: true`
 *   - reference rule → `rules/<name>-reference.mdc` with `alwaysApply: false`
 *     (the `-reference` suffix prevents a same-path collision, since eager and
 *     reference share base names)
 *   - top-level stack rule → `rules/<name>.mdc` with `alwaysApply: true`
 * Plain top-level `.md` rules are rewritten in place to `.mdc`; the nested
 * `rules/eager/` and `rules/reference/` subdirs are removed afterward.
 *
 * @param {string} outDir Cursor variant output directory.
 */
function transformRules(outDir) {
  const rulesDir = path.join(outDir, "rules");
  if (!fs.existsSync(rulesDir)) return;

  /**
   * Write one `.mdc` rule with frontmatter, rewriting intra-rule links.
   *
   * @param {string} srcFile Absolute path of the source `.md` rule.
   * @param {string} slug Output rule slug (filename without extension).
   * @param {boolean} alwaysApply Frontmatter `alwaysApply` value.
   */
  const writeMdc = (srcFile, slug, alwaysApply) => {
    const body = fs.readFileSync(srcFile, "utf8");
    const frontmatter = `---\ndescription: ${yamlQuote(
      deriveRuleDescription(body, slug)
    )}\nalwaysApply: ${alwaysApply}\n---\n\n`;
    fs.writeFileSync(
      path.join(rulesDir, `${slug}.mdc`),
      frontmatter + rewriteRuleLinks(body)
    );
  };

  // Eager / reference subdir layout (base plugin).
  const tiers = [
    { sub: "eager", alwaysApply: true, suffix: "" },
    { sub: "reference", alwaysApply: false, suffix: "-reference" },
  ];
  for (const { sub, alwaysApply, suffix } of tiers) {
    const subDir = path.join(rulesDir, sub);
    if (!fs.existsSync(subDir)) continue;
    for (const entry of fs.readdirSync(subDir)) {
      if (!entry.endsWith(".md")) continue;
      const slug = entry.slice(0, -".md".length);
      writeMdc(path.join(subDir, entry), `${slug}${suffix}`, alwaysApply);
    }
    fs.rmSync(subDir, { recursive: true, force: true });
  }

  // Top-level stack rules (e.g. lisa-rails, lisa-harper-fabric): single
  // always-on `.md` → `.mdc` with alwaysApply:true.
  for (const entry of fs.readdirSync(rulesDir)) {
    if (!entry.endsWith(".md")) continue;
    const srcFile = path.join(rulesDir, entry);
    if (!fs.statSync(srcFile).isFile()) continue;
    writeMdc(srcFile, entry.slice(0, -".md".length), true);
    fs.rmSync(srcFile);
  }
}

/**
 * Rename a copied `.mcp.json` to Cursor's auto-discovered `mcp.json`.
 *
 * @param {string} outDir Cursor variant output directory.
 */
function renameMcpFile(outDir) {
  const dotMcp = path.join(outDir, ".mcp.json");
  if (fs.existsSync(dotMcp)) {
    fs.renameSync(dotMcp, path.join(outDir, "mcp.json"));
  }
}

/**
 * Generate the Cursor variant.
 *
 * @param {string} srcDir Built Claude plugin directory (input).
 * @param {string} outDir Cursor variant output directory.
 * @param {string} version Version string for the manifest.
 */
export function generateCursorVariant(srcDir, outDir, version) {
  if (!fs.existsSync(path.join(srcDir, ".claude-plugin", "plugin.json"))) {
    return; // base plugin has no manifest; nothing to do
  }

  const policy = readPolicy();
  const denylist = new Set(policy.denylist ?? []);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Copy the source plugin, applying the skill denylist filter.
  copyDir(srcDir, outDir, relPath => {
    // Drop the `.codex-plugin/` directory — Cursor does not consume it.
    if (relPath.startsWith(".codex-plugin/") || relPath === ".codex-plugin")
      return false;
    // Drop any source-provided hooks/hooks.json (e.g. a Codex-shaped leak from a
    // regression; the base build emits Codex hooks under .codex-plugin/, stripped
    // above). We emit our OWN Cursor-shaped hooks/hooks.json below from the
    // manifest's hook block, so any copied one would be wrong.
    if (relPath === path.join("hooks", "hooks.json")) return false;
    // Drop Codex-specific per-skill openai.yaml artifacts — Cursor does not use them.
    // These live at skills/<n>/agents/openai.yaml and are generated by the Codex
    // artifact builder; the per-agent variants ship only the SKILL.md.
    if (/^skills\/[^/]+\/agents\/openai\.ya?ml$/.test(relPath)) return false;
    // Apply the per-agent skill denylist (skills/<name>/).
    const skillsPrefix = path.join("skills") + path.sep;
    if (relPath.startsWith(skillsPrefix)) {
      const skillName = relPath.slice(skillsPrefix.length).split(path.sep)[0];
      if (denylist.has(skillName)) return false;
    }
    return true;
  });

  // 1a. Remove any now-empty `skills/<n>/agents/` directories left by the openai.yaml strip.
  const skillsDir = path.join(outDir, "skills");
  if (fs.existsSync(skillsDir)) {
    for (const skillName of fs.readdirSync(skillsDir)) {
      const agentsDir = path.join(skillsDir, skillName, "agents");
      if (fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length === 0) {
        fs.rmdirSync(agentsDir);
      }
    }
  }

  // 1b. Flatten the nested rules/ tree into Cursor-native rules/*.mdc files.
  transformRules(outDir);

  // 1c. Rename .mcp.json → mcp.json (Cursor auto-discovers the un-dotted name).
  renameMcpFile(outDir);

  // 1d. Nest commands under commands/lisa/ — Cursor does not prefix plugin
  // commands with the plugin name, so the directory manufactures the /lisa:*
  // namespace that Claude gets from the plugin name alone.
  nestCommandsUnderLisa(outDir);

  // 2. Read the manifest, stamp the version, and strip the inline hook block.
  // Cursor reads hooks from hooks/hooks.json (emitted in 2a), never inline.
  const manifestPath = path.join(outDir, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  const cursorHooks = buildCursorHooksJson(manifest.hooks ?? {});
  delete manifest.hooks;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  // 2a. Emit hooks/hooks.json in Cursor's native shape when any hooks survive.
  if (cursorHooks) {
    const cursorHooksDir = path.join(outDir, "hooks");
    fs.mkdirSync(cursorHooksDir, { recursive: true });
    fs.writeFileSync(
      path.join(cursorHooksDir, "hooks.json"),
      JSON.stringify(cursorHooks, null, 2) + "\n"
    );
  }

  // 3. Filter the hooks/ directory to match the script ship-list.
  const hooksDir = path.join(outDir, "hooks");
  if (fs.existsSync(hooksDir)) {
    const all = fs
      .readdirSync(hooksDir, { withFileTypes: true })
      .filter(e => e.isFile() && e.name.endsWith(".sh"))
      .map(e => e.name);
    const keep = new Set(filterScriptsForAgent(all, "cursor"));
    for (const name of all) {
      if (!keep.has(name)) fs.rmSync(path.join(hooksDir, name));
    }
    // Remove empty hooks dir.
    if (fs.readdirSync(hooksDir).length === 0) {
      fs.rmdirSync(hooksDir);
    }
  }
}

// CLI entrypoint.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [srcDir, outDir, version] = process.argv.slice(2);
  if (!srcDir || !outDir || !version) {
    console.error(
      "Usage: generate-cursor-plugin-artifacts.mjs <src> <out> <version>"
    );
    process.exit(1);
  }
  generateCursorVariant(srcDir, outDir, version);
  console.log(`Generated Cursor variant at ${outDir} (v${version})`);
}
