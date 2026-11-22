/**
 * Running `lisa controls attest` in-process against fixture repositories,
 * for the suite that checks what it prints and what it refuses
 * (CodySwannGT/lisa#4995).
 * @module tests/unit/controls/support/attest-run
 */
import { expect } from "vitest";

import { runAttest } from "../../../../src/controls/commands/attest.js";
import {
  directProofWorkspace,
  type OpenProofWorkspace,
} from "../../../../src/controls/proof-workspace.js";
import { steppingClock, type ProofSetting } from "./proof-run.js";
import type { Run } from "./report-check-run.js";

/** The requirements whose empty evidence route the operator sees in a table. */
export const UNMAPPED_EVIDENCE_NOTES = (
  [
    ["AC5.1", "observed"],
    ["AC5.2", "exercised"],
    ["AC8.2", "exercised"],
    ["AC8.5", "observed"],
    ["AC8.6", "exercised"],
    ["AC8.8", "observed"],
    ["SI10", "exercised"],
    ["UX2", "exercised"],
    ["UX4", "observed"],
  ] as const
).map(([criterion, rung]) =>
  expect.stringMatching(
    new RegExp(
      `^attest: ${criterion.replace(".", "\\.")} needs evidence\\. .+ The minimum evidence rung is ${rung}\\.$`,
      "u"
    )
  )
);

/**
 * Run the command in-process and capture what it prints.
 *
 * Naming a folder in `options.workspace` is what an operator does with
 * `--workspace`, and makes the run a report that writes nothing. A case that
 * needs the command to write its results down uses {@link attestAndRecord}.
 * @param target - The path argument, as an operator would type it
 * @param options - The command's options
 * @param options.workspace - The folder named with `--workspace`
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

/**
 * A stand-in for the disposable copy the command makes for itself.
 *
 * With no folder named, the command builds a clone, installs the carriers
 * there and proves each check through a real commit or push; the suites
 * about that copy run it for real. The suites about what the command prints
 * and writes down afterwards do not need a clone per case, so they hand the
 * command this opener instead: the case's own copy of the fixture, with each
 * check's command started in it.
 * @param where - The repository and the case's copy of it
 * @returns The opener
 */
export function standInCopy(where: ProofSetting): OpenProofWorkspace {
  return request =>
    Promise.resolve({
      problem: null,
      workspace: directProofWorkspace(where.workspace, request.tools),
      close: () => undefined,
    });
}

/**
 * Run the command in-process the way it records its results: no folder is
 * named, and {@link standInCopy} takes the place of the copy it would build.
 * @param where - The repository and the case's copy of it
 * @param options - The command's options
 * @param options.json - Print the results as JSON
 * @returns Exit code and printed lines
 */
export async function attestAndRecord(
  where: ProofSetting,
  options: { readonly json?: boolean } = {}
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runAttest(where.repoPath, options, {
    clock: steppingClock(),
    openWorkspace: standInCopy(where),
    stdout: line => {
      stdout.push(line);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}
