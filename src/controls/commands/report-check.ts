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
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Command } from "commander";

import { renderAuditReportMarkdown } from "../audit-report-markdown.js";
import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_MARKDOWN_PATH,
  formatAuditReportViolation,
  validateAuditReport,
  type AuditReport,
} from "../audit-report.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
  type InScopeCriterion,
} from "../catalogue.js";
import { readEvidenceRecords } from "../evidence.js";
import { createRepositoryReader } from "../repository-reader.js";

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

/** What is at a path, without following a link in its last step. */
type PathKind = "missing" | "file" | "folder" | "other";

/** The folder the report and its rendering live in. */
const AUDIT_FOLDER = path.dirname(AUDIT_REPORT_JSON_PATH);

/**
 * Say what is at a path, without following a link in its last step.
 * @param target - Absolute path
 * @returns What is there
 */
async function kindOf(target: string): Promise<PathKind> {
  try {
    const stat = await lstat(target);
    if (stat.isFile()) return "file";
    return stat.isDirectory() ? "folder" : "other";
  } catch {
    return "missing";
  }
}

/**
 * Resolve the repository to check to its real path.
 * @param candidate - Absolute path the operator named
 * @returns The real path of the folder, or `null` when it is not a folder
 */
async function repositoryRoot(candidate: string): Promise<string | null> {
  try {
    const real = await realpath(candidate);
    return (await kindOf(real)) === "folder" ? real : null;
  } catch {
    return null;
  }
}

/**
 * Tell whether the report folder is a folder of the repository itself, rather
 * than a link that leads somewhere else.
 * @param root - Real path of the repository
 * @returns Whether reading and writing there stays inside the repository
 */
async function auditFolderIsInside(root: string): Promise<boolean> {
  try {
    return (
      (await realpath(path.join(root, AUDIT_FOLDER))) ===
      path.join(root, AUDIT_FOLDER)
    );
  } catch {
    return false;
  }
}

/** The parsed report, or the one-line reason there is none to check. */
type ReportRead =
  | { readonly problem: null; readonly document: unknown }
  | { readonly problem: string };

/**
 * Read and parse the report a repository holds.
 * @param root - Real path of the repository
 * @returns The parsed JSON, or the one-line reason it could not be read
 */
async function readReport(root: string): Promise<ReportRead> {
  const file = path.join(root, AUDIT_REPORT_JSON_PATH);
  const kind = await kindOf(file);
  if (kind === "missing") {
    return {
      problem: `No audit report was found at ${AUDIT_REPORT_JSON_PATH}. Run the audit first, then run this check again.`,
    };
  }
  if (kind !== "file") {
    return {
      problem: `${AUDIT_REPORT_JSON_PATH} is not an ordinary file, so it was not read. Replace it with the report the audit writes.`,
    };
  }
  if (!(await auditFolderIsInside(root))) {
    return {
      problem: `${AUDIT_FOLDER} is a link to somewhere outside the repository, so nothing in it was read or written. Replace it with an ordinary folder.`,
    };
  }
  try {
    return {
      problem: null,
      document: JSON.parse(await readFile(file, "utf8")) as unknown,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      problem: `${AUDIT_REPORT_JSON_PATH} is not valid JSON, so it cannot be checked. Write it again. (${detail})`,
    };
  }
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
  const kind = await kindOf(file);
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
  const root = await repositoryRoot(named);
  if (root === null) {
    return fail([
      `${targetPath ?? named} is not a folder. Give the path of the repository to check.`,
    ]);
  }
  const read = await readReport(root);
  if (read.problem !== null) return fail([read.problem]);

  const criteria = inScopeCriteria(loadCriterionCatalogue());
  const { report, violations } = validateAuditReport(read.document, {
    criteria,
    evidence: readEvidenceRecords(root),
    now: dependencies.now ?? new Date(),
    repository: createRepositoryReader(root),
  });
  if (report === null) {
    return fail(
      violations.map(violation => formatAuditReportViolation(violation))
    );
  }
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
