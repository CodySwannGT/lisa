/**
 * Running `lisa controls report-check` in-process against fixture
 * repositories, for the suites that check what it accepts and what it refuses
 * (CodySwannGT/lisa#4978).
 * @module tests/unit/controls/support/report-check-run
 */
import { runReportCheck } from "../../../../src/controls/commands/report-check.js";
import {
  buildFNone,
  type ControlAuditFixture,
} from "../../../helpers/control-audit-fixtures.js";
import { writeAuditReport } from "../../../helpers/control-audit-report.js";
import { NOW } from "../audit-report-facts.js";

const fixtures: ControlAuditFixture[] = [];

/** What one run of the command printed and returned. */
export interface Run {
  readonly code: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

/**
 * Remember a fixture so it is removed after the case.
 * @param built - The fixture
 * @returns The same fixture
 */
export function keep(built: ControlAuditFixture): ControlAuditFixture {
  fixtures.push(built);
  return built;
}

/** Remove every fixture a case kept. Call from `afterEach`. */
export function removeFixtures(): void {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
}

/**
 * Run the command in-process and capture what it prints.
 * @param target - The path argument, as an operator would type it
 * @param cwd - The directory the command is run from
 * @returns Exit code and printed lines
 */
export async function check(
  target: string | undefined,
  cwd?: string
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runReportCheck(target, {
    ...(cwd === undefined ? {} : { cwd }),
    now: NOW,
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
 * Write a report into F-none and check it.
 * @param report - The report to check
 * @returns The run, and the repository it ran in
 */
export async function checkOnFNone(
  report: unknown
): Promise<Run & { readonly repoPath: string }> {
  const { repoPath } = keep(buildFNone());
  writeAuditReport(repoPath, report);
  return { ...(await check(repoPath)), repoPath };
}
