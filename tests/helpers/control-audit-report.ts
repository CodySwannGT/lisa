/**
 * Sample audit reports for the suites that check, render or extend them.
 *
 * A valid report holds one finding for every in-scope criterion in each place
 * the catalogue says it is answered, so writing one by hand in each suite
 * would mean copying the catalogue. These build the report from the catalogue
 * the package ships, so a sample is complete by construction and stays
 * complete when the catalogue changes (CodySwannGT/lisa#4978).
 * @module tests/helpers/control-audit-report
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  AUDIT_REPORT_JSON_PATH,
  AUDIT_REPORT_SCHEMA_VERSION,
} from "../../src/controls/audit-report.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../src/controls/catalogue.js";
import { EVIDENCE_PATH } from "../../src/controls/evidence.js";

/** The scope that means the whole repository rather than one folder of it. */
const WHOLE_REPOSITORY = ".";

/** One finding as plain JSON, so a suite can also write a malformed one. */
export type SampleFinding = Readonly<Record<string, unknown>>;

/** A report as plain JSON, so a suite can also write a malformed one. */
export interface SampleReport {
  readonly schema_version: unknown;
  readonly scopes: readonly unknown[];
  readonly findings: readonly SampleFinding[];
  readonly [section: string]: unknown;
}

/** Which finding of a report a change applies to. */
export interface FindingAddress {
  readonly criterion: string;
  readonly scope: string;
}

/**
 * A finding that says the requirement is not met, in plain words.
 * @param criterion - Criterion id
 * @param scope - Folder the finding is about
 * @returns A finding that passes every rule
 */
export function sampleFinding(criterion: string, scope: string): SampleFinding {
  return {
    criterion,
    scope,
    state: "missing",
    what: "Nothing in the repository does this yet.",
    why: "Without it, a change that breaks the rule can still be merged.",
    next: "Decide which tool should check it, then run the configure step.",
    mechanisms: [],
  };
}

/**
 * A report that passes: every in-scope criterion filed where the catalogue
 * says it is answered. A criterion answered once for the repository gets one
 * finding, under `.`. A criterion answered per part gets one finding under
 * each folder, or one under `.` when the report lists no folder. Nothing is
 * filed anywhere else, so the report carries no filler.
 *
 * The placement is written out here instead of borrowed from the rule that
 * checks it, so a suite that passes a sample to the rule is comparing two
 * independent readings of the catalogue (CodySwannGT/lisa#5007).
 * @param scopes - The parts the report covers; `.` is the whole repository
 * @returns The report, whole repository first, then each folder as listed
 */
export function completeAuditReport(
  scopes: readonly string[] = [WHOLE_REPOSITORY]
): SampleReport {
  const criteria = inScopeCriteria(loadCriterionCatalogue());
  const folders = scopes.filter(scope => scope !== WHOLE_REPOSITORY);
  const perPart = criteria.filter(criterion => criterion.answered === "part");
  const once = criteria.filter(
    criterion => folders.length === 0 || criterion.answered === "repository"
  );
  return {
    schema_version: AUDIT_REPORT_SCHEMA_VERSION,
    scopes,
    findings: [
      ...once.map(criterion => sampleFinding(criterion.id, WHOLE_REPOSITORY)),
      ...folders.flatMap(folder =>
        perPart.map(criterion => sampleFinding(criterion.id, folder))
      ),
    ],
  };
}

/**
 * Tell whether a finding is the addressed one.
 * @param finding - Candidate finding
 * @param address - Criterion and scope looked for
 * @returns Whether it matches
 */
function isAt(finding: SampleFinding, address: FindingAddress): boolean {
  return (
    finding.criterion === address.criterion && finding.scope === address.scope
  );
}

/**
 * Change one finding of a report.
 * @param report - The report to start from
 * @param address - Which finding to change
 * @param change - Fields to set on it
 * @returns A new report; the original is untouched
 */
export function amendFinding(
  report: SampleReport,
  address: FindingAddress,
  change: SampleFinding
): SampleReport {
  return {
    ...report,
    findings: report.findings.map(finding =>
      isAt(finding, address) ? { ...finding, ...change } : finding
    ),
  };
}

/**
 * Remove one finding from a report.
 * @param report - The report to start from
 * @param address - Which finding to remove
 * @returns A new report; the original is untouched
 */
export function dropFinding(
  report: SampleReport,
  address: FindingAddress
): SampleReport {
  return {
    ...report,
    findings: report.findings.filter(finding => !isAt(finding, address)),
  };
}

/**
 * A report that passes, in which only the named findings are missing. Every
 * other requirement is one the audit could not check, a state that needs no
 * pointer into the repository (CodySwannGT/lisa#4992).
 * @param missing - The findings that stay in state `missing`
 * @param scopes - The parts the report covers; `.` is the whole repository
 * @returns The report
 * @throws {Error} When an address names no finding of the complete report,
 *   for instance a repository-wide requirement under a folder: a suite that
 *   asked for a gap there would otherwise be handed a report without one
 */
export function reportMissing(
  missing: readonly FindingAddress[],
  scopes: readonly string[] = [WHOLE_REPOSITORY]
): SampleReport {
  const report = completeAuditReport(scopes);
  const absent = missing.filter(
    address => !report.findings.some(finding => isAt(finding, address))
  );
  if (absent.length > 0) {
    throw new Error(
      `A complete report for ${JSON.stringify(scopes)} has no finding at ${JSON.stringify(absent)}. A requirement answered once for the repository is filed under "." only, and one answered per part under each folder.`
    );
  }
  return {
    ...report,
    findings: report.findings.map(finding =>
      missing.some(address => isAt(finding, address))
        ? finding
        : { ...finding, state: "unknown" }
    ),
  };
}

/**
 * Write a JSON document into a repository, creating its folder.
 * @param repoPath - Repository root
 * @param relative - Repository-relative path of the file
 * @param document - What to write
 */
function writeJson(
  repoPath: string,
  relative: string,
  document: unknown
): void {
  const file = path.join(repoPath, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
}

/**
 * Write a report where the audit writes it.
 * @param repoPath - Repository root
 * @param report - The report, valid or not
 */
export function writeAuditReport(repoPath: string, report: unknown): void {
  writeJson(repoPath, AUDIT_REPORT_JSON_PATH, report);
}

/**
 * Write evidence records where the attest step writes them.
 * @param repoPath - Repository root
 * @param records - The records, valid or not
 */
export function writeEvidenceRecords(
  repoPath: string,
  records: readonly unknown[]
): void {
  writeJson(repoPath, EVIDENCE_PATH, { records });
}
