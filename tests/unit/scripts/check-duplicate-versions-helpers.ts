/**
 * Shared fixtures, constants, and helpers for the check-duplicate-versions
 * unit tests. Mirrors the `detect-stale-workflow-inputs-helpers.ts`
 * convention.
 *
 * @module tests/unit/scripts/check-duplicate-versions-helpers
 */
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import process from "node:process";

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "check-duplicate-versions.mjs"
);
export const FIXTURES_ROOT = path.join(
  REPO_ROOT,
  "tests/fixtures/duplicate-versions"
);
export const CLEAN_FIXTURE = path.join(FIXTURES_ROOT, "clean");
export const VIOLATION_FIXTURE = path.join(FIXTURES_ROOT, "violation");
export const EXCEPTION_FIXTURE = path.join(FIXTURES_ROOT, "exception");

export const ROOT_FLAG = "--root";
export const SCAN_FLAG = "--scan";
export const STRICT_FLAG = "--strict";
export const JSON_FLAG = "--json";
export const SCAN_ALL = ".";

// Literals repeated at several assertion sites — hoisted to satisfy
// sonarjs/no-duplicate-string while keeping expected values explicit.
export const WORKFLOW_FILE = ".github/workflows/quality.yml";
export const AST_GREP = "@ast-grep/cli";
export const AST_GREP_VERSION = "0.40.4";
export const BUN_VERSION = "1.3.8";
export const NODE_VERSION = "22.21.1";
/** The canonical package manifest's filename. */
export const PACKAGE_JSON = "package.json";
/** The violation fixture's own package name — a self-reference, never a duplicate. */
export const SELF_NAME = "duplicate-versions-violation-fixture";
export const MANIFEST_FIELD_AST_GREP =
  "package.json dependencies.@ast-grep/cli";
export const MANIFEST_FIELD_BUN = "package.json engines.bun";
export const MANIFEST_FIELD_NODE = "package.json engines.node";

/** An indented workflow toolchain pin, as it appears inside a `with:` block. */
export const INDENTED_BUN_PIN = `          bun-version: '${BUN_VERSION}'`;

/** One classified duplicate-version finding (matches the script's shape). */
export interface DuplicateFinding {
  readonly file: string;
  readonly line: number;
  readonly package: string;
  readonly version: string;
  readonly manifestVersion: string;
  readonly manifestField: string;
  readonly source: "install-pin" | "toolchain-pin";
  readonly status: "duplicate" | "drifted" | "allowed";
  readonly exception: string | null;
  readonly remediation: string;
}

/** The machine-readable report emitted with `--json`. */
export interface DuplicateReport {
  readonly schemaVersion: number;
  readonly mode: "advisory" | "strict";
  readonly root: string;
  readonly manifests: readonly string[];
  readonly scanned: readonly string[];
  readonly summary: {
    readonly files: number;
    readonly duplicate: number;
    readonly drifted: number;
    readonly allowed: number;
  };
  readonly findings: readonly DuplicateFinding[];
}

/**
 * Run the detector and capture stdout + exit code. `execFileSync` throws on a
 * non-zero exit, exposing `status` and `stdout` on the error object.
 *
 * @param args - CLI arguments after the script path.
 * @returns The exit code and raw stdout.
 */
export function runRaw(args: readonly string[]): {
  code: number;
  stdout: string;
} {
  try {
    return {
      code: 0,
      stdout: execFileSync(process.execPath, [SCRIPT, ...args], {
        encoding: "utf8",
      }),
    };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return {
      code: typeof e.status === "number" ? e.status : -1,
      stdout: e.stdout ?? "",
    };
  }
}

/**
 * Run the detector in `--json` mode against a fixture root.
 *
 * @param root - the fixture root directory.
 * @param extra - additional CLI arguments (e.g. `--strict`).
 * @returns The exit code and parsed report.
 */
export function runDetector(
  root: string,
  extra: readonly string[] = []
): { code: number; report: DuplicateReport } {
  const { code, stdout } = runRaw([
    ROOT_FLAG,
    root,
    SCAN_FLAG,
    SCAN_ALL,
    JSON_FLAG,
    ...extra,
  ]);
  return {
    code,
    report: (stdout.trim() === "" ? {} : JSON.parse(stdout)) as DuplicateReport,
  };
}

/**
 * Run the detector against Lisa's own repository root with its default scan
 * set — the advisory rollout the CI job performs.
 *
 * @returns The exit code and parsed report.
 */
export function runDetectorAtRepoRoot(): {
  code: number;
  report: DuplicateReport;
} {
  const { code, stdout } = runRaw([JSON_FLAG]);
  return { code, report: JSON.parse(stdout) as DuplicateReport };
}

/**
 * Find findings for a given package name.
 *
 * @param report - the detector report.
 * @param packageName - package or engine name to filter by.
 * @returns All matching findings.
 */
export const findingsFor = (
  report: DuplicateReport,
  packageName: string
): readonly DuplicateFinding[] =>
  report.findings.filter(f => f.package === packageName);
