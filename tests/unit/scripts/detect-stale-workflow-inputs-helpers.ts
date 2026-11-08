/**
 * Shared fixtures, constants, and helpers for the
 * detect-stale-workflow-inputs unit tests. Mirrors the
 * `plugin-parity-drift-helpers.ts` convention.
 *
 * @module tests/unit/scripts/detect-stale-workflow-inputs-helpers
 */
import * as path from "node:path";
import process from "node:process";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
const SCRIPT_NAME = "detect-stale-workflow-inputs.mjs";
export const SCRIPT = path.join(REPO_ROOT, "scripts", SCRIPT_NAME);
export const FIXTURES_ROOT = path.join(
  REPO_ROOT,
  "parity/fixtures/stale-workflow-inputs"
);
export const CONTRACTS_ROOT = path.join(FIXTURES_ROOT, "contracts");
export const PROJECT_VINTAGE = path.join(FIXTURES_ROOT, "project-vintage");
export const PROJECT_CURRENT = path.join(FIXTURES_ROOT, "project-current");
export const PROJECT_MIXED = path.join(FIXTURES_ROOT, "project-mixed");
export const PROJECT_NO_CALLER = path.join(FIXTURES_ROOT, "project-no-caller");
export const PROJECT_PINNED_STALE = path.join(
  FIXTURES_ROOT,
  "project-pinned-stale"
);
export const PROJECT_UNPARSED = path.join(FIXTURES_ROOT, "project-unparsed");
export const PROJECT_THIRD_PARTY = path.join(
  FIXTURES_ROOT,
  "project-third-party"
);
export const ABSENT_PROJECT = path.join(FIXTURES_ROOT, "does-not-exist");

export const PROJECT_FLAG = "--project";
export const CONTRACTS_FLAG = "--contracts-root";

// Literals repeated ≥3 times at assertion sites — hoisted to satisfy
// sonarjs/no-duplicate-string while keeping the expected values explicit.
export const EXAMPLE_AGENT_YML = ".github/workflows/example-agent.yml";
export const EXAMPLE_AUTO_FIX_YML = ".github/workflows/example-auto-fix.yml";
export const EXAMPLE_UNKNOWN_YML = ".github/workflows/example-unknown.yml";
export const REUSABLE_EXAMPLE_AGENT_YML = "reusable-example.yml";

/** One classified row of the drift report (matches the script's shape). */
export interface StaleInputResult {
  readonly file: string;
  readonly project: string;
  readonly reusableFile: string | null;
  readonly ref: string | null;
  readonly withKeys: readonly string[];
  readonly staleInputs: readonly string[];
  readonly status: "ok" | "stale" | "unknown-contract" | "unparsed";
  /** 1-based line of the unreadable `uses:` line; only on `unparsed` rows. */
  readonly line?: number;
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
    readonly unparsed: number;
  };
  readonly results: readonly StaleInputResult[];
}

/**
 * Run the detector and capture stdout + exit code. `boundedExecFileSync`
 * throws on a non-zero exit, exposing `exitCode` and `stdout` on the error.
 *
 * @param args - CLI arguments after the script path.
 * @returns The exit code and parsed JSON report (empty when no stdout).
 */
export function runDetector(args: readonly string[]): {
  code: number;
  report: StaleInputReport;
} {
  try {
    const stdout = boundedExecFileSync({
      label: SCRIPT_NAME,
      command: process.execPath,
      args: [SCRIPT, ...args],
    });
    return { code: 0, report: JSON.parse(stdout) as StaleInputReport };
  } catch (error) {
    const e = error as { exitCode?: number; stdout?: string };
    const stdout = e.stdout ?? "";
    return {
      code: typeof e.exitCode === "number" ? e.exitCode : -1,
      report: (stdout.trim() === ""
        ? {}
        : JSON.parse(stdout)) as StaleInputReport,
    };
  }
}

/**
 * Run the detector without `--json` and capture the human-readable table.
 *
 * @param args - CLI arguments after the script path.
 * @returns The exit code and raw stdout.
 */
export function runDetectorText(args: readonly string[]): {
  code: number;
  stdout: string;
} {
  try {
    const stdout = boundedExecFileSync({
      label: SCRIPT_NAME,
      command: process.execPath,
      args: [SCRIPT, ...args],
    });
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { exitCode?: number; stdout?: string };
    return {
      code: typeof e.exitCode === "number" ? e.exitCode : -1,
      stdout: e.stdout ?? "",
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
