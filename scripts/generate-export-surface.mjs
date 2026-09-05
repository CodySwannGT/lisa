#!/usr/bin/env node
/**
 * Record the public export surface this package ships, so a removal is an
 * observation rather than an inference.
 *
 * ## The defect this exists against
 *
 * A release shipped a changelog declaring ZERO breaking changes across a range
 * whose diff had removed a public export. The changelog was accurate about its
 * own contents and useless as a safety signal: a downstream reader did the
 * right check, carefully, with a positive control, and got a confident wrong
 * answer. Two consumer repositories were about to upgrade on the strength of it
 * (CodySwannGT/lisa#3718).
 *
 * The mechanism is that the attestation is **derived from something adjacent**.
 * "No breaking changes" is computed from commit-message conventions — whether
 * anyone wrote `!` or a `BREAKING CHANGE:` footer — and a template rewrite that
 * drops an exported symbol carries neither. So the claim is about what authors
 * typed, and it is read as a claim about what happened to the exported surface.
 *
 * A claim and an observation are different things. `"no breaking changes"` is a
 * claim. `"these names were exported before and are exported now"` is an
 * observation, and it is the one a consumer actually needs.
 *
 * ## Why the surface is recorded rather than computed at release time
 *
 * A committed artifact makes the removal **visible in the pull request that
 * causes it**, not only in the release notes afterwards. The diff is the signal.
 * It also means the comparison is a pure git operation with no network — which
 * matters, because the release path already depends on registry availability
 * that has failed under us.
 *
 * ## What it covers, and what it does not
 *
 * The shipped `.mjs` scripts under the `files` allowlist. That is deliberately
 * where the incident happened: a `copy-overwrite` template is installed into a
 * consumer's own `scripts/` directory, and the consumer's repo-owned code
 * imports from it. Those files are invisible to an import graph on either side
 * — Lisa cannot see the consumer's importer, and the consumer has no dependency
 * to declare — so the exported names are the only shared contract there is.
 *
 * It reads exports **statically**, by their declaration form. It does not
 * execute the modules, and it therefore cannot see a name attached at runtime.
 * That limit is deliberate: importing 130 shipped scripts to enumerate them
 * would run their top-level code during a build.
 * @module scripts/generate-export-surface
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Directories inside the `files` allowlist that ship executable `.mjs`. */
const SHIPPED_ROOTS = [
  "all",
  "typescript",
  "rails",
  "expo",
  "nestjs",
  "cdk",
  "phaser",
  "harper-fabric",
  "scripts",
  "npm-package",
];

/**
 * Where the recorded surface lives.
 *
 * JSON rather than a TypeScript module, and the reason is the diff. One
 * exported name per line is what makes a removal show up as a DELETED line in
 * the pull request that causes it — which is the entire point of recording the
 * surface. At 974 names that is well past the 300-line ceiling `max-lines`
 * applies to source, and the sibling generated artifacts buy their way past it
 * with a file-wide `eslint-disable`. Data does not need to be source: as JSON
 * the artifact keeps the per-name diff, needs no waiver, and its reader becomes
 * `JSON.parse` instead of a hand-rolled line parser that could silently
 * disagree with the renderer.
 */
const ARTIFACT = "src/core/export-surface.json";

/**
 * Declaration forms that introduce a named export.
 *
 * Anchored at line start, because an `export` inside a string or a comment is
 * not a declaration and counting it would make the artifact disagree with the
 * module. The corpus was surveyed before this list was written: 613 `function`,
 * 306 `const`, 38 `async function`, 14 `class`, 4 brace-lists.
 */
const DECLARATION =
  /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;

/** `export { a, b as c }` — the re-export form. */
const BRACE_LIST = /^export\s*\{([^}]*)\}/;

/**
 * Every tracked, shipped `.mjs` path.
 * @param {string} cwd Repository root.
 * @returns {string[]} Repo-relative paths, sorted.
 */
export function shippedScripts(cwd = process.cwd()) {
  const listed = execFileSync("git", ["ls-files"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).split("\n");
  return listed
    .filter(file => file.endsWith(".mjs"))
    .filter(file => SHIPPED_ROOTS.includes(file.split("/")[0]))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * The names one module exports.
 *
 * `export default` is deliberately excluded: it has no name to compare, so
 * recording it would add a row that can never change meaningfully.
 * @param {string} source Module source.
 * @returns {string[]} Exported names, sorted and deduplicated.
 */
export function exportedNames(source) {
  const names = new Set();
  for (const line of source.split("\n")) {
    const declared = DECLARATION.exec(line);
    if (declared) {
      names.add(declared[1]);
      continue;
    }
    const braced = BRACE_LIST.exec(line);
    if (!braced) continue;
    for (const clause of braced[1].split(",")) {
      // `a as b` exports b; the local name is not part of the surface.
      const parts = clause.trim().split(/\s+as\s+/);
      const exported = (parts.at(-1) ?? "").trim();
      if (exported && exported !== "default") names.add(exported);
    }
  }
  return [...names].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}

/**
 * The surface as it stands in the working tree.
 * @param {string} cwd Repository root.
 * @returns {Record<string, string[]>} Path to exported names.
 */
export function currentSurface(cwd = process.cwd()) {
  const surface = {};
  for (const file of shippedScripts(cwd)) {
    const names = exportedNames(readFileSync(path.join(cwd, file), "utf8"));
    if (names.length > 0) surface[file] = names;
  }
  return surface;
}

/**
 * Render the artifact.
 * @param {Record<string, string[]>} surface The recorded surface.
 * @returns {string} Artifact JSON, newline-terminated.
 */
export function renderArtifact(surface) {
  const total = Object.values(surface).reduce(
    (sum, names) => sum + names.length,
    0
  );
  return `${JSON.stringify(
    {
      $generatedBy: "scripts/generate-export-surface.mjs",
      $doNotEdit:
        "The public export surface this package ships, recorded so a removal is an OBSERVATION rather than an inference from commit-message conventions. This file's diff is what makes a removed export visible in the pull request that causes it (CodySwannGT/lisa#3718).",
      $modules: Object.keys(surface).length,
      $names: total,
      surface,
    },
    null,
    2
  )}\n`;
}

/**
 * Read the recorded surface out of an artifact's source.
 *
 * Parsed from text rather than imported, so the same reader works on a
 * `git show` of an older revision — which is what comparing against a previous
 * release requires.
 * @param {string} source Artifact source.
 * @returns {Record<string, string[]>} Path to exported names.
 */
export function parseArtifact(source) {
  const parsed = JSON.parse(source);
  return parsed.surface ?? {};
}

/**
 * Names present in `before` and absent from `after`.
 * @param {Record<string, string[]>} before Earlier surface.
 * @param {Record<string, string[]>} after Later surface.
 * @returns {Array<{file: string, name: string}>} Removals, sorted.
 */
export function removedExports(before, after) {
  const gone = [];
  for (const [file, names] of Object.entries(before)) {
    const kept = new Set(after[file] ?? []);
    for (const name of names) if (!kept.has(name)) gone.push({ file, name });
  }
  return gone.sort((left, right) =>
    left.file === right.file
      ? left.name < right.name
        ? -1
        : 1
      : left.file < right.file
        ? -1
        : 1
  );
}

/**
 * The changelog section a release carries when it removes exports.
 *
 * Emits nothing when nothing was removed — a release that removed no export
 * should not carry a paragraph saying so, or the section becomes noise that
 * readers learn to skip, which is the failure this whole file exists against.
 * @param {Array<{file: string, name: string}>} removals From {@link removedExports}.
 * @returns {string} Markdown, or an empty string.
 */
export function changelogSection(removals) {
  if (removals.length === 0) return "";
  const rows = removals
    .map(({ file, name }) => `- \`${name}\` — was exported by \`${file}\``)
    .join("\n");
  return `### ⚠ Removed public exports\n\n${String(removals.length)} exported name(s) present in the previous release are absent from this one. A consumer importing any of them will break on upgrade.\n\n${rows}\n`;
}

/**
 * Read the artifact as it stood at a git revision.
 * @param {string} ref Git revision.
 * @param {string} cwd Repository root.
 * @returns {Record<string, string[]>|null} The surface, or null when absent.
 */
function surfaceAt(ref, cwd) {
  try {
    const source = execFileSync("git", ["show", `${ref}:${ARTIFACT}`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseArtifact(source);
  } catch {
    // The artifact did not exist at that revision. That is not "no exports
    // were removed" — it is "no comparison is possible", and the two must not
    // render the same, so the caller is told rather than shown an empty list.
    //
    // probe-direction: fail-closed — `main` renders this null as exit 2 and
    // says so in words, which any caller treating non-zero as a block reads
    // as a refusal. An unreadable revision costs a false block, never a
    // release that reports zero removals because it could not look.
    return null;
  }
}

/**
 * CLI.
 * @returns {number} Exit code.
 */
function main() {
  const cwd = process.cwd();
  const argv = process.argv.slice(2);
  const since = argv.includes("--removed-since")
    ? argv[argv.indexOf("--removed-since") + 1]
    : null;

  if (since) {
    const before = surfaceAt(since, cwd);
    if (before === null) {
      // Exit 2, not 0. "I could not compare" and "nothing was removed" are
      // opposite facts, and this whole file exists because a release reported
      // the second while meaning something closer to the first. A caller that
      // treats any non-zero as a block gets the safe reading by default; one
      // that wants to allow the very first release — before any surface has
      // been recorded — can distinguish 2 from 1 deliberately.
      process.stdout.write(
        `No export surface recorded at ${since}; nothing to compare. This is NOT a clean result — it is an unanswered question.\n`
      );
      return 2;
    }
    const removals = removedExports(before, currentSurface(cwd));
    const section = changelogSection(removals);
    process.stdout.write(
      section === ""
        ? `No public exports removed since ${since}. ${String(Object.values(before).reduce((sum, names) => sum + names.length, 0))} names compared.\n`
        : section
    );
    return removals.length > 0 ? 1 : 0;
  }

  const rendered = renderArtifact(currentSurface(cwd));
  const target = path.join(cwd, ARTIFACT);
  if (argv.includes("--check")) {
    let existing = "";
    try {
      existing = readFileSync(target, "utf8");
    } catch {
      existing = "";
    }
    if (existing === rendered) return 0;
    process.stderr.write(
      `${ARTIFACT} is stale. Regenerate it in this commit:\n  bun run build:export-surface\n`
    );
    return 1;
  }
  writeFileSync(target, rendered);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
