/**
 * Shared fixtures for the postinstall reconciliation trampoline unit suites:
 * fake project paths, lockfile names, and the reporting payload handed to
 * scheduleReconciliationChild.
 * @module tests/unit/utils/postinstall-trampoline-fixtures
 */

// Use project-local paths (not /tmp/*) to avoid sonarjs's publicly-writable-directory
// warnings. These are never actually read/written — they are fixtures passed to
// spawn for assertion purposes.
export const FAKE_PROJECT_DIR = "./fake/project";
export const FAKE_LISA_DIST = "./fake/lisa/dist";
export const FAKE_PACKAGE_JSON_PATH = "./fake/project/package.json";

// Lockfile base names used across detection, plan, and hash tests. Named constants
// silence sonarjs/no-duplicate-string and make the intent obvious at call sites.
export const BUN_LOCK = "bun.lock";
export const BUN_LOCKB = "bun.lockb";
export const NPM_LOCK = "package-lock.json";
export const PNPM_LOCK = "pnpm-lock.yaml";
export const YARN_LOCK = "yarn.lock";
export const IGNORE_SCRIPTS = "--ignore-scripts";
export const INSTALL_CMD = "install";
export const PACKAGE_JSON = "package.json";

// A sibling project's directory, used to simulate the poisoned env a concurrent
// install leaves behind (the cross-project corruption regression). Named so the
// duplicate string does not trip sonarjs/no-duplicate-string.
export const SIBLING_PROJECT_DIR = "/Users/dev/workspace/advisory-rankings";

/**
 * Type alias for the spawn DI seam used in scheduleReconciliationChild and
 * regenerateLockfilesInProcess. Hoisted so individual tests don't duplicate
 * the `typeof import("node:child_process").spawn` literal (sonarjs flags >3).
 */
export type SpawnFn = typeof import("node:child_process").spawn;

/**
 * Reporting fixture handed to scheduleReconciliationChild. Carries the report
 * path/schema the child writes and the pre-apply package.json baseline it
 * compares against — the gate CodySwannGT/lisa#2750 turned on.
 */
export const FAKE_REPORT_PATH =
  "./fake/project/.lisa/reconciliation-report.json";
export const FAKE_BASELINE_HASH = "baseline-sha256-of-package-json";
export const FAKE_REPORTING = {
  reportPath: FAKE_REPORT_PATH,
  reportSchemaVersion: 1,
  lisaVersion: "9.9.9",
  baselinePackageJsonHash: FAKE_BASELINE_HASH,
} as const;
