/**
 * Answering an audit's questions the way an operator does, and running the
 * commands that read the answers, for the suites that prove a typed answer is
 * never lost (CodySwannGT/lisa#4980).
 * @module tests/unit/controls/support/report-answers-run
 */
import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
} from "../../../../src/controls/audit-report.js";
import { runReportAbsorb } from "../../../../src/controls/commands/report-absorb.js";
import { fileOf, typeAnswer } from "../../../helpers/audit-answers.js";
import {
  buildFNone,
  type ControlAuditFixture,
} from "../../../helpers/control-audit-fixtures.js";
import {
  writeAuditReport,
  type SampleReport,
} from "../../../helpers/control-audit-report.js";
import { check, keep, type Run } from "./report-check-run.js";

export { fileOf, writeFileOf } from "../../../helpers/audit-answers.js";

/** The wiki file an audit copies its open questions to. */
export const GAPS = "wiki/gaps.md";

/** The readable report, where an operator answers. */
export const REPORT_MD = AUDIT_REPORT_MARKDOWN_PATH;

/**
 * Run `lisa controls report-check --absorb` in-process and capture what it
 * prints.
 * @param target - The path argument, as an operator would type it
 * @returns Exit code and printed lines
 */
export async function absorb(target: string | undefined): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runReportAbsorb(target, {
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
 * Read the record an audit left.
 * @param repoPath - Repository root
 * @returns The parsed report
 */
export function recordOf(repoPath: string): SampleReport {
  return JSON.parse(fileOf(repoPath, AUDIT_REPORT_JSON_PATH)) as SampleReport;
}

/**
 * Type on the answer line of one question, in the readable report unless
 * another file is named.
 * @param repoPath - Repository root
 * @param id - The question's id, as its heading shows it
 * @param answer - What to type; an empty string empties the line
 * @param file - The file to answer in
 */
export function answerInline(
  repoPath: string,
  id: string,
  answer: string,
  file: string = REPORT_MD
): void {
  typeAnswer(repoPath, file, id, answer);
}

/**
 * Hand back a repository whose check passed.
 * @param repoPath - Repository root
 * @param run - The check that ran in it
 * @returns The repository root
 * @throws {Error} When the check did not pass
 */
function passed(repoPath: string, run: Run): string {
  if (run.code !== 0) throw new Error(run.stderr.join("\n"));
  return repoPath;
}

/**
 * A repository whose audit passed its check, so its readable report is on
 * disk with the questions to answer.
 * @param report - The record the audit wrote
 * @param build - The fixture to audit
 * @returns The repository root
 * @throws {Error} When the record does not pass, so a case never starts from
 *   a repository with no readable report
 */
export async function audited(
  report: SampleReport,
  build: () => ControlAuditFixture = buildFNone
): Promise<string> {
  const { repoPath } = keep(build());
  writeAuditReport(repoPath, report);
  return passed(repoPath, await check(repoPath));
}
