/**
 * Shared fixtures for the two guards that must learn to see EXECUTED scripts —
 * `block-no-verify.sh` and `block-managed-file-edits.sh`.
 *
 * The distinction every case here turns on is one question asked of a path:
 * is it an ARGUMENT TO a command, or the THING BEING EXECUTED?
 * `grep -n foo bar.sh` reads; `bash bar.sh` runs. Only the second may have its
 * contents attributed to the command.
 *
 * That rule is not invented here. `parity-safety-net.sh` already states it —
 * "Only a COMMAND POSITION can execute something. A path anywhere else is an
 * argument, and an argument is data (#3604)" — and names the opposite fix as
 * known-wrong. A sibling guard nonetheless opens any readable file named by any
 * token, which is the over-blocking half of the same classify step.
 *
 * So every acceptance case below is PAIRED with a rejection control. A suite
 * that only asserts good commands pass is satisfied by a guard that trusts
 * everything, which is exactly how an earlier fail-open survived its own tests.
 *
 * Not named `*.test.ts`, so vitest collects nothing from it.
 * @module tests/unit/hooks/support/executed-script-reach
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";

/** Claude's refusal code. Anything else lets the command through. */
export const EXIT_BLOCKED = 2;
export const EXIT_ALLOWED = 0;

/** Absolute interpreter path; resolving `bash` through PATH is not permitted. */
export const BASH_PATH = "/bin/bash";

/** The first line of every script fixture. */
export const SHEBANG = "#!/usr/bin/env bash";

/**
 * Resolve a guard as it lives in the plugin SOURCE.
 *
 * The source tree is the one a fix edits; `plugins/lisa/hooks/` and the other
 * shipped copies are regenerated from it by `bun run build:plugins`. Pointing
 * the suite at a generated copy would let a source fix pass while the shipped
 * guard stayed broken, which is the regeneration gap that leaves consumers on
 * the old version.
 * @param name - The hook's file name.
 * @returns The absolute path to the source guard.
 */
export const sourceGuard = (name: string): string =>
  path.resolve("plugins/src/base/hooks", name);

/**
 * A throwaway directory to hold script fixtures.
 * @param prefix - A label for the directory name.
 * @returns The directory path.
 */
export const scratchDir = (prefix: string): string =>
  mkdtempSync(path.join(tmpdir(), `lisa-${prefix}-`));

/**
 * Write a script fixture and return its absolute path.
 * @param dir - The directory to write into.
 * @param name - The file name.
 * @param lines - The script body, one entry per line.
 * @returns The absolute path written.
 */
export const script = (
  dir: string,
  name: string,
  lines: readonly string[]
): string => {
  const target = path.join(dir, name);
  writeFileSync(target, `${[SHEBANG, ...lines].join("\n")}\n`, "utf-8");
  return target;
};

/**
 * A PreToolUse Bash payload.
 * @param command - The shell command the agent is attempting.
 * @returns The payload object.
 */
export const bash = (command: string) => ({
  tool_name: "Bash",
  tool_input: { command },
});

/**
 * Run a guard against a PreToolUse payload.
 * @param guard - Absolute path to the hook under test.
 * @param payload - The JSON given on stdin.
 * @param options - Overrides for the run.
 * @param options.cwd - Working directory for the hook process.
 * @param options.env - Environment entries layered over the process env.
 * @returns Exit status and stderr.
 */
export const runGuard = (
  guard: string,
  payload: unknown,
  options: { cwd?: string; env?: Readonly<Record<string, string>> } = {}
): { status: number | null; stderr: string } => {
  const result = boundedSpawnSync({
    label: path.basename(guard),
    command: BASH_PATH,
    args: [guard],
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    input: JSON.stringify(payload),
  });
  return { status: result.status, stderr: result.stderr };
};
