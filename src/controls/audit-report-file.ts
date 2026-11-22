/**
 * Reading the audit report a repository holds, and refusing one that is not
 * valid.
 *
 * Every control command that acts on the audit starts the same way: find the
 * repository, read `.lisa/audit/report.json` without following a link out of
 * it, and hold the report to every rule of `./audit-report.ts`. That start
 * lives here once, so a command that lists from the report can never accept
 * one the check would refuse.
 *
 * It works in a repository where Lisa was never applied. The requirements come
 * from the catalogue inside the Lisa package the command runs from; nothing is
 * read from the host repository except the report, its rendering and the wiki
 * file its questions are copied to, the evidence file, the tracker setting,
 * and the files and folders the report points at. Nothing is written.
 * @module controls/audit-report-file
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { readInlineAnswers } from "./audit-inline-answers-file.js";
import {
  AUDIT_REPORT_JSON_PATH,
  formatAuditReportViolation,
  validateAuditReport,
  type AuditReport,
} from "./audit-report.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
  type InScopeCriterion,
} from "./catalogue.js";
import { readEvidenceRecords } from "./evidence.js";
import { createRepositoryReader } from "./repository-reader.js";
import { parseProblemWithoutExcerpt } from "./secret-scan-json.js";
import { readConfiguredTracker } from "./tracker-config.js";

/** What is at a path, without following a link in its last step. */
export type PathKind = "missing" | "file" | "folder" | "other";

/** The folder the report and its rendering live in. */
const AUDIT_FOLDER = path.dirname(AUDIT_REPORT_JSON_PATH);

/**
 * Say what is at a path, without following a link in its last step.
 * @param target - Absolute path
 * @returns What is there
 */
export async function pathKind(target: string): Promise<PathKind> {
  try {
    const stat = await lstat(target);
    if (stat.isFile()) return "file";
    return stat.isDirectory() ? "folder" : "other";
  } catch {
    return "missing";
  }
}

/**
 * Resolve the repository a command was pointed at to its real path.
 * @param candidate - Absolute path the operator named
 * @returns The real path of the folder, or `null` when it is not a folder
 */
export async function resolveRepositoryRoot(
  candidate: string
): Promise<string | null> {
  try {
    const real = await realpath(candidate);
    return (await pathKind(real)) === "folder" ? real : null;
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
  const kind = await pathKind(file);
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
    const detail = parseProblemWithoutExcerpt(error);
    return {
      problem: `${AUDIT_REPORT_JSON_PATH} is not valid JSON, so it cannot be checked. Write it again. (${detail})`,
    };
  }
}

/** A report that passed every rule, or what is wrong with the one found. */
export type AuditReportLoad =
  | {
      readonly problems: null;
      /** The validated report. */
      readonly report: AuditReport;
      /** The in-scope criteria it was held to, in catalogue order. */
      readonly criteria: readonly InScopeCriterion[];
      /** The report exactly as parsed, for a reader of a newer section. */
      readonly document: unknown;
    }
  | {
      /** One line per problem, each saying what is wrong and what to do. */
      readonly problems: readonly string[];
    };

/**
 * Read the audit report of a repository and hold it to every rule.
 * @param root - Real path of the repository
 * @param now - The current time, used to judge whether evidence is still fresh
 * @returns The validated report, or one line per problem
 */
export async function loadAuditReport(
  root: string,
  now: Date
): Promise<AuditReportLoad> {
  const read = await readReport(root);
  if (read.problem !== null) return { problems: [read.problem] };

  const criteria = inScopeCriteria(loadCriterionCatalogue());
  const { report, violations } = validateAuditReport(read.document, {
    criteria,
    evidence: readEvidenceRecords(root),
    now,
    repository: createRepositoryReader(root),
    trackerConfigured: (await readConfiguredTracker(root)).configured,
    inlineAnswers: await readInlineAnswers(root),
  });
  return report === null
    ? {
        problems: violations.map(violation =>
          formatAuditReportViolation(violation)
        ),
      }
    : { problems: null, report, criteria, document: read.document };
}
