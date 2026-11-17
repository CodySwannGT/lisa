/**
 * Sample audit reports for the suites that check, render or extend them.
 *
 * A valid report holds one finding for every in-scope criterion in every part,
 * so writing one by hand in each suite would mean copying the catalogue. These
 * build the report from the catalogue the package ships, so a sample is
 * complete by construction and stays complete when the catalogue changes
 * (CodySwannGT/lisa#4978).
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
 * A report that passes: one finding per in-scope criterion for each scope.
 * @param scopes - The parts the report covers; `.` is the whole repository
 * @returns The report
 */
export function completeAuditReport(
  scopes: readonly string[] = ["."]
): SampleReport {
  const criteria = inScopeCriteria(loadCriterionCatalogue());
  return {
    schema_version: AUDIT_REPORT_SCHEMA_VERSION,
    scopes,
    findings: scopes.flatMap(scope =>
      criteria.map(criterion => sampleFinding(criterion.id, scope))
    ),
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
