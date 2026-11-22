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
 * It reads exports **statically**, from the TypeScript compiler's syntax tree
 * (a runtime dependency already), so an `export const` written inside a
 * template string or a comment is text, not a declaration. It does not
 * execute the modules, and it therefore cannot see a name attached at runtime.
 * That limit is deliberate: importing 130 shipped scripts to enumerate them
 * would run their top-level code during a build.
 * @module scripts/generate-export-surface
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

/**
 * Fixed absolute git locations, in the order they are tried.
 *
 * A bare `"git"` resolves through `PATH`, which any directory early on it can
 * decide — and this script's whole purpose is to be trusted about what a
 * release removed. The same ordered candidate list the other shipped checks
 * use, so one repository resolves one git.
 */
const GIT_LOCATIONS = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];

/** Absolute git path: the first candidate that exists. */
const GIT_BIN = GIT_LOCATIONS.find(candidate => existsSync(candidate)) ?? "git";

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
 * applies to source — the reason the sibling generated artifacts (the hash
 * ledger and the evidence manifest) are JSON too. Data does not need to be source: as JSON
 * the artifact keeps the per-name diff, needs no waiver, and its reader becomes
 * `JSON.parse` instead of a hand-rolled line parser that could silently
 * disagree with the renderer.
 */
const ARTIFACT = "src/core/export-surface.json";

/**
 * Every tracked, shipped `.mjs` path.
 * @param {string} cwd Repository root.
 * @returns {string[]} Repo-relative paths, sorted.
 */
export function shippedScripts(cwd = process.cwd()) {
  const listed = execFileSync(GIT_BIN, ["ls-files"], {
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
 * Whether a statement carries a given modifier keyword.
 * @param {ts.Statement} statement A top-level statement.
 * @param {ts.SyntaxKind} kind The modifier to look for.
 * @returns {boolean} True when present.
 */
function hasModifier(statement, kind) {
  return (
    ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : []
  ).some(modifier => modifier.kind === kind);
}

/**
 * Every identifier a binding introduces, through destructuring.
 * @param {ts.BindingName} name A variable declaration's name.
 * @returns {string[]} The bound identifiers.
 */
function boundNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap(element =>
    ts.isOmittedExpression(element) ? [] : boundNames(element.name)
  );
}

/**
 * The names one top-level statement adds to the module's exports.
 * @param {ts.Statement} statement A top-level statement.
 * @returns {string[]} Exported names; empty when the statement exports none.
 */
function statementExports(statement) {
  if (ts.isExportDeclaration(statement)) {
    const clause = statement.exportClause;
    // `export * from "mod"` introduces no name of its own.
    if (clause === undefined) return [];
    if (ts.isNamespaceExport(clause)) return [clause.name.text];
    // `a as b` exports b; the local name is not part of the surface.
    return clause.elements.map(element => element.name.text);
  }
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return [];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap(declaration =>
      boundNames(declaration.name)
    );
  }
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined
  ) {
    return [statement.name.text];
  }
  return [];
}

/**
 * The names one module exports.
 *
 * Read from the syntax tree, so only real top-level export declarations count:
 * an `export const` inside a template string, a comment, or a nested scope is
 * not on the surface. `export default` is deliberately excluded: it has no
 * name to compare, so recording it would add a row that can never change
 * meaningfully.
 * @param {string} source Module source.
 * @returns {string[]} Exported names, sorted and deduplicated.
 */
export function exportedNames(source) {
  const file = ts.createSourceFile(
    "module.mjs",
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS
  );
  const names = new Set(
    file.statements.flatMap(statement => statementExports(statement))
  );
  names.delete("default");
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
 * Keep only the removals that were real exports at the earlier revision.
 *
 * An artifact recorded by an older reader can list a name that was never
 * exported: the regex reader it replaced counted `export const` lines inside
 * template strings. Reporting such a name as removed would announce an API
 * break that never happened. Each candidate is re-read from the module's
 * source at that revision with today's reader; a module that cannot be read
 * there keeps its removal, so the check fails closed rather than going quiet.
 * @param {Array<{file: string, name: string}>} removals From {@link removedExports}.
 * @param {(file: string) => string|null} sourceAt The module's source at the earlier revision, or null.
 * @returns {Array<{file: string, name: string}>} The removals that were real exports.
 */
export function confirmedRemovals(removals, sourceAt) {
  const cache = new Map();
  const namesIn = file => {
    if (!cache.has(file)) {
      const source = sourceAt(file);
      cache.set(file, source === null ? null : new Set(exportedNames(source)));
    }
    return cache.get(file);
  };
  return removals.filter(({ file, name }) => {
    const names = namesIn(file);
    return names === null || names.has(name);
  });
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
    const source = execFileSync(GIT_BIN, ["show", `${ref}:${ARTIFACT}`], {
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
 * A file's contents at a git revision.
 * @param {string} ref Git revision.
 * @param {string} file Repo-relative path.
 * @param {string} cwd Repository root.
 * @returns {string|null} The source, or null when it cannot be read there.
 */
function sourceAtRevision(ref, file, cwd) {
  try {
    return execFileSync(GIT_BIN, ["show", `${ref}:${file}`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // probe-direction: fail-closed — an unreadable revision returns null, and
    // confirmedRemovals keeps the removal it could not disprove.
    return null;
  }
}

/**
 * Classify what an argument vector asks `--removed-since` to do.
 *
 * Three outcomes, and the point of the function is that they are three rather
 * than two. "Compare against this revision" and "generate the artifact" are
 * the two intended paths; "the flag is present but its operand is missing or
 * is itself a flag" used to collapse into the second, which is how a typo came
 * to read as `no exports removed`.
 *
 * An operand starting with `-` is refused rather than passed to git: it is
 * far likelier to be the next flag — `--removed-since --check` consumed
 * `--check` as the revision — than a revision anyone meant.
 * @param {string[]} argv Arguments after the script name.
 * @returns {{mode: "generate"}|{mode: "compare", operand: string}|{mode: "refuse", got: string}}
 *   What was asked for.
 */
export function removedSinceOperand(argv) {
  const index = argv.indexOf("--removed-since");
  if (index === -1) return { mode: "generate" };

  const operand = argv[index + 1];
  if (operand === undefined || operand === "") {
    return { mode: "refuse", got: "nothing" };
  }
  if (operand.startsWith("-")) {
    return { mode: "refuse", got: `the flag "${operand}"` };
  }
  return { mode: "compare", operand };
}

/**
 * CLI.
 * @returns {number} Exit code.
 */
function main() {
  const cwd = process.cwd();
  const argv = process.argv.slice(2);
  const request = removedSinceOperand(argv);

  if (request.mode === "refuse") {
    // Exit 2, and on stderr, because the alternative was exit 0 with the
    // artifact rewritten: a trailing `--removed-since` left the operand
    // undefined, the comparison branch was skipped, and control fell through
    // to generation — the one branch that produces a reassuring exit code.
    // A caller that asked "did this release remove any public export?" was
    // handed an all-clear for a comparison nobody performed.
    process.stderr.write(
      `--removed-since requires a git revision as its next argument; got ${request.got}. Nothing was compared, and this is NOT a clean result.\n`
    );
    return 2;
  }

  if (request.mode === "compare") {
    const since = request.operand;
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
    const removals = confirmedRemovals(
      removedExports(before, currentSurface(cwd)),
      file => sourceAtRevision(since, file, cwd)
    );
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
