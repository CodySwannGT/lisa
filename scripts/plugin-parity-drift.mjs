#!/usr/bin/env node
/**
 * Deterministic drift detector for Lisa's third-party plugin parity subsystem
 * (issue #1059).
 *
 * A Lisa-native skill that reimplements an upstream Claude plugin carries a
 * `synced-from: <name>@<marketplace>@<version>` frontmatter pin. This script
 * scans for those pins, resolves each plugin's *current* upstream version from
 * the installed plugin cache, and reports whether the Lisa reimplementation has
 * drifted behind (or ahead of) its upstream. It NEVER auto-bumps and never
 * edits any skill — it only reports, so CI can gate on its exit code.
 *
 * Design: parity/DESIGN-plugin-parity-subsystem.md §2–§3.
 *
 * Determinism guarantees (so the unit test is reproducible and CI is stable):
 *   - zero dependencies (Node built-ins only),
 *   - no network access,
 *   - no `Date` / `Math.random` — "current upstream" is defined purely as the
 *     MAX valid semver across the cache version subdirs (read from each
 *     manifest's `version` field, not the directory name).
 *
 * The cache root and skills roots are injectable via flags so tests point at a
 * committed fixture instead of the machine's real `~/.claude/plugins/cache`.
 *
 * CLI:
 *   node scripts/plugin-parity-drift.mjs [--skills-root <dir>]... [--cache-root <dir>] [--json]
 *
 * Exit codes (CI contract, §3.4):
 *   0 — no drift: every synced skill is `ok` (also when there are zero synced
 *       skills, in which case the cache need not exist — a fresh CI runner with
 *       no reimplementations passes cleanly).
 *   1 — drift found: ≥1 skill is stale/ahead/not-installed/unresolved/unparseable.
 *   2 — operational/usage error: unknown flag, a flag missing its value, no
 *       resolvable skills root, a filesystem error during the scan, or — only
 *       when ≥1 synced skill must be resolved — a missing cache root.
 *
 * @module scripts/plugin-parity-drift
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Semver 2.0.0 grammar. Build metadata (`+...`) is accepted but ignored in
 * comparison; prerelease (`-...`) is accepted and sorts below its release.
 */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A plugin name / marketplace token: `1*(ALPHA / DIGIT / "-" / "_")`. */
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Usage error — thrown by `parseArgs` for an invalid invocation so `main` can
 * distinguish it (exit 2) from a drift result (exit 1).
 */
export class UsageError extends Error {}

/**
 * True iff `value` is a valid semver 2.0.0 string.
 *
 * @param {unknown} value - candidate version string.
 * @returns {boolean} whether `value` parses as semver.
 */
export function isValidSemver(value) {
  if (typeof value !== "string") {
    return false;
  }
  return SEMVER_RE.test(value);
}

/**
 * Split a semver string into its numeric `[major, minor, patch]` core and the
 * raw prerelease string (build metadata stripped).
 *
 * @param {string} version - a valid semver string.
 * @returns {{ core: readonly number[], prerelease: string }} parsed parts.
 */
function splitSemver(version) {
  const withoutBuild = version.split("+", 1)[0];
  const dashIndex = withoutBuild.indexOf("-");
  const coreStr =
    dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prerelease = dashIndex === -1 ? "" : withoutBuild.slice(dashIndex + 1);
  const core = coreStr.split(".").map(part => Number.parseInt(part, 10));
  return { core, prerelease };
}

/**
 * Compare two prerelease strings per semver precedence rules.
 *
 * @param {string} a - first prerelease (may be empty = "is a release").
 * @param {string} b - second prerelease (may be empty = "is a release").
 * @returns {number} -1, 0, or 1.
 */
function comparePrerelease(a, b) {
  if (a === b) {
    return 0;
  }
  if (a === "") {
    return 1; // a is a full release; it outranks any prerelease b.
  }
  if (b === "") {
    return -1;
  }
  const aIds = a.split(".");
  const bIds = b.split(".");
  for (let i = 0; i < Math.max(aIds.length, bIds.length); i++) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) {
      return -1; // shorter set of identifiers has lower precedence.
    }
    if (bi === undefined) {
      return 1;
    }
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const diff = Number.parseInt(ai, 10) - Number.parseInt(bi, 10);
      if (diff !== 0) {
        return diff < 0 ? -1 : 1;
      }
      continue;
    }
    if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers rank below alphanumeric.
    }
    if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two semver strings. Build metadata is ignored; a prerelease sorts
 * below its associated release.
 *
 * @param {string} a - first valid semver string.
 * @param {string} b - second valid semver string.
 * @returns {number} -1 if a < b, 0 if equal precedence, 1 if a > b.
 */
export function compareSemver(a, b) {
  const pa = splitSemver(a);
  const pb = splitSemver(b);
  for (let i = 0; i < 3; i++) {
    const diff = pa.core[i] - pb.core[i];
    if (diff !== 0) {
      return diff < 0 ? -1 : 1;
    }
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * Parse a `synced-from` value of the form `name@marketplace@version`.
 *
 * Semver never contains `@`, so the version is everything right of the LAST
 * `@`; the remainder is the canonical plugin id `name@marketplace`, split once
 * more on its single `@`.
 *
 * @param {unknown} raw - the raw frontmatter value.
 * @returns {{ name: string, marketplace: string, version: string, plugin: string } | null}
 *   parsed reference, or `null` if malformed.
 */
export function parseSyncedFrom(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  const lastAt = value.lastIndexOf("@");
  if (lastAt <= 0 || lastAt === value.length - 1) {
    return null;
  }
  const version = value.slice(lastAt + 1);
  const pluginRef = value.slice(0, lastAt);
  if (!isValidSemver(version)) {
    return null;
  }
  const refAt = pluginRef.indexOf("@");
  if (refAt <= 0 || refAt === pluginRef.length - 1) {
    return null;
  }
  const name = pluginRef.slice(0, refAt);
  const marketplace = pluginRef.slice(refAt + 1);
  if (!TOKEN_RE.test(name) || !TOKEN_RE.test(marketplace)) {
    return null;
  }
  return { marketplace, name, plugin: pluginRef, version };
}

/**
 * Parse a minimal YAML frontmatter block (leading `--- ... ---`) into a flat
 * map of `key: value` strings. Surrounding quotes are stripped. This is
 * intentionally tiny — the detector only needs the `synced-from` scalar.
 *
 * @param {string} content - full file contents.
 * @returns {Record<string, string>} the parsed frontmatter keys.
 */
export function parseFrontmatter(content) {
  const text = String(content);
  if (!text.startsWith("---")) {
    return {};
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return {};
  }
  const block = text.slice(text.indexOf("\n") + 1, end);
  const result = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    const rawValue = trimmed.slice(colon + 1).trim();
    const value = rawValue.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    result[key] = value;
  }
  return result;
}

/**
 * True iff `target` is an existing directory.
 *
 * @param {string} target - filesystem path.
 * @returns {boolean} whether `target` resolves to a directory.
 */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read a plugin manifest's `version` field, or `null` if unreadable / invalid.
 *
 * @param {string} manifestPath - path to a `.claude-plugin/plugin.json`.
 * @returns {string | null} the manifest version string, or `null`.
 */
function readManifestVersion(manifestPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the current upstream version of `name@marketplace` purely from the
 * cache tree: the MAX valid semver across the immediate version subdirs, read
 * from each subdir's `.claude-plugin/plugin.json` `version` field. Non-semver
 * dirs (`unknown`, git hashes) are skipped because the manifest version is what
 * counts.
 *
 * @param {string} cacheRoot - the installed-plugin cache root.
 * @param {string} name - plugin name.
 * @param {string} marketplace - marketplace id.
 * @returns {{ status: "ok" | "not-installed" | "unresolved", version: string | null }}
 *   the resolution outcome.
 */
export function resolveCurrentVersion(cacheRoot, name, marketplace) {
  // Defense-in-depth path-traversal guard: only single-token names/marketplaces
  // (no `.`, `/`, `..`) can map to a cache subdir. parseSyncedFrom already
  // enforces this, but resolveCurrentVersion is a public export that no longer
  // co-locates with its validating caller.
  if (!TOKEN_RE.test(name) || !TOKEN_RE.test(marketplace)) {
    return { status: "not-installed", version: null };
  }
  const dir = path.join(cacheRoot, marketplace, name);
  if (!isDirectory(dir)) {
    return { status: "not-installed", version: null };
  }
  const versions = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifest = path.join(
      dir,
      entry.name,
      ".claude-plugin",
      "plugin.json"
    );
    const version = readManifestVersion(manifest);
    if (version !== null && isValidSemver(version)) {
      versions.push(version);
    }
  }
  if (versions.length === 0) {
    return { status: "unresolved", version: null };
  }
  const max = versions.reduce((acc, v) =>
    compareSemver(v, acc) > 0 ? v : acc
  );
  return { status: "ok", version: max };
}

/**
 * Classify a synced skill by comparing its pinned version to the resolved
 * current version (§3.3).
 *
 * @param {string} pinnedVersion - the `synced-from` pinned semver.
 * @param {{ status: string, version: string | null }} cur - resolver output.
 * @returns {"ok" | "stale" | "ahead" | "not-installed" | "unresolved"} the status.
 */
export function classify(pinnedVersion, cur) {
  if (cur.status === "not-installed") {
    return "not-installed";
  }
  // Defense-in-depth: any non-`ok` resolver state, or an `ok` state without a
  // string version, is treated as `unresolved` so compareSemver is never called
  // with a null/undefined operand. resolveCurrentVersion guarantees
  // `ok` ⇒ string version, so this only fires on contract misuse.
  if (cur.status !== "ok" || typeof cur.version !== "string") {
    return "unresolved";
  }
  const cmp = compareSemver(cur.version, pinnedVersion);
  if (cmp === 0) {
    return "ok";
  }
  return cmp > 0 ? "stale" : "ahead";
}

/**
 * Recursively collect every `SKILL.md` path beneath `root`.
 *
 * @param {string} root - a skills root directory.
 * @returns {string[]} absolute paths to discovered SKILL.md files.
 */
function walkSkillFiles(root) {
  const out = [];
  if (!isDirectory(root)) {
    return out;
  }
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Render a filesystem path relative to the repo root using POSIX separators,
 * falling back to the absolute path when the file lives outside the repo.
 *
 * @param {string} absPath - an absolute path.
 * @returns {string} a stable, display-friendly path.
 */
function displayPath(absPath) {
  const rel = path.relative(REPO_ROOT, absPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return absPath;
  }
  return rel.split(path.sep).join("/");
}

/**
 * Build one result row for a discovered synced skill.
 *
 * @param {{ file: string, raw: string }} skill - the skill file + raw pin.
 * @param {string} cacheRoot - the installed-plugin cache root.
 * @returns {{ skillPath: string, plugin: string, pinnedVersion: string | null, currentVersion: string | null, status: string }}
 *   the classified result.
 */
function buildResult(skill, cacheRoot) {
  const skillPath = displayPath(skill.file);
  const ref = parseSyncedFrom(skill.raw);
  if (ref === null) {
    return {
      currentVersion: null,
      pinnedVersion: null,
      plugin: skill.raw,
      skillPath,
      status: "unparseable",
    };
  }
  const cur = resolveCurrentVersion(cacheRoot, ref.name, ref.marketplace);
  return {
    currentVersion: cur.version,
    pinnedVersion: ref.version,
    plugin: ref.plugin,
    skillPath,
    status: classify(ref.version, cur),
  };
}

/**
 * Assemble the machine-readable report (§3.5).
 *
 * @param {ReadonlyArray<Record<string, unknown>>} results - per-skill results.
 * @param {{ cacheRoot: string, skillsRoots: readonly string[] }} opts - options.
 * @returns {Record<string, unknown>} the report object.
 */
export function buildReport(results, opts) {
  const ok = results.filter(r => r.status === "ok").length;
  return {
    cacheRoot: opts.cacheRoot,
    results,
    schemaVersion: 1,
    skillsRoots: opts.skillsRoots,
    summary: { drift: results.length - ok, ok, scanned: results.length },
  };
}

/**
 * Render the human-readable markdown table + summary line.
 *
 * @param {{ results: ReadonlyArray<Record<string, unknown>>, summary: { scanned: number, drift: number } }} report - report object.
 * @returns {string} the rendered table.
 */
function humanTable(report) {
  const header =
    "| skill | plugin | pinned | current | status |\n" +
    "| --- | --- | --- | --- | --- |";
  const rows = report.results.map(
    r =>
      `| ${cell(r.skillPath)} | ${cell(r.plugin)} | ${cell(r.pinnedVersion)} | ${cell(r.currentVersion)} | ${cell(r.status)} |`
  );
  const summary = `\n${report.summary.drift} of ${report.summary.scanned} synced skills drifted`;
  return [header, ...rows].join("\n") + summary;
}

/**
 * Sanitize a value for a markdown-table cell: a `|` in an `unparseable` raw
 * `synced-from` string would otherwise break the column layout, and newlines
 * would split the row. Pipes are escaped and newlines collapsed to spaces.
 *
 * @param {string | null | undefined} value - the raw cell value.
 * @returns {string} a table-safe string (`-` for null/undefined).
 */
function cell(value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return String(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/**
 * Parse argv into resolved options. Throws `UsageError` on a bad invocation.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ skillsRoots: string[], cacheRoot: string, json: boolean }} options.
 */
export function parseArgs(argv) {
  const skillsRoots = [];
  let cacheRoot = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--skills-root") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--skills-root requires a value");
      }
      skillsRoots.push(next);
      i += 1;
    } else if (arg === "--cache-root") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--cache-root requires a value");
      }
      cacheRoot = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  const resolvedCache =
    cacheRoot ??
    process.env.CLAUDE_PLUGIN_CACHE ??
    path.join(os.homedir(), ".claude", "plugins", "cache");
  // Default roots: both the root-level Lisa skills AND the distributed base
  // plugin skills (plugins/src/base/skills), where the real cross-agent parity
  // reimplementations carrying `synced-from` pins now live. The generated
  // plugins/lisa*/skills artifacts are deliberately NOT included — they are
  // copies of plugins/src/base and would double-count every pin.
  const resolvedSkills =
    skillsRoots.length > 0
      ? skillsRoots
      : [
          path.join(REPO_ROOT, ".claude", "skills"),
          path.join(REPO_ROOT, "plugins", "src", "base", "skills"),
        ];
  return {
    cacheRoot: path.resolve(resolvedCache),
    json,
    skillsRoots: resolvedSkills.map(r => path.resolve(r)),
  };
}

/**
 * Scan the skills roots and collect every SKILL.md carrying a non-empty
 * `synced-from` pin. May throw on a filesystem error (caller handles it).
 *
 * @param {readonly string[]} roots - resolved skills-root directories.
 * @returns {{ file: string, raw: string }[]} discovered synced skills.
 */
function collectSyncedSkills(roots) {
  const skills = [];
  // Sort roots and the final result by path so the report is deterministic:
  // readdirSync() traversal order is filesystem-dependent, which would otherwise
  // reshuffle rows across environments even for an unchanged skills set.
  for (const root of [...roots].sort((a, b) => a.localeCompare(b))) {
    for (const file of walkSkillFiles(root)) {
      const frontmatter = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const raw = frontmatter["synced-from"];
      if (typeof raw === "string" && raw !== "") {
        skills.push({ file, raw });
      }
    }
  }
  return skills.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Render a report to the chosen stream.
 *
 * @param {{ write(s: string): void }} out - the output stream.
 * @param {Record<string, unknown>} report - the report object.
 * @param {boolean} json - whether to emit JSON instead of the human table.
 * @returns {void}
 */
function emitReport(out, report, json) {
  out.write(
    (json ? JSON.stringify(report, null, 2) : humanTable(report)) + "\n"
  );
}

/**
 * Run the detector. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams (defaults to process streams).
 * @returns {number} the exit code (0 ok, 1 drift, 2 usage error).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    err.write(`error: ${error.message}\n`);
    return 2;
  }
  if (!opts.skillsRoots.some(isDirectory)) {
    err.write("error: no --skills-root resolved to a directory\n");
    return 2;
  }
  // Scan for synced skills first. Wrapped in try/catch so a filesystem race
  // (TOCTOU) during the walk/read surfaces as a clean usage error (exit 2)
  // rather than an uncaught throw escaping main().
  let skills;
  try {
    skills = collectSyncedSkills(opts.skillsRoots);
  } catch (error) {
    err.write(`error: failed to scan skills roots: ${error.message}\n`);
    return 2;
  }
  // With zero reimplementations there is trivially no drift, so succeed even if
  // the plugin cache is absent — a fresh CI runner with no synced skills (and
  // no cache yet) must not fail the build.
  if (skills.length === 0) {
    emitReport(out, buildReport([], opts), opts.json);
    return 0;
  }
  // There is ≥1 synced skill to resolve, so the cache is now required.
  if (!isDirectory(opts.cacheRoot)) {
    err.write(`error: --cache-root is not a directory: ${opts.cacheRoot}\n`);
    return 2;
  }
  let results;
  try {
    results = skills.map(skill => buildResult(skill, opts.cacheRoot));
  } catch (error) {
    err.write(`error: failed to resolve plugin versions: ${error.message}\n`);
    return 2;
  }
  emitReport(out, buildReport(results, opts), opts.json);
  return results.every(r => r.status === "ok") ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush (observed: a consumer's
  // $(...) capture stopped at the first 512-byte chunk). Setting exitCode lets
  // Node drain the streams before exiting with the same code.
  process.exitCode = main(process.argv.slice(2));
}
