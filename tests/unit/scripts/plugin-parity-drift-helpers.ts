/**
 * Shared fixtures, constants, and helpers for the plugin-parity-drift unit
 * tests. Extracted from the test file to keep it under the max-lines budget and
 * to mirror the repo's `cursor-artifact-helpers.ts` convention.
 *
 * @module tests/unit/scripts/plugin-parity-drift-helpers
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import process from "node:process";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "plugin-parity-drift.mjs"
);
export const CACHE_ROOT = path.join(REPO_ROOT, "parity/fixtures/drift/cache");
export const SKILLS_ROOT = path.join(REPO_ROOT, "parity/fixtures/drift/skills");
export const STALE_SKILL = path.join(SKILLS_ROOT, "code-simplifier/SKILL.md");
export const ABSENT_CACHE = path.join(
  REPO_ROOT,
  "parity/fixtures/drift/does-not-exist"
);

// Literals repeated ≥3 times at assertion sites — hoisted to satisfy
// sonarjs/no-duplicate-string while keeping the expected values explicit.
export const CACHE_FLAG = "--cache-root";
export const SKILLS_FLAG = "--skills-root";
export const MARKETPLACE = "claude-plugins-official";
export const SIMPLIFIER = "code-simplifier";
export const RC_VERSION = "1.0.0-rc.1";
export const NOT_INSTALLED = "not-installed";
export const UNRESOLVED = "unresolved";
export const UNRESOLVED_PLUGIN = "unresolved-plugin";
export const SIMPLIFIER_ID = `${SIMPLIFIER}@${MARKETPLACE}`;
export const CODERABBIT_ID = `coderabbit@${MARKETPLACE}`;

/** One classified row of the drift report (matches the script's §3.5 shape). */
export interface DriftResult {
  readonly skillPath: string;
  readonly plugin: string;
  readonly pinnedVersion: string | null;
  readonly currentVersion: string | null;
  readonly status: string;
}

/** The machine-readable drift report emitted with `--json`. */
export interface DriftReport {
  readonly schemaVersion: number;
  readonly summary: {
    readonly scanned: number;
    readonly ok: number;
    readonly drift: number;
  };
  readonly results: readonly DriftResult[];
}

/**
 * Run the drift script and capture stdout + exit code. `execFileSync` throws on
 * a non-zero exit, exposing `status` and `stdout` on the error object.
 *
 * @param args - CLI arguments after the script path.
 * @returns The exit code and parsed JSON report (empty when no stdout).
 */
export function runDrift(args: readonly string[]): {
  code: number;
  report: DriftReport;
} {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
    });
    return { code: 0, report: JSON.parse(stdout) as DriftReport };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    const stdout = e.stdout ?? "";
    return {
      code: typeof e.status === "number" ? e.status : -1,
      report: (stdout.trim() === "" ? {} : JSON.parse(stdout)) as DriftReport,
    };
  }
}

/**
 * Find a result row by its canonical plugin id.
 *
 * @param report - the drift report.
 * @param plugin - the canonical `name@marketplace` id.
 * @returns The matching result, or undefined.
 */
export const findResult = (
  report: DriftReport,
  plugin: string
): DriftResult | undefined => report.results.find(r => r.plugin === plugin);

/**
 * Write a one-skill skills root in a temp dir whose SKILL.md carries the given
 * frontmatter lines, returning the temp root. Caller cleans it up.
 *
 * @param frontmatterLines - YAML frontmatter lines (between the `---` fences).
 * @returns The created temp skills-root directory.
 */
export function makeTempSkill(frontmatterLines: readonly string[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "drift-fixture-"));
  const skillDir = path.join(root, "skill");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    ["---", ...frontmatterLines, "---", "body", ""].join("\n"),
    "utf8"
  );
  return root;
}
