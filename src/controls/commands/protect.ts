/**
 * `lisa controls protect [path] [--apply] [--branch <name>] [--ruleset <name>]`:
 * make the hosting platform require the checks the control register derives,
 * or hand that change to an administrator.
 *
 * ## What it may send
 *
 * Without `--apply` the command only reads. It compares the repository's
 * merge protection with the register and, where they differ, writes
 * `.lisa/controls/merge-protection-change.md` for an administrator. With
 * `--apply` it changes the setting, and only when a read of the repository
 * has said the signed-in account administers it. On a platform other than
 * github.com it sends nothing in either mode. After a change it reads the
 * settings back, and anything but agreement is reported as blocked.
 *
 * ## What it prints
 *
 * One JSON document on stdout (`../protect-types.ts`), listing for each
 * register entry and each requirement it serves whether the platform now
 * requires its checks (`wired`) or not (`blocked`), and why. A line for a
 * person goes to stderr. The outcome is printed rather than written to a
 * file because it depends on who ran the command and on what the platform
 * said at that moment: it is the answer to one run, not a record of the
 * repository, and a file would be one more thing a second run changes.
 *
 * ## Exit codes
 *
 * - 0: every check is required (`wired`), or the register asks nothing of
 *   merge protection (`nothing-to-require`).
 * - 2: at least one entry is `blocked`. The JSON document is complete.
 * - 1: no result could be produced; nothing is printed on stdout.
 * @module controls/commands/protect
 */
import path from "node:path";

import type { Command } from "commander";

import { resolveRepositoryRoot } from "../audit-report-file.js";
import {
  protectRepository,
  type ProtectOptions,
  type ProtectRun,
} from "../protect.js";
import { MERGE_PROTECTION_CHANGE_PATH } from "../protect-types.js";

/** The subcommand's name under `lisa controls`. */
export const PROTECT_COMMAND = "protect";

/** The exit code when at least one entry is blocked. */
export const PROTECT_BLOCKED_EXIT_CODE = 2;

/** What `--help` says after the options. */
export const PROTECT_HELP_AFTER = `
Reads only, unless --apply is given:
  without --apply  reads the platform, compares, and writes
                   ${MERGE_PROTECTION_CHANGE_PATH} for an administrator when
                   something is not required. Nothing on the platform changes.
  with --apply     also changes the setting, but only on github.com and only
                   after a read has confirmed that the signed-in account has
                   administrator access. Then reads the settings back.
  any other hosting platform: nothing is sent; the file is written.

A check is only ever made required once the platform shows a result under its
name, from the source that would be required to report it, on the branch
itself or on a pull request that was merged into it. An open pull request, or
one closed without being merged, does not count. One that has not run yet is
reported as not-ready and is left out of the change.

A check that is already required is never changed: when the platform accepts
it only from one app, no change this command sends drops or swaps that app.

Prints one JSON document on stdout. Exit codes:
  0  every derived check is required, or the register asks for none
  2  at least one register entry is blocked (the JSON says which and why)
  1  no result could be produced`;

/** What the command needs from outside, each replaceable in a test. */
export interface ProtectCommandIo {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** Where the JSON document goes. */
  readonly stdout?: (text: string) => void;
  /** Where the line for a person and any problems go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Runs the comparison and, when allowed, the change. */
  readonly protect?: (
    root: string,
    options: ProtectOptions
  ) => Promise<ProtectRun>;
}

/**
 * Compare, and when asked and allowed change, one repository's merge
 * protection.
 * @param targetPath - The repository; the working directory when left out
 * @param options - The command's options
 * @param io - Replaceable collaborators
 * @returns The exit code: 0 wired or nothing to require, 2 blocked, 1 when no
 *   result could be produced
 */
export async function runProtect(
  targetPath: string | undefined,
  options: ProtectOptions = {},
  io: ProtectCommandIo = {}
): Promise<number> {
  const stdout = io.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problems: readonly string[]): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      "protect: FAIL. No result could be produced, and nothing was sent to the hosting platform or written"
    );
    return 1;
  };

  const named = path.resolve(io.cwd ?? process.cwd(), targetPath ?? ".");
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail([
      `${targetPath ?? named} is not a folder. Give the path of the repository to protect.`,
    ]);
  }
  const run = await (io.protect ?? protectRepository)(root, options);
  if (run.problems !== null) return fail(run.problems);

  const { result } = run;
  const blocked = result.outcome === "blocked";
  const handover =
    result.handover.action === "written" ||
    result.handover.action === "unchanged"
      ? ` See ${result.handover.path}`
      : "";
  stdout(JSON.stringify(result, null, 2));
  stderr(
    `protect: ${blocked ? "BLOCKED" : "PASS"}. ${result.reason}${handover}`
  );
  return blocked ? PROTECT_BLOCKED_EXIT_CODE : 0;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface ProtectCommandDependencies {
  readonly runProtect: (
    targetPath: string | undefined,
    options: ProtectOptions
  ) => Promise<number>;
}

/**
 * Register `protect` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerProtect(
  group: Command,
  dependencies: ProtectCommandDependencies = {
    runProtect: (targetPath, options) => runProtect(targetPath, options),
  }
): void {
  group
    .command(PROTECT_COMMAND)
    .description(
      `Compare the hosting platform's required checks with the control register and write ${MERGE_PROTECTION_CHANGE_PATH} for an administrator; reads only unless --apply is given`
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      "--apply",
      "Change the repository's merge protection on github.com so that it requires the derived checks. Sent only after a read confirms the signed-in account has administrator access; without this flag nothing is ever changed"
    )
    .option(
      "--branch <name>",
      "The branch to protect (default: the repository's default branch)"
    )
    .option(
      "--ruleset <name>",
      "The ruleset that should hold the checks, when more than one could"
    )
    .addHelpText("after", PROTECT_HELP_AFTER)
    .action(
      async (
        targetPath: string | undefined,
        options: {
          readonly apply?: boolean;
          readonly branch?: string;
          readonly ruleset?: string;
        }
      ) => {
        const code = await dependencies.runProtect(targetPath, {
          apply: options.apply === true,
          branch: options.branch,
          ruleset: options.ruleset,
        });
        if (code !== 0) process.exitCode = code;
      }
    );
}
