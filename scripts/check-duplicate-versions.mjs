#!/usr/bin/env node
/**
 * Manifest-authoritative duplicate-version check (issue #1888).
 *
 * Context: Lisa has seen fleet failures where a version pin drifts between the
 * canonical dependency manifest (`package.json` / `package.lisa.json`) and a
 * copy of that same literal living in a workflow, a governed script, or a
 * template. `scripts/update-node-version.ts` exists only because the Node
 * version is duplicated across a dozen workflow files: bumping the manifest is
 * not enough, so a bulk rewriter hand-syncs the copies. Every such copy is a
 * second edit site that a routine bump can silently miss.
 *
 * This detector makes the manifest authoritative. It parses the canonical
 * manifests, then scans governed inputs (workflows, scripts, templates,
 * fixtures) for version literals that are pinned for a package or engine the
 * manifest already pins — those places should PARSE the manifest instead of
 * copying the pin.
 *
 * ## Bounded false positives (explicit acceptance criterion)
 *
 * A false "duplicate" erodes the check, so detection is deliberately
 * conservative and under-reports rather than over-fires:
 *
 *   - Non-policy surfaces are never scanned: lockfiles (`bun.lock`,
 *     `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`), prose/markdown,
 *     the `.lisa/` ledgers, `node_modules`, generated output (`dist/`,
 *     `coverage/`), and the upstream-evidence manifest (which stores versions
 *     and hashes by design).
 *   - Manifests themselves are never findings — they are the source of truth.
 *   - Only two provably-actionable shapes are flagged:
 *       1. an install pin (`npm i -g pkg@1.2.3`, `bunx pkg@1.2.3`, ...) whose
 *          package name the manifest also pins, and
 *       2. a toolchain pin (`node-version:`/`bun-version:` and their
 *          underscore spellings) whose tool the manifest pins under `engines`.
 *     Both require a FULL `x.y.z` literal; loose ranges (`22.x`, `lts/*`) are
 *     not literal duplicates and are skipped.
 *   - A package name absent from the manifest is never flagged: an unmanaged
 *     tool version is not manifest drift.
 *   - Comment lines are prose, not active pins.
 *   - A SELF-reference — an install literal for the canonical manifest's own
 *     `name` — is never flagged. That literal is a published-artifact version
 *     FLOOR ("the released CLI must be at least X for this gate to mean
 *     anything"), a different knob from the dependency range the project
 *     dogfoods, so "read it from the manifest" would DOWNGRADE the gate.
 *
 * Findings are reported whether the literal AGREES with the manifest
 * (`duplicate`) or has already diverged (`drifted`). Identity, not equality,
 * is what makes it a duplicate — that is exactly why changing a manifest pin
 * keeps the copy reported instead of hiding it.
 *
 * ## Documented exceptions
 *
 * An intentional duplicate (e.g. mid-migration) is recorded honestly with an
 * inline marker on the offending line or the line above it:
 *
 *   # lisa-allow-duplicate-version: pinned during CI migration (#1888)
 *   run: npm i -g @ast-grep/cli@0.40.4
 *
 * The marker requires BOTH a non-empty reason and a ticket reference (`#1888`,
 * `LISA-42`, or a URL) so the exception is tracked and auditable rather than a
 * silent mute; a ticketless marker is rejected and the duplicate is reported.
 * Every allowed exception is printed in the report, not merely counted.
 *
 * ## Remediation rule
 *
 * Update the manifest + lockfile ONLY, and make the governed input read the
 * value from the manifest. If the duplicate must exist during a migration,
 * add the inline marker above with a tracked ticket.
 *
 * ## Rollout mode
 *
 * Default is ADVISORY (report, exit 0) because Lisa itself is not yet clean.
 * `--strict` turns findings into a non-zero exit and is what a cleaned-up
 * surface (or a fixture-scoped test) uses.
 *
 * CLI:
 *   node scripts/check-duplicate-versions.mjs [--root <dir>] [--scan <dir>]...
 *                                             [--strict] [--json] [--help]
 *
 * Exit codes:
 *   0 — advisory mode (always), or strict mode with no findings.
 *   1 — strict mode with at least one unallowed finding.
 *   2 — operational/usage error: unknown flag, flag missing its value, a
 *       `--root` that isn't a directory, an explicitly passed `--scan` path
 *       that is missing or isn't a directory, or no manifest found. An absent
 *       BUILT-IN default scan root (a repo with no `rails/`) is not an error;
 *       it is skipped and named in the report.
 *
 * @module scripts/check-duplicate-versions
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** Schema version of the emitted JSON report. */
export const SCHEMA_VERSION = 1;

/** Manifest filenames parsed as canonical sources of truth. */
export const MANIFEST_FILES = ["package.json", "package.lisa.json"];

/** Directories scanned when no `--scan` is supplied (relative to root). */
export const DEFAULT_SCAN_DIRS = [
  ".github/workflows",
  "scripts",
  "all",
  "typescript",
  "rails",
  "expo",
  "cdk",
  "nestjs",
];

/** Directory names never scanned — generated, vendored, or non-policy. */
export const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".lisa",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "docs",
  "wiki",
  "transcripts",
  "evidence",
]);

/** File basenames never scanned — lockfiles and generated manifests. */
export const SKIPPED_FILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "upstream-evidence-manifest.json",
]);

/** Extensions of governed inputs. Prose (`.md`) and data are excluded. */
export const GOVERNED_EXTENSIONS = new Set([
  ".yml",
  ".yaml",
  ".sh",
  ".bash",
  ".mjs",
  ".cjs",
  ".js",
  ".ts",
  ".mts",
]);

/** Inline marker that records an intentional, documented duplicate. */
export const EXCEPTION_MARKER = "lisa-allow-duplicate-version:";

/**
 * A tracked ticket an exception must cite: a GitHub-style issue (`#1888`), a
 * tracker key (`LISA-42`), or a URL. Without one the "exception" is untracked
 * and would never be cleaned up.
 */
const TICKET_REFERENCE_PATTERN = /#\d+|\b[A-Z][A-Z\d]+-\d+\b|https?:\/\/\S+/u;

/** Package-manager tokens that make a `name@version` literal an install pin. */
const INSTALL_COMMAND_PATTERN =
  /\b(?:npm|npx|bun|bunx|pnpm|pnpx|yarn|corepack)\b/u;

/** `name@x.y.z` occurrences, including scoped names. */
const NAME_AT_VERSION_PATTERN =
  /(@[a-z0-9][\w.-]*\/[\w.-]+|[a-z0-9][\w.-]*)@(\d+\.\d+\.\d+[\w.+-]*)/giu;

/** `node-version: '22.21.1'` / `bun_version: "1.3.8"` toolchain pins. */
const TOOLCHAIN_PIN_PATTERN =
  /\b(node|bun)[-_]version\s*:\s*['"]?(\d+\.\d+\.\d+[\w.+-]*)['"]?/giu;

/** Leading tokens that make a line a comment rather than an active pin. */
const COMMENT_PREFIXES = ["#", "//", "*", "/*", "<!--"];

/** Manifest sections holding package pins, in both plain and Lisa shapes. */
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Lisa `package.lisa.json` governance wrappers around real manifest keys. */
const GOVERNANCE_SECTIONS = ["force", "defaults", "merge"];

/**
 * Usage error — thrown by `parseArgs` (and manifest resolution) so `main` can
 * distinguish an invalid invocation (exit 2) from a drift result (exit 1).
 */
export class UsageError extends Error {}

/**
 * Strip a semver range operator so a manifest pin can be compared to a bare
 * literal. `^0.40.4` and `0.40.4` are the same pin for duplication purposes.
 *
 * @param {string} value - raw manifest version value.
 * @returns {string} the value without a leading range operator.
 */
export function normalizeVersion(value) {
  return String(value)
    .replace(/^[\^~>=<\s]+/u, "")
    .trim();
}

/**
 * Collect package and engine pins from one parsed manifest object, handling
 * both a plain `package.json` and Lisa's `package.lisa.json`, whose real keys
 * are nested under `force`/`defaults`/`merge`.
 *
 * @param {Record<string, unknown>} manifest - parsed manifest JSON.
 * @param {string} label - manifest filename used in remediation text.
 * @returns {{ packages: Record<string, {version: string, field: string}>, engines: Record<string, {version: string, field: string}> }}
 *   the pins this manifest declares.
 */
export function collectManifestPins(manifest, label) {
  const packages = {};
  const engines = {};
  const scopes = [{ node: manifest, prefix: "" }];
  for (const section of GOVERNANCE_SECTIONS) {
    const node = manifest?.[section];
    if (node && typeof node === "object") {
      scopes.push({ node, prefix: `${section}.` });
    }
  }
  for (const { node, prefix } of scopes) {
    for (const section of DEPENDENCY_SECTIONS) {
      const entries = node[section];
      if (!entries || typeof entries !== "object") continue;
      for (const [name, version] of Object.entries(entries)) {
        if (typeof version !== "string" || packages[name]) continue;
        // A project referencing its OWN published artifact is stating a
        // minimum version FLOOR ("the released CLI must be at least X for this
        // gate to mean anything"), which is a different knob from the
        // dependency range it dogfoods. Telling an operator to read the floor
        // from the dependency range would DOWNGRADE the gate, so a
        // self-reference is never a governed pin.
        if (name === manifest?.name) continue;
        packages[name] = {
          version: normalizeVersion(version),
          field: `${label} ${prefix}${section}.${name}`,
        };
      }
    }
    const engineEntries = node.engines;
    if (!engineEntries || typeof engineEntries !== "object") continue;
    for (const [tool, version] of Object.entries(engineEntries)) {
      if (typeof version !== "string" || engines[tool]) continue;
      if (!/^\d+\.\d+\.\d+/u.test(version)) continue;
      engines[tool] = {
        version: normalizeVersion(version),
        field: `${label} ${prefix}engines.${tool}`,
      };
    }
  }
  return { packages, engines };
}

/**
 * Merge the pins of every manifest present at `root`. Earlier manifests win so
 * `package.json` (the resolved truth) takes precedence over the template.
 *
 * @param {string} root - directory holding the canonical manifests.
 * @returns {{ packages: Record<string, {version: string, field: string}>, engines: Record<string, {version: string, field: string}>, sources: string[] }}
 *   merged pins plus the manifest filenames that contributed.
 * @throws {UsageError} when no manifest exists at `root`.
 */
export function loadManifestPins(root) {
  const packages = {};
  const engines = {};
  const sources = [];
  const selfNames = new Set();
  for (const file of MANIFEST_FILES) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
    if (typeof parsed?.name === "string") selfNames.add(parsed.name);
    const pins = collectManifestPins(parsed, file);
    Object.assign(packages, { ...pins.packages, ...packages });
    Object.assign(engines, { ...pins.engines, ...engines });
    sources.push(file);
  }
  // A name declared by ANY canonical manifest is a self-reference, even when a
  // sibling manifest is what pins it as a dependency.
  for (const name of selfNames) delete packages[name];
  if (sources.length === 0) {
    throw new UsageError(
      `no canonical manifest (${MANIFEST_FILES.join(" or ")}) found in ${root}`
    );
  }
  return { packages, engines, sources };
}

/**
 * True iff a file is a governed input worth scanning. Lockfiles, prose, and
 * generated or vendored trees are non-policy surfaces and never scanned —
 * this is the bounded-false-positive guarantee.
 *
 * @param {string} relativePath - path relative to the scan root.
 * @returns {boolean} whether the file should be scanned.
 */
export function isGovernedFile(relativePath) {
  const segments = relativePath.split(path.sep);
  if (segments.some(segment => SKIPPED_DIRECTORIES.has(segment))) return false;
  const base = segments.at(-1) ?? "";
  if (SKIPPED_FILES.has(base)) return false;
  if (MANIFEST_FILES.includes(base)) return false;
  return GOVERNED_EXTENSIONS.has(path.extname(base));
}

/**
 * True iff a line is a comment. A version literal inside a comment — a usage
 * example in a script's docblock, a commented-out workflow step — is prose,
 * not an active policy pin, so it is never a duplicate. Part of the
 * bounded-false-positive guarantee.
 *
 * @param {string} line - the raw line.
 * @returns {boolean} whether the line is a comment.
 */
export function isCommentLine(line) {
  const trimmed = line.trimStart();
  return COMMENT_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

/**
 * Whether a finding on `lineIndex` carries a documented inline exception —
 * on its own line or the line directly above it, with a non-empty reason AND a
 * ticket reference. The ticket is mandatory: an exception nobody tracks is a
 * silent mute, not the honest record the marker is supposed to be.
 *
 * @param {string[]} lines - all lines of the file.
 * @param {number} lineIndex - zero-based index of the finding's line.
 * @returns {string | null} the recorded reason, or null when unmarked or
 *   missing a ticket reference.
 */
export function findExceptionReason(lines, lineIndex) {
  for (const index of [lineIndex, lineIndex - 1]) {
    const line = lines[index];
    if (typeof line !== "string" || !line.includes(EXCEPTION_MARKER)) continue;
    const reason = line
      .slice(line.indexOf(EXCEPTION_MARKER) + EXCEPTION_MARKER.length)
      .trim();
    if (reason.length > 0 && TICKET_REFERENCE_PATTERN.test(reason)) {
      return reason;
    }
  }
  return null;
}

/**
 * Human-readable remediation for one finding.
 *
 * @param {string} subject - the duplicated package or engine name.
 * @param {string} field - the manifest field that already owns the pin.
 * @returns {string} remediation guidance.
 */
export function remediationFor(subject, field) {
  return (
    `Read the ${subject} version from ${field} instead of hardcoding it; ` +
    `a version bump must touch the manifest + lockfile only. If this ` +
    `duplicate is intentional during a migration, record it with an inline ` +
    `\`${EXCEPTION_MARKER} <reason> (<ticket>)\` marker and track the cleanup ` +
    `in a ticket.`
  );
}

/**
 * Classify one duplicated literal against its manifest pin.
 *
 * @param {string} literal - the version literal found in the governed input.
 * @param {string} pinned - the manifest's normalized pin.
 * @param {string | null} exception - documented exception reason, if any.
 * @returns {"allowed" | "duplicate" | "drifted"} the finding status.
 */
export function classifyStatus(literal, pinned, exception) {
  if (exception !== null) return "allowed";
  return literal === pinned ? "duplicate" : "drifted";
}

/**
 * Scan a single governed line for install pins of manifest-known packages.
 *
 * @param {string} line - the line's text.
 * @param {Record<string, {version: string, field: string}>} packages - manifest package pins.
 * @returns {{ package: string, version: string, manifestVersion: string, manifestField: string, source: "install-pin" }[]}
 *   raw (unclassified) matches on this line.
 */
export function matchInstallPins(line, packages) {
  if (!INSTALL_COMMAND_PATTERN.test(line)) return [];
  const matches = [];
  for (const match of line.matchAll(NAME_AT_VERSION_PATTERN)) {
    const [, name, version] = match;
    const pin = packages[name];
    if (!pin) continue;
    matches.push({
      package: name,
      version,
      manifestVersion: pin.version,
      manifestField: pin.field,
      source: "install-pin",
    });
  }
  return matches;
}

/**
 * Scan a single governed line for toolchain pins of manifest-known engines.
 *
 * @param {string} line - the line's text.
 * @param {Record<string, {version: string, field: string}>} engines - manifest engine pins.
 * @returns {{ package: string, version: string, manifestVersion: string, manifestField: string, source: "toolchain-pin" }[]}
 *   raw (unclassified) matches on this line.
 */
export function matchToolchainPins(line, engines) {
  const matches = [];
  for (const match of line.matchAll(TOOLCHAIN_PIN_PATTERN)) {
    const [, tool, version] = match;
    const pin = engines[tool.toLowerCase()];
    if (!pin) continue;
    matches.push({
      package: tool.toLowerCase(),
      version,
      manifestVersion: pin.version,
      manifestField: pin.field,
      source: "toolchain-pin",
    });
  }
  return matches;
}

/**
 * Scan one governed file's contents and produce classified findings.
 *
 * @param {string} contents - full file text.
 * @param {string} relativePath - path reported in findings.
 * @param {{ packages: Record<string, {version: string, field: string}>, engines: Record<string, {version: string, field: string}> }} pins - manifest pins.
 * @returns {{ file: string, line: number, package: string, version: string, manifestVersion: string, manifestField: string, source: string, status: string, exception: string | null, remediation: string }[]}
 *   findings, in file order.
 */
export function scanContents(contents, relativePath, pins) {
  const lines = contents.split("\n");
  const findings = [];
  lines.forEach((line, index) => {
    if (isCommentLine(line)) return;
    const raw = [
      ...matchInstallPins(line, pins.packages),
      ...matchToolchainPins(line, pins.engines),
    ];
    if (raw.length === 0) return;
    const exception = findExceptionReason(lines, index);
    for (const match of raw) {
      findings.push({
        ...match,
        file: relativePath,
        line: index + 1,
        status: classifyStatus(match.version, match.manifestVersion, exception),
        exception,
        remediation: remediationFor(match.package, match.manifestField),
      });
    }
  });
  return findings;
}

/**
 * Recursively list governed files under a directory.
 *
 * @param {string} directory - absolute directory to walk.
 * @param {string} root - absolute scan root, for relative paths.
 * @returns {string[]} absolute paths of governed files.
 */
export function listGovernedFiles(directory, root) {
  const found = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      found.push(...listGovernedFiles(full, root));
      continue;
    }
    if (entry.isFile() && isGovernedFile(path.relative(root, full))) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Build the full report for a root and its scan directories.
 *
 * @param {{ root: string, scan: string[], strict: boolean, scanIsExplicit?: boolean }} options - resolved CLI options.
 * @returns {{ schemaVersion: number, mode: string, root: string, manifests: string[], scanned: string[], skippedDefaults: string[], summary: { files: number, duplicate: number, drifted: number, allowed: number }, findings: object[] }}
 *   the machine-readable report.
 * @throws {UsageError} when an explicitly requested scan directory is missing
 *   or is not a directory, or when no manifest exists.
 */
export function buildReport({ root, scan, strict, scanIsExplicit = false }) {
  const pins = loadManifestPins(root);
  const findings = [];
  const skippedDefaults = [];
  let files = 0;
  for (const relative of scan) {
    const directory = path.join(root, relative);
    if (!fs.existsSync(directory)) {
      // A directory the caller explicitly asked for and that does not exist is
      // an error: silently skipping it would leave the check reporting "no
      // duplicates found" while it scanned nothing at all. An absent BUILT-IN
      // default (a repo with no `rails/`) is normal — skip it, but say so.
      if (scanIsExplicit) {
        throw new UsageError(`--scan directory does not exist: ${relative}`);
      }
      skippedDefaults.push(relative);
      continue;
    }
    if (!fs.statSync(directory).isDirectory()) {
      throw new UsageError(`--scan target is not a directory: ${relative}`);
    }
    for (const file of listGovernedFiles(directory, root)) {
      files += 1;
      findings.push(
        ...scanContents(
          fs.readFileSync(file, "utf8"),
          path.relative(root, file),
          pins
        )
      );
    }
  }
  const count = status => findings.filter(f => f.status === status).length;
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: strict ? "strict" : "advisory",
    root,
    manifests: pins.sources,
    scanned: scan,
    skippedDefaults,
    summary: {
      files,
      duplicate: count("duplicate"),
      drifted: count("drifted"),
      allowed: count("allowed"),
    },
    findings,
  };
}

/**
 * Parse CLI arguments.
 *
 * @param {string[]} argv - arguments after the script path.
 * @returns {{ root: string, scan: string[], scanIsExplicit: boolean, strict: boolean, json: boolean, help: boolean }} resolved options.
 * @throws {UsageError} on an unknown flag or a flag missing its value.
 */
export function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    scan: [],
    scanIsExplicit: false,
    strict: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--strict") options.strict = true;
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--root" || argument === "--scan") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${argument} requires a directory value`);
      }
      index += 1;
      if (argument === "--root") options.root = path.resolve(value);
      else options.scan.push(value);
    } else {
      throw new UsageError(`unknown argument: ${argument}`);
    }
  }
  if (
    !fs.existsSync(options.root) ||
    !fs.statSync(options.root).isDirectory()
  ) {
    throw new UsageError(`--root is not a directory: ${options.root}`);
  }
  options.scanIsExplicit = options.scan.length > 0;
  if (!options.scanIsExplicit) options.scan = [...DEFAULT_SCAN_DIRS];
  return options;
}

/** Usage text, which also carries the remediation rule. */
export const HELP_TEXT = `check:duplicate-versions — the canonical manifest is authoritative.

Usage: node scripts/check-duplicate-versions.mjs [options]

  --root <dir>   Directory holding the canonical manifests (default: repo root).
  --scan <dir>   Governed directory to scan, relative to --root (repeatable).
  --strict       Exit non-zero on findings (default: advisory, exit 0).
  --json         Emit the machine-readable report on stdout.
  -h, --help     Show this help.

What it flags: a version literal pinned in a governed workflow, script,
template, or fixture for a package or engine the canonical manifest already
pins — a second edit site a routine bump can miss.

What it never flags: lockfiles, prose/markdown, comments, .lisa ledgers,
node_modules, generated output, the manifests themselves, loose ranges (22.x),
any package the manifest does not pin, and a self-reference to the manifest's
own name (that is a published-artifact version FLOOR, not a mirrored range).

Remediation rule: update the MANIFEST + LOCKFILE only, and make the governed
input read the value from the manifest. If the duplicate must exist during a
migration, record it inline with
  ${EXCEPTION_MARKER} <reason> (<ticket>)
on the offending line or the line above it. A ticket reference (#123, KEY-123,
or a URL) is REQUIRED — a ticketless marker is rejected — and every allowed
exception is listed in the report so no mute is invisible.`;

/**
 * Render the human-readable report.
 *
 * @param {ReturnType<typeof buildReport>} report - the report to print.
 * @returns {string} formatted text.
 */
export function formatReport(report) {
  const violations = report.findings.filter(f => f.status !== "allowed");
  const lines = [
    `check:duplicate-versions (${report.mode} mode)`,
    `  manifests: ${report.manifests.join(", ")}`,
    `  scanned:   ${report.summary.files} governed files`,
    `  findings:  ${report.summary.duplicate} duplicate, ${report.summary.drifted} drifted, ${report.summary.allowed} allowed`,
  ];
  for (const finding of violations) {
    lines.push(
      "",
      `  ${finding.file}:${finding.line} [${finding.status}] ${finding.package}@${finding.version} (manifest: ${finding.manifestVersion})`,
      `    ${finding.remediation}`
    );
  }
  // Every mute is printed, not just counted: an exception nobody can see in
  // the report is indistinguishable from a duplicate nobody noticed.
  const allowed = report.findings.filter(f => f.status === "allowed");
  if (allowed.length > 0) {
    lines.push("", `  Allowed exceptions (${allowed.length}):`);
    for (const finding of allowed) {
      lines.push(
        `    ${finding.file}:${finding.line} ${finding.package}@${finding.version} — ${finding.exception}`
      );
    }
  }
  if (report.skippedDefaults?.length > 0) {
    lines.push(
      "",
      `  Default scan roots skipped (absent): ${report.skippedDefaults.join(", ")}`
    );
  }
  if (violations.length === 0) {
    lines.push("", "  No manifest-authoritative duplicates found.");
  } else if (report.mode === "advisory") {
    lines.push(
      "",
      "  ADVISORY: reported, not enforced. Lisa still carries pre-existing",
      "  duplicates; clean them up (or record exceptions) before switching",
      "  this check to --strict."
    );
  }
  return lines.join("\n");
}

/**
 * CLI entry point.
 *
 * @returns {void}
 */
function main() {
  // `process.exitCode` rather than `process.exit()` throughout: exiting
  // eagerly truncates a piped stdout write, which would corrupt the `--json`
  // report exactly when there is something to report.
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check:duplicate-versions: ${error.message}`);
    console.error(HELP_TEXT);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }
  let report;
  try {
    report = buildReport(options);
  } catch (error) {
    console.error(`check:duplicate-versions: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  console.log(
    options.json ? JSON.stringify(report, null, 2) : formatReport(report)
  );
  const violations = report.findings.filter(f => f.status !== "allowed").length;
  if (options.strict && violations > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
