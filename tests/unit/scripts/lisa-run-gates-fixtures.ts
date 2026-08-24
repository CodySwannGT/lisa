/**
 * Fixtures shared by the gate-runner test files.
 *
 * Extracted for the same reason `lisa-gates-fixtures.ts` was: the project's own
 * max-lines gate caught the suite, which is the gate working.
 * @module tests/unit/scripts/lisa-run-gates-fixtures
 */

import { type SpawnSyncReturns } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

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
  /** Which failure this was, from `DIAGNOSIS`; null unless it failed. */
  diagnosis?: string | null;
  /** Concrete lines backing the diagnosis. */
  evidence?: string[];
  /** The gate whose property the failure belongs to, from `ATTRIBUTION`. */
  proves?: string | null;
  /** The gate whose run proved this one, when they share a command. */
  provedBy: string | null;
};

/** What `runGates` reports about a whole moment. */
export type GateRun = {
  moment: string;
  blocked: boolean;
  /** The first required gate that went unproved, or null when none did. */
  blockedBy: string | null;
  total: number;
  results: GateOutcome[];
  passed: GateOutcome[];
  failed: GateOutcome[];
  /** Ran and proved nothing — a shared prover failed on another property. */
  unprovable: GateOutcome[];
  /** Terminated by a signal, so the command never reached a verdict. */
  killed: GateOutcome[];
  skipped: GateOutcome[];
  notRun: GateOutcome[];
};

export const RUNNER = "bun run";
export const LINT_TASK = "lint";
export const LINT_COMMAND = `${RUNNER} ${LINT_TASK}`;
export const LEAKAGE = "credential-leakage";
export const LEAKAGE_COMMAND = `${RUNNER} security:check-for-leaks`;
export const FORMAT = "format-conformance";
export const STRUCTURAL = "structural-rules";
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
 * @param files Extra files to place, keyed by path relative to the project
 *   root. The conditional floor is decided by what a project has wired, so
 *   proving it needs a project that has wired something.
 * @returns The finished child process.
 */
export function runCli(
  config: string | null,
  moment: string,
  files: Record<string, string> = {}
): SpawnSyncReturns<string> {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-run-gates-"));
  try {
    if (config !== null) {
      writeFileSync(path.join(root, ".lisa.config.json"), config);
    }
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(root, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    return boundedSpawnSync({
      label: `lisa-run-gates.mjs --moment=${moment}`,
      command: process.execPath,
      args: [SCRIPT, `--moment=${moment}`],
      cwd: root,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

/**
 * A recording executor that answers from a fixed map of command → exit code.
 * @param codes Exit code per command; anything unlisted passes.
 * @returns The executor plus the commands it was actually asked to run.
 */
export function stubExec(codes: Record<string, number | null>): {
  exec: (command: string) => number | null;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    exec: (command: string): number | null => {
      // A recorder exists to accumulate. Rebinding a new array each call would
      // make `calls` a snapshot the caller already holds, so it would record
      // nothing — the mutation is the whole mechanism, confined to this stub.
      // eslint-disable-next-line functional/immutable-data -- accumulating is the mechanism
      calls.push(command);
      const code = codes[command];
      // `=== undefined`, never `?? 0`: a stubbed `null` means "killed by a
      // signal", and `??` would quietly turn that into a passing gate —
      // reproducing inside the test harness the exact defect under test.
      return code === undefined ? 0 : code;
    },
  };
}

/**
 * Collects the runner's operator-facing output for assertion.
 * @returns The collected lines plus the sink to hand the runner.
 */
export function sink(): { lines: string[]; out: (line: string) => void } {
  const lines: string[] = [];
  // Accumulates for the same reason `stubExec` does; see the note there.
  // eslint-disable-next-line functional/immutable-data -- accumulating is the mechanism
  return { lines, out: (line: string) => lines.push(line) };
}
