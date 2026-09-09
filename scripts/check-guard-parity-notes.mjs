#!/usr/bin/env node
/**
 * check-guard-parity-notes — refuse a guard's parity note that claims a port is
 * missing when that port is present in the tree (CodySwannGT/lisa#3908).
 *
 * ## The defect
 *
 * `block-managed-file-edits.sh` carried a note headed "Parity gap, recorded
 * rather than silently dropped" saying the guard had "no Antigravity, Codex or
 * OpenCode port". Two of those three shipped afterwards; the note did not
 * change, because nothing read it. Its neighbour on the very next line — the
 * machine-checked `lisa-guard-capabilities:` declaration — stayed honest over
 * the same period, and the only difference between them is that something
 * reads one of them.
 *
 * A stale gap note is worse than no note, and the reason is the note's own
 * stated purpose: it exists so a reader treats the gap as KNOWN and stops
 * investigating. An overstated one sends that reader looking for three missing
 * ports, they find two present, and they have no way to tell which third is
 * real without redoing the measurement the note was written to spare them.
 *
 * ## What this refuses, and what it deliberately does not
 *
 * A CLAIM is refused when the surface it names has a port. Nothing else about
 * a note is this check's business:
 *
 *   refused    the note says a surface has no port and the port exists. The
 *              note overstates the gap; the tree is the authority.
 *   accepted   the note says a surface has no port and none exists. A genuine
 *              gap stays recordable — that is the whole point of the note, and
 *              a check that demanded its deletion would delete the record
 *              along with the drift.
 *   unread     a guard with no claim at all. Absence of a note is not a
 *              finding: most guards have complete parity and say nothing.
 *
 * ## Surface presence is DERIVED, never declared
 *
 * The one thing that must not be hand-maintained here is the answer, because a
 * second hand-written enumeration of which ports exist would go stale exactly
 * the way the first one did. So presence is resolved from the files: a guard
 * `<id>` has an Antigravity port when `plugins/src/base/hooks/<id>.agy.sh`
 * exists, an OpenCode port when `src/opencode/plugin-templates/lisa-<id>.ts`
 * does, and so on per `SURFACES`. Add a surface to Lisa and the entry added
 * here is a path shape, not a list of which guards have it.
 *
 * ## A path shape alone measures the wrong thing on Codex
 *
 * A file named for the guard is sufficient evidence that a surface carries it;
 * it is not NECESSARY. Codex is the surface where the difference is real, and
 * the first version of this file got Codex wrong for exactly that reason
 * (CodySwannGT/lisa#3750).
 *
 * `src/codex/scripts/<id>.sh` is the retired channel. `src/codex/hooks-installer.ts`
 * says so in its own opening remark — the project overlay moved to
 * plugin-bundled hooks plus one repository-owned dispatcher, and that module
 * "remains for migration coverage of the retired linked script/rule layout".
 * Two channels deliver a guard to Codex today, and neither puts a file in that
 * directory:
 *
 *   - `scripts/lisa-enforcement-fallback.sh`, whose roster names the guards it
 *     dispatches. `src/codex/enforcement-fallback-installer.ts` registers it on
 *     `PreToolUse` for `Bash|Edit|Write|apply_patch`.
 *   - `plugins/lisa/.codex-plugin/hooks.json`, the Codex plugin manifest, whose
 *     hook commands name the guards Codex runs directly.
 *
 * So a `registries` entry is read the same way a `ports` entry is — from the
 * file, never from a declaration — but it answers "does this file REGISTER the
 * guard" rather than "is there a file named for it". Both readers are
 * STRUCTURAL: the roster reader parses the `for guard in ... ; do` list and the
 * manifest reader parses JSON. Neither scans for the guard's name in prose,
 * because the dispatcher's own header lists guard names in a sentence and a
 * substring sweep would count that sentence as registration.
 *
 * ## The claim grammar
 *
 * Bounded on purpose. Inside one comment block, between a negation (`no`,
 * `lacks`, `missing`, `without`) and the word `port`/`ports`, every word must
 * be a surface name or an ordinary connective. Anything else ends the
 * candidate. So this is a claim:
 *
 *     This guard has no Antigravity, Codex or OpenCode port
 *
 * and a sentence that merely mentions a surface and, separately, the word
 * "port" is not. Widening the grammar to catch every phrasing would make the
 * check's own reach unreviewable; narrowing it is why a finding it does report
 * can be trusted without reading the source. What the grammar cannot see is
 * declared in `BLIND_SPOTS` and printed on every run.
 *
 * Determinism: Node built-ins only, no network, no clock, no `Math.random`.
 * The scanned root is a parameter so the suite can point it at a fixture tree
 * holding a known offender.
 *
 * CLI:
 *   node scripts/check-guard-parity-notes.mjs [--json] [root]
 *
 * Exit codes (mirroring the sibling check-* scripts):
 *   0 — guard sources were read and no claim contradicts the tree.
 *   1 — >=1 finding.
 *   2 — operational error: unknown flag, or ZERO guard sources read.
 *
 * @module scripts/check-guard-parity-notes
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * One refused claim.
 * @typedef {object} ParityFinding
 * @property {string} file - Repo-relative path of the note.
 * @property {number} line - One-based line the claim starts on.
 * @property {string} guard - Guard id the note belongs to.
 * @property {string} surface - Surface the note says has no port.
 * @property {string} evidence - Repo-relative path that contradicts the claim.
 * @property {string} claim - The claim as written.
 */

/**
 * A completed sweep.
 * @typedef {object} ParityReport
 * @property {number} files - Guard sources read.
 * @property {number} claims - Parity claims recognised.
 * @property {ParityFinding[]} findings - Claims the tree contradicts.
 */

/**
 * The coding-agent surfaces Lisa supports, and where a port for each lives.
 *
 * `aliases` are the single words a note may use for the surface; `ports` are
 * the candidate paths, any one of which existing means the surface carries the
 * guard. Both are matched case-insensitively on the alias side and exactly on
 * the path side.
 *
 * `registries` are files that REGISTER a guard without being named for it —
 * see the module remark above. Each names a `reader` from
 * {@link REGISTRY_READERS}, which returns the guard ids that file registers.
 */
export const SURFACES = Object.freeze([
  Object.freeze({
    id: "claude",
    aliases: Object.freeze(["claude"]),
    ports: Object.freeze([
      "plugins/src/base/hooks/{id}.sh",
      "plugins/src/base/hooks/{id}.mjs",
    ]),
  }),
  Object.freeze({
    id: "codex",
    aliases: Object.freeze(["codex"]),
    ports: Object.freeze([
      "src/codex/scripts/{id}.sh",
      "src/codex/scripts/{id}.mjs",
    ]),
    registries: Object.freeze([
      Object.freeze({
        path: "scripts/lisa-enforcement-fallback.sh",
        reader: "dispatcher-roster",
      }),
      Object.freeze({
        path: "plugins/lisa/.codex-plugin/hooks.json",
        reader: "codex-hooks-manifest",
      }),
    ]),
  }),
  Object.freeze({
    id: "cursor",
    aliases: Object.freeze(["cursor"]),
    ports: Object.freeze([
      "plugins/lisa-cursor/hooks/{id}.sh",
      "plugins/lisa-cursor/hooks/{id}.mjs",
    ]),
  }),
  Object.freeze({
    id: "opencode",
    aliases: Object.freeze(["opencode"]),
    ports: Object.freeze(["src/opencode/plugin-templates/lisa-{id}.ts"]),
  }),
  Object.freeze({
    id: "antigravity",
    aliases: Object.freeze(["antigravity", "agy"]),
    ports: Object.freeze(["plugins/src/base/hooks/{id}.agy.sh"]),
  }),
  Object.freeze({
    id: "copilot",
    aliases: Object.freeze(["copilot"]),
    ports: Object.freeze([
      "plugins/lisa-copilot/hooks/{id}.sh",
      "plugins/lisa-copilot/hooks/{id}.mjs",
    ]),
  }),
]);

/**
 * Directories holding guard SOURCES.
 *
 * Generated copies — the per-plugin `hooks/` roots and the shipped host guard
 * directory — are excluded on purpose. They inherit their note verbatim from a
 * source read here, so scanning them would report the same drift five more
 * times and make the finding count meaningless.
 */
export const SCANNED_DIRS = Object.freeze([
  "plugins/src/base/hooks",
  "src/codex/scripts",
  "src/opencode/plugin-templates",
]);

/** What this sweep does not look at, printed on every run. */
export const BLIND_SPOTS = Object.freeze([
  "generated copies of a guard — they inherit the source note scanned here",
  "gaps stated outside the claim grammar (see the module remarks)",
  "understated gaps: a note that omits a genuinely missing surface passes",
  "whether a present port file is actually registered for its agent",
  "a delivery channel absent from SURFACES — presence is only as complete as the ports and registries named there",
]);

/** File extensions a guard source may use. */
const GUARD_EXTENSIONS = Object.freeze([".sh", ".mjs", ".ts", ".py"]);

/** Runs of whitespace, for splitting a roster or a command line. */
const WHITESPACE = /\s+/u;

/** The shape every guard id has; anything else is not one. */
const GUARD_ID_SHAPE = /^[a-z0-9][a-z0-9-]*$/u;

/** Shell words in the dispatcher roster that are syntax, not guard names. */
const ROSTER_KEYWORDS = new Set(["", "\\", "do", "for", "guard", "in"]);

/** Words that open a claim. */
const NEGATIONS = new Set(["no", "lacks", "lack", "missing", "without"]);

/** Words that close a claim. */
const CLAIM_TARGETS = new Set(["port", "ports"]);

/**
 * Words permitted between the negation and the target.
 *
 * Connectives and the nouns a parity sentence uses about itself. Anything
 * outside this set ends the candidate, which is what keeps the grammar from
 * spanning an unrelated clause.
 */
const FILLER = new Set([
  "a",
  "an",
  "and",
  "any",
  "code",
  "dedicated",
  "guard",
  "has",
  "have",
  "hook",
  "hooks",
  "its",
  "native",
  "neither",
  "no",
  "nor",
  "of",
  "or",
  "own",
  "separate",
  "still",
  "the",
  "this",
  "yet",
]);

/** Characters that end a candidate claim outright. */
const TERMINATORS = new Set([".", ";", ":", "—", "–", "(", ")", "`", '"']);

/** Words and terminators, in order, with their offsets. */
const TOKEN_PATTERN = /[A-Za-z][A-Za-z-]*|[.;:—–()`"]/gu;

/** Surface id for each alias a note may write. */
const SURFACE_BY_ALIAS = new Map(
  SURFACES.flatMap(surface => surface.aliases.map(alias => [alias, surface.id]))
);

/**
 * The guard a source file belongs to.
 *
 * Every surface spells the same guard differently — an Antigravity sibling
 * carries `.agy` before its extension, an OpenCode template carries a `lisa-`
 * prefix — so the id is what lets one note be checked against every surface.
 * @param {string} relative - Repo-relative path, forward-slashed.
 * @returns {string | undefined} The guard id, or nothing for a non-guard file.
 */
export function guardIdFor(relative) {
  const base = path.posix.basename(relative);
  const extension = GUARD_EXTENSIONS.find(candidate =>
    base.endsWith(candidate)
  );
  if (!extension) return undefined;
  const stem = base.slice(0, -extension.length);
  const undotted = stem.endsWith(".agy") ? stem.slice(0, -".agy".length) : stem;
  if (path.posix.dirname(relative) !== "src/opencode/plugin-templates") {
    return undotted;
  }
  return undotted.startsWith("lisa-")
    ? undotted.slice("lisa-".length)
    : undefined;
}

/**
 * The port file that proves a surface carries a guard.
 * @param {string} repoRoot - Absolute path of the tree being scanned.
 * @param {string} guardId - Guard id from {@link guardIdFor}.
 * @param {string} surfaceId - Surface id from {@link SURFACES}.
 * @returns {string | undefined} Repo-relative path, or nothing if absent.
 */
export function portFor(repoRoot, guardId, surfaceId) {
  const surface = SURFACES.find(candidate => candidate.id === surfaceId);
  if (!surface) return undefined;
  return surface.ports
    .map(template => template.replace("{id}", guardId))
    .find(relative => existsSync(path.join(repoRoot, relative)));
}

/**
 * Guard ids the enforcement dispatcher runs.
 *
 * Read from the `for guard in ... ; do` roster and from nowhere else. The
 * dispatcher's header also lists guard names in an English sentence, so a
 * substring sweep of this file would report every guard it MENTIONS as one it
 * RUNS — the sentinel-versus-talk-about-the-sentinel mistake, and the reason
 * this reader is a parse rather than a search.
 * @param {string} source - Full contents of the dispatcher.
 * @returns {Set<string>} Guard ids in the roster; empty when there is none.
 */
export function dispatcherRoster(source) {
  const names = new Set();
  const lines = source.split("\n");
  let index = lines.findIndex(line =>
    line.trimStart().startsWith("for guard in")
  );
  if (index === -1) return names;
  let roster = "";
  let open = true;
  while (open && index < lines.length) {
    const line = lines[index];
    roster += ` ${line}`;
    open = !line.includes("; do");
    index += 1;
  }
  // Still open at end of file means the roster was never terminated, which is
  // a malformed dispatcher rather than an empty one. Report nothing: a partial
  // parse that answered anyway would claim registration it had not read.
  if (open) return new Set();
  for (const raw of roster.split(WHITESPACE)) {
    const word = raw.endsWith(";") ? raw.slice(0, -1) : raw;
    if (ROSTER_KEYWORDS.has(word) || !GUARD_ID_SHAPE.test(word)) continue;
    names.add(word);
  }
  return names;
}

/**
 * Guard ids the Codex plugin manifest registers.
 *
 * Structural: the JSON is parsed and every hook `command` is reduced to the
 * basename of the file it runs. A command carrying arguments (`… --hook`)
 * still resolves to its script, and anything unparseable registers nothing.
 * @param {string} source - Full contents of the manifest.
 * @returns {Set<string>} Guard ids the manifest registers.
 */
export function codexHooksManifest(source) {
  const names = new Set();
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    // probe-direction: fail-closed — an unreadable manifest registers nothing,
    // so a genuine gap note keeps passing rather than being refused on the
    // strength of a file this reader could not read.
    return names;
  }
  const events = parsed?.hooks;
  if (events === null || typeof events !== "object") return names;
  for (const entries of Object.values(events)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const hook of Array.isArray(entry?.hooks) ? entry.hooks : []) {
        const id = guardIdOfCommand(hook?.command);
        if (id !== undefined) names.add(id);
      }
    }
  }
  return names;
}

/**
 * The guard a hook command runs.
 * @param {unknown} command - A manifest hook's `command` field.
 * @returns {string | undefined} The guard id, or nothing.
 */
function guardIdOfCommand(command) {
  if (typeof command !== "string") return undefined;
  const [word] = command.split(WHITESPACE);
  const base = word.slice(word.lastIndexOf("/") + 1);
  const extension = GUARD_EXTENSIONS.find(candidate =>
    base.endsWith(candidate)
  );
  if (extension === undefined) return undefined;
  const stem = base.slice(0, -extension.length);
  return GUARD_ID_SHAPE.test(stem) ? stem : undefined;
}

/** How each `registries` entry's `reader` is resolved. */
export const REGISTRY_READERS = Object.freeze({
  "codex-hooks-manifest": codexHooksManifest,
  "dispatcher-roster": dispatcherRoster,
});

/**
 * The registration file that proves a surface RUNS a guard.
 * @param {string} repoRoot - Absolute path of the tree being scanned.
 * @param {string} guardId - Guard id from {@link guardIdFor}.
 * @param {string} surfaceId - Surface id from {@link SURFACES}.
 * @returns {string | undefined} Repo-relative path, or nothing if none does.
 */
export function registryFor(repoRoot, guardId, surfaceId) {
  const surface = SURFACES.find(candidate => candidate.id === surfaceId);
  for (const registry of surface?.registries ?? []) {
    const absolute = path.join(repoRoot, registry.path);
    if (!existsSync(absolute)) continue;
    const read = REGISTRY_READERS[registry.reader];
    if (read !== undefined && read(readFileSync(absolute, "utf8")).has(guardId))
      return registry.path;
  }
  return undefined;
}

/**
 * The file that contradicts a claim of no port on one surface.
 *
 * A port file OR a registration; either is proof the surface carries the
 * guard, and a note claiming otherwise is refused on whichever is found.
 * @param {string} repoRoot - Absolute path of the tree being scanned.
 * @param {string} guardId - Guard id from {@link guardIdFor}.
 * @param {string} surfaceId - Surface id from {@link SURFACES}.
 * @returns {string | undefined} Repo-relative path, or nothing.
 */
export function evidenceFor(repoRoot, guardId, surfaceId) {
  return (
    portFor(repoRoot, guardId, surfaceId) ??
    registryFor(repoRoot, guardId, surfaceId)
  );
}

/**
 * Consecutive comment lines, joined into blocks.
 *
 * Only comments are read. A guard's body is code, and a string literal in it
 * that happens to read like a parity note is not one.
 * Each block records where every contributing line begins inside the joined
 * text, so a claim can be reported at the line it is written on rather than at
 * the top of a header that may be seventy lines above it.
 * @param {string} source - Full file contents.
 * @returns {{ line: number, text: string, spans: { at: number, line: number }[] }[]}
 *   Blocks, in file order.
 */
export function commentBlocks(source) {
  const blocks = [];
  source.split("\n").forEach((raw, index) => {
    const stripped = commentTextOf(raw);
    if (stripped === undefined) {
      blocks.push(undefined);
      return;
    }
    const previous = blocks.at(-1);
    if (previous === undefined) {
      blocks.push({
        line: index + 1,
        text: stripped,
        spans: [{ at: 0, line: index + 1 }],
      });
      return;
    }
    blocks[blocks.length - 1] = {
      line: previous.line,
      text: `${previous.text} ${stripped}`,
      spans: [
        ...previous.spans,
        { at: previous.text.length + 1, line: index + 1 },
      ],
    };
  });
  return blocks.filter(block => block !== undefined);
}

/**
 * The source line an offset inside a block's joined text came from.
 * @param {{ spans: { at: number, line: number }[], line: number }} block - Block.
 * @param {number} offset - Character offset within the block's joined text.
 * @returns {number} One-based source line.
 */
export function lineAt(block, offset) {
  return (
    block.spans.filter(span => span.at <= offset).at(-1)?.line ?? block.line
  );
}

/**
 * A comment line's text, with its marker removed.
 * @param {string} raw - One line of source.
 * @returns {string | undefined} The text, or nothing when it is not a comment.
 */
function commentTextOf(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("#!")) return undefined;
  const marker = ["#", "//", "*/", "/**", "/*", "*"].find(candidate =>
    trimmed.startsWith(candidate)
  );
  return marker === undefined ? undefined : trimmed.slice(marker.length).trim();
}

/**
 * How a claim candidate advances over one token.
 * @param {{ open: boolean, offset: number, named: string[] }} state - Progress.
 * @param {{ text: string, index: number }} token - Word or terminator.
 * @returns {{ state: object, surfaces: string[] | undefined, offset: number }}
 *   The next state, plus the surfaces of a claim that just closed.
 */
function advance(state, token) {
  const closed = { open: false, offset: 0, named: [] };
  const word = token.text.toLowerCase();
  if (TERMINATORS.has(token.text)) return { state: closed };
  if (!state.open) {
    return NEGATIONS.has(word)
      ? { state: { open: true, offset: token.index, named: [] } }
      : { state: closed };
  }
  if (CLAIM_TARGETS.has(word)) {
    const surfaces =
      state.named.length > 0 ? [...new Set(state.named)] : undefined;
    return { state: closed, surfaces, offset: state.offset };
  }
  const surface = SURFACE_BY_ALIAS.get(word);
  if (surface) {
    return { state: { ...state, named: [...state.named, surface] } };
  }
  return FILLER.has(word) ? { state } : { state: closed };
}

/**
 * The parity claims one comment block makes.
 * @param {string} text - The block's joined text.
 * @returns {{ offset: number, surfaces: string[], text: string }[]} Claims.
 */
export function claimsIn(text) {
  const claims = [];
  let state = { open: false, offset: 0, named: [] };
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const step = advance(state, { text: match[0], index: match.index });
    state = step.state;
    if (!step.surfaces) continue;
    claims.push({
      offset: step.offset,
      surfaces: step.surfaces,
      text: text.slice(step.offset, match.index + match[0].length),
    });
  }
  return claims;
}

/**
 * Guard source files under one directory of a tree.
 * @param {string} repoRoot - Absolute path of the tree being scanned.
 * @param {string} directory - Repo-relative directory to read.
 * @returns {{ relative: string, guardId: string }[]} Guard sources found.
 */
function guardsUnder(repoRoot, directory) {
  const absolute = path.join(repoRoot, directory);
  try {
    if (!statSync(absolute).isDirectory()) return [];
  } catch {
    // probe-direction: fail-closed — an unreadable directory contributes no
    // files, so the zero-sources exit-2 rule fires rather than a clean tick.
    return [];
  }
  return readdirSync(absolute, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => ({
      relative: `${directory}/${entry.name}`,
      guardId: guardIdFor(`${directory}/${entry.name}`),
    }))
    .filter(guard => guard.guardId !== undefined);
}

/**
 * Read every guard source and refuse the claims the tree contradicts.
 * @param {string} repoRoot - Absolute path of the tree to scan.
 * @param {readonly string[]} [directories] - Repo-relative dirs to read.
 * @returns {ParityReport} The completed sweep.
 */
export function sweep(repoRoot, directories = SCANNED_DIRS) {
  const report = { files: 0, claims: 0, findings: [] };
  const guards = directories.flatMap(directory =>
    guardsUnder(repoRoot, directory)
  );
  for (const guard of guards) {
    report.files += 1;
    const source = readFileSync(path.join(repoRoot, guard.relative), "utf8");
    for (const block of commentBlocks(source)) {
      inspectBlock(repoRoot, guard, block, report);
    }
  }
  report.findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.surface.localeCompare(right.surface)
  );
  return report;
}

/**
 * Refuse the claims one comment block makes that the tree contradicts.
 * @param {string} repoRoot - Absolute path of the tree being scanned.
 * @param {{ relative: string, guardId: string }} guard - The guard source.
 * @param {{ line: number, text: string }} block - One comment block.
 * @param {ParityReport} report - Accumulating report, mutated in place.
 * @returns {void}
 */
function inspectBlock(repoRoot, guard, block, report) {
  for (const claim of claimsIn(block.text)) {
    report.claims += 1;
    for (const surface of claim.surfaces) {
      const evidence = evidenceFor(repoRoot, guard.guardId, surface);
      if (!evidence) continue;
      report.findings.push({
        file: guard.relative,
        line: lineAt(block, claim.offset),
        guard: guard.guardId,
        surface,
        evidence,
        claim: claim.text,
      });
    }
  }
}

/**
 * Render the human-readable report.
 * @param {ParityReport} report - Result.
 * @returns {string} The report text.
 */
export function formatReport(report) {
  const lines = [
    `check:guard-parity-notes — read ${report.files} guard source(s) and recognised ${report.claims} parity claim(s).`,
    "  Not audited by this sweep:",
    ...BLIND_SPOTS.map(spot => `    · ${spot}`),
  ];
  if (report.files === 0) {
    lines.push(
      "  ✖ ZERO guard sources read. A sweep that read nothing cannot report a clean tree; treating this as a failure, not an all-clear."
    );
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(
      `  ✖ ${finding.file}:${finding.line} — ${finding.guard} claims no ${finding.surface} port`,
      `      "${finding.claim}"`,
      `      contradicted by ${finding.evidence}`
    );
  }
  if (report.findings.length === 0) {
    lines.push(
      "  ✔ Every parity note that records a missing port names a surface the tree agrees is missing."
    );
    return lines.join("\n");
  }
  lines.push(
    "",
    "Fix: correct the note to name only the surfaces that are genuinely absent, and delete it outright once none are.",
    "The tree is the authority — a note is a reader's shortcut, and a shortcut that points the wrong way costs more than no shortcut at all."
  );
  return lines.join("\n");
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const args = process.argv.slice(2);
  const unknown = args.find(arg => arg.startsWith("--") && arg !== "--json");
  if (unknown) {
    console.error(`check:guard-parity-notes: unknown flag ${unknown}`);
    process.exitCode = 2;
    return;
  }
  const json = args.includes("--json");
  const repoRoot = path.resolve(args.find(arg => !arg.startsWith("--")) ?? ".");
  const report = sweep(repoRoot);
  console.log(
    json
      ? JSON.stringify({ ...report, blindSpots: BLIND_SPOTS }, null, 2)
      : formatReport(report)
  );
  if (report.files === 0) process.exitCode = 2;
  else if (report.findings.length > 0) process.exitCode = 1;
}

if (invokedAsScript(import.meta.url)) {
  main();
}
