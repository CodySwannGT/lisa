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
 * files and folders the report points at. Nothing is written except
 * `report.md`.
 * @module controls/commands/report-check
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Command } from "commander";

import {
  loadAuditReport,
  pathKind,
  resolveRepositoryRoot,
} from "../audit-report-file.js";
import { renderAuditReportMarkdown } from "../audit-report-markdown.js";
import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  type AuditReport,
} from "../audit-report.js";
import type { InScopeCriterion } from "../catalogue.js";

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
 * Write the rendered report, unless something other than an ordinary file is
 * in its place. A link there could point outside the repository, and this
 * command writes nowhere else.
 * @param root - Real path of the repository
 * @param report - The validated report
 * @param criteria - The in-scope criteria, in catalogue order
 * @returns `null` when the file is in place, or the one-line reason it is not
 */
async function writeMarkdown(
  root: string,
  report: AuditReport,
  criteria: readonly InScopeCriterion[]
): Promise<string | null> {
  const file = path.join(root, AUDIT_REPORT_MARKDOWN_PATH);
  const kind = await pathKind(file);
  if (kind !== "missing" && kind !== "file") {
    return `${AUDIT_REPORT_MARKDOWN_PATH} is not an ordinary file (it may be a link), so nothing was written to it. Remove it, then run this check again.`;
  }
  const markdown = renderAuditReportMarkdown(report, criteria);
  if (kind === "missing" || (await readFile(file, "utf8")) !== markdown) {
    await writeFile(file, markdown);
  }
  return null;
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

  const unwritten = await writeMarkdown(root, report, criteria);
  if (unwritten !== null) {
    stderr(unwritten);
    stderr(
      `report-check: FAIL. The report is valid, but ${AUDIT_REPORT_MARKDOWN_PATH} was not written`
    );
    return 1;
  }
  stdout(
    `report-check: PASS. ${counted(report.findings.length, "finding")} across ${counted(report.scopes.length, "part")}; wrote ${AUDIT_REPORT_MARKDOWN_PATH}`
  );
  return 0;
}

/** The collaborator the registration needs, replaceable in a test. */
export interface ReportCheckCommandDependencies {
  readonly runReportCheck: (targetPath: string | undefined) => Promise<number>;
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
    .action(async (targetPath: string | undefined) => {
      const code = await dependencies.runReportCheck(targetPath);
      if (code !== 0) process.exitCode = code;
    });
}
