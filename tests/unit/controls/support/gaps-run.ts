/**
 * Running `lisa controls gaps` in-process against fixture repositories, and
 * building the reports its suites list from (CodySwannGT/lisa#4992).
 * @module tests/unit/controls/support/gaps-run
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  runGaps,
  type ControlGapsOutput,
} from "../../../../src/controls/commands/gaps.js";
import { buildFMixed } from "../../../helpers/control-audit-fixtures.js";
import {
  reportMissing as reportWithMissing,
  writeAuditReport,
  type FindingAddress,
  type SampleReport,
} from "../../../helpers/control-audit-report.js";
import { NOW } from "../audit-report-facts.js";
import { keep, type Run } from "./report-check-run.js";

/** The parts of F-mixed, the repository these suites run in. */
const MIXED_SCOPES = [".", "api", "web"] as const;

/**
 * A valid report on F-mixed in which only the named findings are missing.
 * @param missing - The findings that stay in state `missing`
 * @returns The report, covering every part of F-mixed
 */
export function reportMissing(
  missing: readonly FindingAddress[]
): SampleReport {
  return reportWithMissing(missing, MIXED_SCOPES);
}

/**
 * Write a Lisa configuration file into a repository.
 * @param repoPath - Repository root
 * @param name - `.lisa.config.json` or `.lisa.config.local.json`
 * @param content - The file's text, valid JSON or not
 */
export function writeConfig(
  repoPath: string,
  name: string,
  content: string
): void {
  writeFileSync(path.join(repoPath, name), content);
}

/**
 * Run the command in-process and capture what it prints.
 * @param target - The path argument, as an operator would type it
 * @returns Exit code and printed lines
 */
export async function gaps(target: string | undefined): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runGaps(target, {
    now: NOW,
    stdout: text => {
      stdout.push(text);
    },
    stderr: line => {
      stderr.push(line);
    },
  });
  return { code, stdout, stderr };
}

/**
 * Read the one JSON document a successful run prints.
 * @param run - The run
 * @returns The document
 */
export function printed(run: Run): ControlGapsOutput {
  return JSON.parse(run.stdout.join("\n")) as ControlGapsOutput;
}

/**
 * Build F-mixed with a report in it and, when given, a tracker setting.
 * @param report - The report the audit left behind
 * @param tracker - The `tracker` value of `.lisa.config.json`, when there is one
 * @returns The repository root
 */
export function mixedRepository(report: unknown, tracker?: string): string {
  const { repoPath } = keep(buildFMixed());
  writeAuditReport(repoPath, report);
  if (tracker !== undefined) {
    writeConfig(repoPath, ".lisa.config.json", JSON.stringify({ tracker }));
  }
  return repoPath;
}
