/**
 * Fixtures shared by the gate-runner test files.
 *
 * Extracted for the same reason `lisa-gates-fixtures.ts` was: the project's own
 * max-lines gate caught the suite, which is the gate working.
 * @module tests/unit/scripts/lisa-run-gates-fixtures
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * One gate's resolved declaration plus the verdict the runner reached on it.
 *
 * Declared here because the module under test is a `.mjs` with no declaration
 * file, so TypeScript types the whole import as `any` and its JSDoc never
 * reaches the test. Annotating the results at the boundary is what stops that
 * `any` spreading into every callback below it.
 */
export type GateOutcome = {
  id: string;
  level: string;
  mode: string;
  awaits: string | null;
  task: string | null;
  command: string | null;
  label: string;
  work: string | null;
  state: string;
  detail: string;
  code: number | null;
};

/** What `runGates` reports about a whole moment. */
export type GateRun = {
  moment: string;
  blocked: boolean;
  total: number;
  results: GateOutcome[];
  passed: GateOutcome[];
  failed: GateOutcome[];
  skipped: GateOutcome[];
  notRun: GateOutcome[];
};

export const RUNNER = "bun run";
export const LINT_TASK = "lint";
export const LINT_COMMAND = `${RUNNER} ${LINT_TASK}`;
export const LEAKAGE = "credential-leakage";
export const LEAKAGE_COMMAND = `${RUNNER} security:check-for-leaks`;
export const FORMAT = "format-conformance";
export const STYLE = "code-style";
export const COMMIT = "commit";
export const PUSH = "push";
export const REQUIRED_AT_COMMIT = { commit: "required" };

export const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs"
);

/**
 * Run the real CLI in a throwaway project directory.
 *
 * Spawning is deliberate here and nowhere else: the hooks' fallback path is an
 * exit-code contract between two processes, and only a real process proves it.
 * No configuration passed in reaches a state where a gate command could run.
 * @param config Contents for `.lisa.config.json`, or null to omit the file.
 * @param moment The moment to ask for.
 * @returns The finished child process.
 */
export function runCli(
  config: string | null,
  moment: string
): SpawnSyncReturns<string> {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-run-gates-"));
  try {
    if (config !== null) {
      writeFileSync(path.join(root, ".lisa.config.json"), config);
    }
    return spawnSync(process.execPath, [SCRIPT, `--moment=${moment}`], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}
