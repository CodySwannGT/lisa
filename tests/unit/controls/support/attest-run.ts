/**
 * Running `lisa controls attest` in-process against fixture repositories,
 * for the suite that checks what it prints and what it refuses
 * (CodySwannGT/lisa#4995).
 * @module tests/unit/controls/support/attest-run
 */
import { runAttest } from "../../../../src/controls/commands/attest.js";
import { steppingClock } from "./proof-run.js";
import type { Run } from "./report-check-run.js";

/**
 * Run the command in-process and capture what it prints.
 * @param target - The path argument, as an operator would type it
 * @param options - The command's options
 * @param options.workspace - The disposable copy
 * @param options.json - Print the results as JSON
 * @param cwd - The directory the command is run from
 * @returns Exit code and printed lines
 */
export async function attest(
  target: string | undefined,
  options: { readonly workspace?: string; readonly json?: boolean } = {},
  cwd?: string
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runAttest(target, options, {
    ...(cwd === undefined ? {} : { cwd }),
    clock: steppingClock(),
    stdout: line => {
      stdout.push(line);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}
