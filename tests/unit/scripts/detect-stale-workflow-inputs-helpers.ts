/**
 * Shared fixtures, constants, and helpers for the
 * detect-stale-workflow-inputs unit tests. Mirrors the
 * `plugin-parity-drift-helpers.ts` convention.
 *
 * @module tests/unit/scripts/detect-stale-workflow-inputs-helpers
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import process from "node:process";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "detect-stale-workflow-inputs.mjs"
);
export const FIXTURES_ROOT = path.join(
  REPO_ROOT,
  "parity/fixtures/stale-workflow-inputs"
);
export const CONTRACTS_ROOT = path.join(FIXTURES_ROOT, "contracts");
export const PROJECT_VINTAGE = path.join(FIXTURES_ROOT, "project-vintage");
export const PROJECT_CURRENT = path.join(FIXTURES_ROOT, "project-current");
export const PROJECT_MIXED = path.join(FIXTURES_ROOT, "project-mixed");
export const PROJECT_NO_CALLER = path.join(FIXTURES_ROOT, "project-no-caller");
export const ABSENT_PROJECT = path.join(FIXTURES_ROOT, "does-not-exist");

export const PROJECT_FLAG = "--project";
export const CONTRACTS_FLAG = "--contracts-root";

// Literals repeated ≥3 times at assertion sites — hoisted to satisfy
// sonarjs/no-duplicate-string while keeping the expected values explicit.
export const CLAUDE_YML = ".github/workflows/claude.yml";
export const CLAUDE_CI_AUTO_FIX_YML =
  ".github/workflows/claude-ci-auto-fix.yml";
export const CLAUDE_UNKNOWN_YML = ".github/workflows/claude-unknown.yml";
export const REUSABLE_CLAUDE_YML = "reusable-claude.yml";

/** One classified row of the drift report (matches the script's shape). */
export interface StaleInputResult {
  readonly file: string;
  readonly project: string;
  readonly reusableFile: string;
  readonly ref: string;
  readonly withKeys: readonly string[];
  readonly staleInputs: readonly string[];
  readonly status: "ok" | "stale" | "unknown-contract";
}

/** The machine-readable report emitted with `--json`. */
export interface StaleInputReport {
  readonly schemaVersion: number;
  readonly contractsRoot: string;
  readonly projects: readonly string[];
  readonly summary: {
    readonly scanned: number;
    readonly ok: number;
    readonly stale: number;
    readonly unknownContract: number;
  };
  readonly results: readonly StaleInputResult[];
}

/**
 * Run the detector and capture stdout + exit code. `execFileSync` throws on a
 * non-zero exit, exposing `status` and `stdout` on the error object.
 *
 * @param args - CLI arguments after the script path.
 * @returns The exit code and parsed JSON report (empty when no stdout).
 */
export function runDetector(args: readonly string[]): {
  code: number;
  report: StaleInputReport;
} {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
    });
    return { code: 0, report: JSON.parse(stdout) as StaleInputReport };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    const stdout = e.stdout ?? "";
    return {
      code: typeof e.status === "number" ? e.status : -1,
      report: (stdout.trim() === ""
        ? {}
        : JSON.parse(stdout)) as StaleInputReport,
    };
  }
}

/**
 * Find a result row by its file path.
 *
 * @param report - the detector report.
 * @param file - the relative file path within the project.
 * @returns The matching result, or undefined.
 */
export const findResult = (
  report: StaleInputReport,
  file: string
): StaleInputResult | undefined => report.results.find(r => r.file === file);
