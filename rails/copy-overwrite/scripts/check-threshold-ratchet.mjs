#!/usr/bin/env node
/**
 * Threshold ratchet gate — quality thresholds may tighten, never weaken.
 *
 * Deterministic comparator shared by three enforcement layers:
 *   1. Agent-time soft block: PostToolUse hook via threshold-ratchet.sh
 *      (`--hook`, exit 2 on weakening so the agent gets actionable feedback).
 *   2. Pre-commit backstop: husky / lefthook (`--staged`, exit 1).
 *   3. CI gate: reusable quality workflows (`--base <ref>`, exit 1),
 *      comparing against the merge-base so nothing weakened lands in a PR.
 *
 * Tier 1 — designed tunables: vitest/jest/simplecov/e2e thresholds
 * (minimums) and eslint/rubocop thresholds (maximums). Tier 2 — stryker's
 * break score and k6 expression bounds. Tier 3 — exemption additions
 * (audit-ignore entries, stryker mutate exclusions, thresholdRatchet.allow
 * entries) which weaken a gate without touching a number.
 *
 * Human override: `.lisa.config.json` → `thresholdRatchet.allow` entries
 * ({ file, key, reason }). Honored ONLY from the baseline side (HEAD /
 * merge-base), never from the change under review — an agent cannot grant
 * itself an exception in the same change that weakens a gate. `key: "*"`
 * allows every key in the file.
 *
 * Extraction lives in threshold-ratchet-families.mjs; comparison rules in
 * threshold-ratchet-compare.mjs. Zero dependencies.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAllowEntries,
  familyFor,
  parseJson,
} from "./threshold-ratchet-families.mjs";
import {
  applyAllowList,
  compareFile,
  formatReport,
} from "./threshold-ratchet-compare.mjs";

/**
 * Standard git locations, checked in order so the executable comes from a
 * fixed, unwriteable directory rather than a PATH lookup. The bare "git"
 * fallback keeps unusual layouts (e.g. Windows git-bash) working.
 */
const GIT_LOCATIONS = [
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];
const GIT = GIT_LOCATIONS.find(candidate => fs.existsSync(candidate)) ?? "git";

/** Git flag shared by every changed-file listing. */
const NAME_ONLY = "--name-only";

/**
 * Run git, returning stdout or null on any failure.
 * @param {string[]} args Git arguments
 * @param {string} [cwd] Working directory
 * @returns {string | null} Captured stdout, or null when git failed
 */
function git(args, cwd) {
  try {
    return execFileSync(GIT, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * Resolve mode-specific candidate files and content readers.
 * @param {"hook"|"staged"|"base"} mode Comparison mode
 * @param {string} root Repo root
 * @param {string | undefined} baseRef Base ref (base mode only)
 * @param {string[] | undefined} onlyFiles Restrict to these repo-relative
 *   paths (hook mode with a known edited file)
 * @returns {{ files: string[], baselineRef: string, readCurrent: (f: string) => string | null } | null}
 *   The comparison plan, or null when git state can't support the mode
 */
function resolvePlan(mode, root, baseRef, onlyFiles) {
  if (mode === "staged") {
    const diff = git(["diff", "--cached", NAME_ONLY], root);
    if (diff === null) return null;
    return {
      files: diff.split("\n").filter(Boolean),
      baselineRef: "HEAD",
      readCurrent: f => git(["show", `:${f}`], root),
    };
  }
  if (mode === "base") {
    if (!baseRef) return null;
    const mergeBase = git(["merge-base", baseRef, "HEAD"], root)?.trim();
    if (!mergeBase) return null;
    const diff = git(["diff", NAME_ONLY, mergeBase, "HEAD"], root);
    if (diff === null) return null;
    return {
      files: diff.split("\n").filter(Boolean),
      baselineRef: mergeBase,
      readCurrent: f => git(["show", `HEAD:${f}`], root),
    };
  }
  const diff = git(["diff", NAME_ONLY, "HEAD"], root);
  if (diff === null) return null;
  return {
    files: onlyFiles ?? diff.split("\n").filter(Boolean),
    baselineRef: "HEAD",
    readCurrent: f => {
      try {
        return fs.readFileSync(path.join(root, f), "utf-8");
      } catch {
        return null;
      }
    },
  };
}

/**
 * Run the ratchet for a mode, print the report, and return the exit code.
 * @param {"hook"|"staged"|"base"} mode Comparison mode
 * @param {string | undefined} [baseRef] Base ref (base mode only)
 * @param {string[] | undefined} [onlyFiles] Restrict to these paths (hook mode)
 * @returns {number} Process exit code (2 for hook mode, 1 otherwise; 0 clean)
 */
function run(mode, baseRef, onlyFiles) {
  const root = git(["rev-parse", "--show-toplevel"])?.trim();
  if (!root) return 0;
  const plan = resolvePlan(mode, root, baseRef, onlyFiles);
  if (!plan) return 0;

  const watched = plan.files.filter(f => familyFor(f));
  if (watched.length === 0) return 0;

  const findings = watched.flatMap(f =>
    compareFile(
      f,
      git(["show", `${plan.baselineRef}:${f}`], root),
      plan.readCurrent(f)
    )
  );
  if (findings.length === 0) return 0;

  const baselineConfig = parseJson(
    git(["show", `${plan.baselineRef}:.lisa.config.json`], root)
  );
  const { blocked, allowed } = applyAllowList(
    findings,
    extractAllowEntries(baselineConfig)
  );
  for (const finding of allowed) {
    process.stdout.write(
      `threshold-ratchet: allowed by .lisa.config.json exception — ${finding.message}\n`
    );
  }
  if (blocked.length === 0) return 0;
  process.stderr.write(`${formatReport(blocked)}\n`);
  return mode === "hook" ? 2 : 1;
}

/**
 * Handle `--hook` mode: parse the tool-use event from stdin and scope the
 * check to the edited file (Edit/Write/NotebookEdit) or every changed
 * watched file (Bash).
 * @returns {number} Process exit code
 */
function runHookMode() {
  const state = { stdin: "" };
  try {
    state.stdin = fs.readFileSync(0, "utf-8");
  } catch {
    return 0;
  }
  const input = parseJson(state.stdin);
  if (!input || typeof input !== "object") return 0;
  if (input.tool_name === "Bash") return run("hook");
  if (!["Edit", "Write", "NotebookEdit"].includes(input.tool_name)) return 0;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string") return 0;
  const root = git(["rev-parse", "--show-toplevel"])?.trim();
  if (!root) return 0;
  const rel = path
    .relative(root, path.resolve(filePath))
    .split(path.sep)
    .join("/");
  if (rel.startsWith("..") || !familyFor(rel)) return 0;
  return run("hook", undefined, [rel]);
}

/**
 * CLI entrypoint.
 * @returns {number} Process exit code
 */
function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--staged") return run("staged");
  if (args[0] === "--base") return run("base", args[1]);
  if (args[0] === "--hook") return runHookMode();
  process.stderr.write(
    "usage: threshold-ratchet.mjs --hook | --staged | --base <ref>\n"
  );
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  process.exit(main());
}
