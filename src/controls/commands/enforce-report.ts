/**
 * `lisa controls enforce-report [path] --carriers <file> --tickets <file>
 * --protect <file>`: say exactly one thing about every Level 1 requirement,
 * from what the three steps of the enforce run reported.
 *
 * ## What it is handed
 *
 * The carriers step and the merge-protection step print one JSON document
 * each and keep nothing, and an agent carries out the ticket flow. The
 * enforce step saves each result in a file outside the repository and names
 * the three files here. A file that is absent, empty or of the wrong shape
 * stops the command (`../enforce-inputs.ts`), and so does a carriers result
 * that is the output of a `--check` run, which installed nothing.
 *
 * The carriers result is not believed on its own. The command reads the
 * checkout's carriers again, writing nothing, and a check is reported as
 * running at commit, at push or after an edit only when that read finds what
 * runs it in place now (`../enforce-carriers.ts`).
 *
 * ## What it prints
 *
 * One JSON document on stdout (`../enforce-types.ts`): one outcome per
 * requirement (`wired`, `ticketed`, `blocked` or `nothing-to-enforce`), the
 * register entries behind them, the required checks that fail on the head
 * of the default branch with what their commands printed, what the steps of
 * this run changed, and what the result does not show. Lines for a person
 * go to stderr: the summary, one line for each check that fails on the
 * default branch, and one line for each check that gave no answer there,
 * so that a run which measured nothing is never read as a run that found
 * nothing failing.
 *
 * ## What it changes
 *
 * Nothing. It writes no file in the repository and sends no request. The
 * required checks are run once, in a temporary copy of the default branch's
 * last commit that is removed on every way out.
 *
 * ## Exit codes
 *
 * - 0: every requirement has exactly one outcome, and the document was
 *   printed. A requirement that is waiting on somebody, and a check that
 *   fails on the default branch, are results, not failures.
 * - 1: no result could be produced: a result file, the audit report or the
 *   register could not be relied on, or a requirement came out with no
 *   outcome or with two. Nothing is printed on stdout.
 * @module controls/commands/enforce-report
 */
import path from "node:path";

import type { Command } from "commander";

import { resolveRepositoryRoot } from "../audit-report-file.js";
import type { EnforceInputPaths } from "../enforce-inputs.js";
import {
  buildEnforceReport,
  type EnforceReportRun,
} from "../enforce-report.js";
import type { EnforceReport } from "../enforce-types.js";

/** The subcommand's name under `lisa controls`. */
export const ENFORCE_REPORT_COMMAND = "enforce-report";

/** What `--help` says after the options. */
export const ENFORCE_REPORT_HELP_AFTER = `
Reads what the three steps of the enforce run reported and says one thing
about every Level 1 requirement:

  wired               a declared check serves it, and every place the enforce
                      step is answerable for now runs that check
  ticketed            the repository has nothing for it, and a ticket exists
  blocked             somebody has to act first; the reason says who and what
  nothing-to-enforce  nothing to install, file or wait for: it does not apply,
                      it is met by a written record or a person's word, or
                      what checks it is something a Lisa project type runs

A check with no moment to run at counts for nothing. A requirement that
needs a check takes the outcome of another declared check that serves it;
when there is none, it is blocked until the configure step chooses when the
check runs. It is never nothing-to-enforce for having a check nothing runs.

It also runs each required check once in a temporary copy of the default
branch's last commit, and lists the ones that fail there with their output
and the ones that gave no answer there.

It writes nothing in the repository and sends no request. Save the result of
each step in a file outside the repository and name the three files. The
carriers file must be what "lisa controls install-carriers" printed without
--check, and the checkout is read again to confirm what it says.

Prints one JSON document on stdout. Exit codes:
  0  every requirement has exactly one outcome
  1  no result could be produced (the reasons are on stderr)`;

/** What the command needs from outside, each replaceable in a test. */
export interface EnforceReportIo {
  /** The directory every path argument is resolved from. */
  readonly cwd?: string;
  /** Where the JSON document goes. */
  readonly stdout?: (text: string) => void;
  /** Where the lines for a person go, one per call. */
  readonly stderr?: (line: string) => void;
  /** Builds the report. */
  readonly build?: (
    root: string,
    paths: EnforceInputPaths
  ) => Promise<EnforceReportRun>;
}

/**
 * The lines a person reads about a report.
 * @param report - The report
 * @returns The summary, then one line per check that fails on the default
 *   branch, then one line per check that gave no answer there
 */
function linesFor(report: EnforceReport): readonly string[] {
  const { currently_failing: failing } = report;
  const branch = failing.head?.branch ?? "the default branch";
  return [
    `${ENFORCE_REPORT_COMMAND}: PASS. ${report.reason}`,
    ...failing.gates.map(
      gate =>
        `${ENFORCE_REPORT_COMMAND}: ${gate.gate} in ${gate.scope === "." ? "the whole repository" : gate.scope} does not pass on ${branch} as it stands (exit ${String(gate.exit_status)}). Its output is in the report.`
    ),
    ...failing.not_measured.map(
      gate =>
        `${ENFORCE_REPORT_COMMAND}: ${gate.entry_id} gave no answer on ${branch}, so it is not known whether it passes there. ${gate.reason}`
    ),
    ...(failing.measured
      ? []
      : [
          `${ENFORCE_REPORT_COMMAND}: the required checks were not run on the default branch. ${failing.reason}`,
        ]),
  ];
}

/**
 * Resolve the paths of the result files from the working directory.
 * @param cwd - The directory relative paths are resolved from
 * @param paths - The paths as they were given
 * @returns Each given path made absolute; one left out stays left out
 */
function resolved(cwd: string, paths: EnforceInputPaths): EnforceInputPaths {
  const absolute = (file: string | undefined): string | undefined =>
    file === undefined || file.trim() === "" ? file : path.resolve(cwd, file);
  return {
    carriers: absolute(paths.carriers),
    protect: absolute(paths.protect),
    tickets: absolute(paths.tickets),
  };
}

/**
 * Print the enforce report of one repository.
 * @param targetPath - The repository; the working directory when left out
 * @param paths - Where the three results were saved
 * @param io - Replaceable collaborators
 * @returns The exit code: 0 when the report was printed, 1 when no result
 *   could be produced
 */
export async function runEnforceReport(
  targetPath: string | undefined,
  paths: EnforceInputPaths,
  io: EnforceReportIo = {}
): Promise<number> {
  const stdout = io.stdout ?? (text => process.stdout.write(`${text}\n`));
  const stderr = io.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problems: readonly string[]): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      `${ENFORCE_REPORT_COMMAND}: FAIL. No outcome was reported for any requirement, and nothing was written`
    );
    return 1;
  };

  const cwd = io.cwd ?? process.cwd();
  const named = path.resolve(cwd, targetPath ?? ".");
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail([
      `${targetPath ?? named} is not a folder. Give the path of the repository the enforce step ran in.`,
    ]);
  }
  try {
    const run = await (io.build ?? buildEnforceReport)(
      root,
      resolved(cwd, paths)
    );
    if (run.problems !== null) return fail(run.problems);
    stdout(JSON.stringify(run.report, null, 2));
    linesFor(run.report).forEach(line => {
      stderr(line);
    });
    return 0;
  } catch (error) {
    return fail([error instanceof Error ? error.message : String(error)]);
  }
}

/** The collaborator the registration needs, replaceable in a test. */
export interface EnforceReportCommandDependencies {
  readonly runEnforceReport: (
    targetPath: string | undefined,
    paths: EnforceInputPaths
  ) => Promise<number>;
}

/**
 * Register `enforce-report` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerEnforceReport(
  group: Command,
  dependencies: EnforceReportCommandDependencies = {
    runEnforceReport: (targetPath, paths) =>
      runEnforceReport(targetPath, paths),
  }
): void {
  group
    .command(ENFORCE_REPORT_COMMAND)
    .description(
      "Say one thing about every Level 1 requirement (wired, ticketed, blocked or nothing-to-enforce) from the results of the enforce run's three steps, and list the required checks that fail on the default branch; writes nothing"
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      "--carriers <file>",
      'The file holding what "lisa controls install-carriers" printed'
    )
    .option(
      "--tickets <file>",
      "The file holding the results of the missing-capability ticket flow"
    )
    .option(
      "--protect <file>",
      'The file holding what "lisa controls protect" printed'
    )
    .addHelpText("after", ENFORCE_REPORT_HELP_AFTER)
    .action(
      async (targetPath: string | undefined, options: EnforceInputPaths) => {
        const code = await dependencies.runEnforceReport(targetPath, {
          carriers: options.carriers,
          protect: options.protect,
          tickets: options.tickets,
        });
        if (code !== 0) process.exitCode = code;
      }
    );
}
