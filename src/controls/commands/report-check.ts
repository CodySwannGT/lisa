/**
 * `lisa controls report-check [path]`: refuse an audit report that is not
 * valid, and render the readable report from one that is.
 *
 * The audit is written by an agent. This command is the code that checks it
 * before anyone relies on it: it reads `.lisa/audit/report.json`, holds it to
 * every rule of `../audit-report.ts`, and prints one line per problem. Only a
 * report with no problems is rendered to `.lisa/audit/report.md`, so the
 * readable report can never say something the checked record does not.
 *
 * It works in a repository where Lisa was never applied. The requirements come
 * from the catalogue inside the Lisa package the command runs from; nothing is
 * read from the host repository except the report, the evidence file, and the
 * files and folders the report points at.
 *
 * It writes `report.md`, and one thing more where the repository keeps a
 * wiki: the audit's open questions, as one marked block of `wiki/gaps.md`
 * (`../audit-gaps-file.ts`). It never creates a wiki. Both files are places a
 * person types answers in, so both are looked at before either is written: a
 * report that does not carry an answer one of them holds is refused by the
 * rules, and a file that cannot be written safely stops the run before the
 * other is touched.
 *
 * With `--absorb` the command does a different job and none of the above:
 * see `./report-absorb.ts`.
 * @module controls/commands/report-check
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Command } from "commander";

import { planGapsFile, writeGapsFile } from "../audit-gaps-file.js";
import { WIKI_GAPS_PATH } from "../audit-questions-format.js";
import {
  loadAuditReport,
  pathKind,
  resolveRepositoryRoot,
} from "../audit-report-file.js";
import { renderAuditReportMarkdown } from "../audit-report-markdown.js";
import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  NOT_APPLICABLE_STATE,
  type AuditReport,
} from "../audit-report.js";
import type { InScopeCriterion } from "../catalogue.js";
import { redactCredentials } from "../secret-scan.js";
import { ABSORB_OPTION, runReportAbsorb } from "./report-absorb.js";

/** The subcommand's name under `lisa controls`. */
export const REPORT_CHECK_COMMAND = "report-check";

/** What the check needs from outside, each replaceable in a test. */
export interface ReportCheckDependencies {
  /** The directory the path argument is resolved from. */
  readonly cwd?: string;
  /** The current time, used to judge whether evidence is still fresh. */
  readonly now?: Date;
  /** Where the pass line goes. */
  readonly stdout?: (line: string) => void;
  /** Where problems go, one per call. */
  readonly stderr?: (line: string) => void;
}

/**
 * Tell whether the rendered report can be written: nothing but an ordinary
 * file may be in its place. A link there could point outside the repository.
 * @param root - Real path of the repository
 * @returns `null` when it can be written, or the one-line reason it cannot
 */
async function markdownProblem(root: string): Promise<string | null> {
  const kind = await pathKind(path.join(root, AUDIT_REPORT_MARKDOWN_PATH));
  return kind === "missing" || kind === "file"
    ? null
    : `${AUDIT_REPORT_MARKDOWN_PATH} is not an ordinary file (it may be a link), so nothing was written to it. Remove it, then run this check again.`;
}

/**
 * Write the rendered report, when it differs from the one in place.
 * @param root - Real path of the repository
 * @param report - The validated report
 * @param criteria - The in-scope criteria, in catalogue order
 */
async function writeMarkdown(
  root: string,
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): Promise<void> {
  const file = path.join(root, AUDIT_REPORT_MARKDOWN_PATH);
  // The report passed the credential rules field by field. The rendering
  // goes through the same scanner once more, so that text put together
  // from several fields cannot read as a value where no field did.
  const markdown = redactCredentials(
    renderAuditReportMarkdown(report, criteria)
  ).text;
  if (
    (await pathKind(file)) === "missing" ||
    (await readFile(file, "utf8")) !== markdown
  ) {
    await writeFile(file, markdown);
  }
}

/**
 * Count things in words.
 * @param count - How many
 * @param noun - What they are, singular
 * @returns For example `1 part` or `3 parts`
 */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Check the audit report of one repository.
 * @param targetPath - The repository; the working directory when left out
 * @param dependencies - Replaceable collaborators
 * @returns The exit code: 0 when the report is valid and `report.md` is
 *   written, 1 otherwise
 */
export async function runReportCheck(
  targetPath: string | undefined,
  dependencies: ReportCheckDependencies = {}
): Promise<number> {
  const stdout =
    dependencies.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr =
    dependencies.stderr ?? (line => process.stderr.write(`${line}\n`));
  const fail = (problems: readonly string[]): number => {
    problems.forEach(problem => {
      stderr(problem.replaceAll(/\s+/gu, " "));
    });
    stderr(
      `report-check: FAIL. ${counted(problems.length, "problem")} in ${AUDIT_REPORT_JSON_PATH}; ${AUDIT_REPORT_MARKDOWN_PATH} was not written`
    );
    return 1;
  };

  const named = path.resolve(
    dependencies.cwd ?? process.cwd(),
    targetPath ?? "."
  );
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return fail([
      `${targetPath ?? named} is not a folder. Give the path of the repository to check.`,
    ]);
  }
  const loaded = await loadAuditReport(root, dependencies.now ?? new Date());
  if (loaded.problems !== null) return fail(loaded.problems);
  const { report, criteria } = loaded;

  const gaps = await planGapsFile(root, report, criteria);
  const unwritten = (await markdownProblem(root)) ?? gaps.problem;
  if (unwritten !== null) {
    stderr(unwritten);
    stderr(
      `report-check: FAIL. The report is valid, but ${AUDIT_REPORT_MARKDOWN_PATH} was not written`
    );
    return 1;
  }
  await writeMarkdown(root, report, criteria);
  if (gaps.content !== null) await writeGapsFile(root, gaps.content);
  const copied = gaps.managed
    ? ` and ${counted(report.questions.length, "open question")} to ${WIKI_GAPS_PATH}`
    : "";
  // Whether a requirement applies is the audit's judgement wherever the
  // catalogue allows that it might not. The count is printed on every pass
  // so that a reader sees how much of the report rests on that judgement.
  const notApplicable = report.findings.filter(
    finding => finding.state === NOT_APPLICABLE_STATE
  ).length;
  stdout(
    `report-check: PASS. ${counted(report.findings.length, "finding")} across ${counted(report.scopes.length, "part")}, ${notApplicable} filed as not applicable; wrote ${AUDIT_REPORT_MARKDOWN_PATH}${copied}`
  );
  return 0;
}

/** The collaborators the registration needs, each replaceable in a test. */
export interface ReportCheckCommandDependencies {
  readonly runReportCheck: (targetPath: string | undefined) => Promise<number>;
  /** Runs instead of the check when `--absorb` is given. */
  readonly runReportAbsorb?: (
    targetPath: string | undefined
  ) => Promise<number>;
}

/**
 * Register `report-check` under the `lisa controls` group.
 * @param group - The `controls` command
 * @param dependencies - Replaceable collaborators
 */
export function registerReportCheck(
  group: Command,
  dependencies: ReportCheckCommandDependencies = {
    runReportCheck: targetPath => runReportCheck(targetPath),
  }
): void {
  group
    .command(REPORT_CHECK_COMMAND)
    .description(
      `Check the audit report at ${AUDIT_REPORT_JSON_PATH} and render ${AUDIT_REPORT_MARKDOWN_PATH} from it`
    )
    .argument("[path]", "Project path (default: current directory)")
    .option(
      ABSORB_OPTION,
      `Do not check: record the answers typed on the answer lines of ${AUDIT_REPORT_MARKDOWN_PATH} in ${AUDIT_REPORT_JSON_PATH} and drop the answered questions`
    )
    .action(
      async (
        targetPath: string | undefined,
        options: { readonly absorb?: boolean }
      ) => {
        const absorb =
          dependencies.runReportAbsorb ??
          ((target: string | undefined) => runReportAbsorb(target));
        const code = await (options.absorb === true
          ? absorb(targetPath)
          : dependencies.runReportCheck(targetPath));
        if (code !== 0) process.exitCode = code;
      }
    );
}
