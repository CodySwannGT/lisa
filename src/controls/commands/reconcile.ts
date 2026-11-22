/**
 * `lisa controls reconcile [path] [--platform]`: measure the distance
 * between the control register and what is installed in this checkout, in
 * both directions, and change nothing.
 *
 * ## What it prints
 *
 * One JSON document on stdout (`../reconcile-types.ts`): every enforcement
 * point the register claims and whether something runs the gate runner
 * there, every command the commit and push hooks run and which register
 * entries declare it, and the findings. The same findings are also given in
 * the audit report's finding shape, for the step that owns that report; this
 * command never writes the report. Lines for a person go to stderr, one per
 * finding.
 *
 * ## What it never does
 *
 * It writes no file and changes no setting. It runs nothing it finds in a
 * hook. Without `--platform` it sends no request anywhere.
 *
 * ## Exit codes
 *
 * - 0: everything that was needed was read. Findings, when there are any,
 *   are listed; a finding is something to look at, not a failure.
 * - 2: something that was needed could not be read: a hook file, or the
 *   hosting platform when `--platform` asked for it. The JSON document is
 *   complete for everything else and says which.
 * - 1: no result could be produced, because the register or the checkout's
 *   hooks could not be read at all; nothing is printed on stdout.
 * @module controls/commands/reconcile
 */
import path from "node:path";

import type { Command } from "commander";

import { resolveRepositoryRoot } from "../audit-report-file.js";
import { createCarrierGit } from "../carrier-git.js";
import {
  reconcileRepository,
  type ReconcileOptions,
  type ReconcileRun,
} from "../reconcile.js";
import { PLATFORM_FLAG, type ReconcileResult } from "../reconcile-types.js";
import { redactJsonCredentials } from "../secret-scan-json.js";

export type { ReconcileOptions } from "../reconcile.js";

/** The subcommand's name under `lisa controls`. */
export const RECONCILE_COMMAND = "reconcile";

/** The exit code when something that was needed could not be read. */
export const RECONCILE_INCOMPLETE_EXIT_CODE = 2;

/** What `--help` says after the options. */
export const RECONCILE_HELP_AFTER = `
Compares the control register with what is installed in this checkout, in
both directions, and changes nothing.

  Direction one  For every place the register says a rule is checked, is
                 something there that runs the gate runner? Commit and push
                 are answered by the carrier check of this checkout. A
                 pull-request pipeline file the register names is checked
                 for the runner's pull-request command, as text.
  Direction two  For every command the commit and push hooks run, does a
                 register entry declare it? A command is declared when an
                 entry's check at the same moment is that command, word for
                 word. Anything else is reported for a person to look at.

  It never  writes a file, changes a setting, or runs anything it finds.
  Without ${PLATFORM_FLAG} it sends no request anywhere. With it, it reads
  the checks the hosting platform requires before a merge (GitHub only).

Prints one JSON document on stdout. Exit codes:
  0  everything needed was read; findings, if any, are listed
  2  something needed could not be read (the JSON says which)
  1  no result could be produced`;

/** What the command needs from outside, each replaceable in a test. */
export interface ReconcileIo {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** The environment git runs in; the process's own when left out. */
  readonly env?: NodeJS.ProcessEnv;
  /** Where the JSON document goes. */
  readonly stdout?: (text: string) => void;
  /** Where the lines for a person go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Reads everything and compares. */
  readonly reconcile?: (
    root: string,
    options: ReconcileOptions
  ) => Promise<ReconcileRun>;
}

/** The word each outcome is announced with. */
const VERDICTS: Readonly<Record<ReconcileResult["outcome"], string>> = {
  "in-step": "PASS",
  findings: "FINDINGS",
  incomplete: "INCOMPLETE",
};

/**
 * The lines a person reads about a result.
 * @param result - The result
 * @returns The outcome first, then one line per finding, then anything else
 *   worth knowing about what was read
 */
function linesFor(result: ReconcileResult): readonly string[] {
  const noted = result.surfaces.flatMap(surface =>
    surface.detail !== null &&
    (surface.state === "could-not-read" ||
      surface.state === "not-asked" ||
      surface.surface === "register")
      ? [surface.detail]
      : []
  );
  return [
    `${VERDICTS[result.outcome]}. ${result.reason}`,
    ...result.findings.map(finding => `${finding.message} ${finding.next}`),
    ...noted,
  ].map(line => `${RECONCILE_COMMAND}: ${line}`);
}

/**
 * Reconcile the control register of one repository against what is
 * installed in this checkout.
 * @param targetPath - The repository; the working directory when left out
 * @param options - The command's options
 * @param io - Replaceable collaborators
 * @returns The exit code: 0 when everything needed was read, 2 when
 *   something was not, 1 when no result could be produced
 */
export async function runReconcile(
  targetPath: string | undefined,
  options: ReconcileOptions = {},
  io: ReconcileIo = {}
): Promise<number> {
  const stdout = io.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problems: readonly string[]): number => {
    redactJsonCredentials(problems).forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      `${RECONCILE_COMMAND}: FAIL. No result could be produced, and nothing was changed`
    );
    return 1;
  };

  const named = path.resolve(io.cwd ?? process.cwd(), targetPath ?? ".");
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail([
      `${targetPath ?? named} is not a folder. Give the path of the repository to reconcile.`,
    ]);
  }
  const reconcile =
    io.reconcile ??
    ((repository, chosen) =>
      reconcileRepository(repository, chosen, {
        git: createCarrierGit(io.env),
      }));
  try {
    const run = await reconcile(root, options);
    if (run.problems !== null) return fail(run.problems);
    const result = redactJsonCredentials(run.result);
    stdout(JSON.stringify(result, null, 2));
    linesFor(result).forEach(line => {
      stderr(line);
    });
    return result.outcome === "incomplete" ? RECONCILE_INCOMPLETE_EXIT_CODE : 0;
  } catch (error) {
    return fail([error instanceof Error ? error.message : String(error)]);
  }
}

/** The collaborator the registration needs, replaceable in a test. */
export interface ReconcileCommandDependencies {
  readonly runReconcile: (
    targetPath: string | undefined,
    options: ReconcileOptions
  ) => Promise<number>;
}

/**
 * Register `reconcile` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerReconcile(
  group: Command,
  dependencies: ReconcileCommandDependencies = {
    runReconcile: (targetPath, options) => runReconcile(targetPath, options),
  }
): void {
  group
    .command(RECONCILE_COMMAND)
    .description(
      "Compare the control register with what is installed in this checkout: report each place it says a rule is checked where nothing runs it, and each command a hook runs that it does not declare. Changes nothing"
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      PLATFORM_FLAG,
      "Also read which checks the hosting platform requires before a merge (GitHub only). Without it, nothing leaves this machine"
    )
    .addHelpText("after", RECONCILE_HELP_AFTER)
    .action(
      async (
        targetPath: string | undefined,
        options: { readonly platform?: boolean }
      ) => {
        const code = await dependencies.runReconcile(targetPath, {
          platform: options.platform === true,
        });
        if (code !== 0) process.exitCode = code;
      }
    );
}
