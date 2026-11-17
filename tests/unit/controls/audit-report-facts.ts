/**
 * The facts the audit report suites check a report against.
 *
 * A report is valid or not relative to four things: the catalogue, the
 * evidence file, the clock and the repository. The suites share one in-memory
 * set of them so each case changes a single finding and nothing else
 * (CodySwannGT/lisa#4978).
 * @module tests/unit/controls/audit-report-facts
 */
import {
  validateAuditReport,
  type AuditReportContext,
  type AuditReportViolation,
} from "../../../src/controls/audit-report.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import type { EvidenceRecordRef } from "../../../src/controls/evidence.js";
import {
  amendFinding,
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";

/** The instant every case is checked at. */
export const NOW = new Date("2026-11-17T12:00:00.000Z");

/** The in-scope criteria of the shipped catalogue. */
export const CRITERIA = inScopeCriteria(loadCriterionCatalogue());

/** The first two in-scope criterion ids. */
export const FIRST = CRITERIA[0]?.id ?? "";
export const SECOND = CRITERIA[1]?.id ?? "";

/** The scopes the in-memory repository has. */
export const WHOLE = ".";
export const API = "api";

/** The finding most cases change. */
export const AT_FIRST = { criterion: FIRST, scope: WHOLE } as const;

/** The two states that claim a control exists. */
export const PROVED = "proved";
export const EXISTS_NOT_ENFORCED = "exists-not-enforced";

/** The names the rules report under. */
export const RULE = {
  coverage: "coverage",
  locators: "locators",
  plainLanguage: "plain-language",
  provedEvidence: "proved-evidence",
  scopes: "scopes",
  shape: "shape",
} as const;

/** Line counts of the files the in-memory repository holds. */
const FILES: Readonly<Record<string, number>> = {
  "ruff.toml": 5,
  "api/ruff.toml": 5,
};
const FOLDERS = [WHOLE, API, "web"];

/** A record for the first criterion, completed an hour before {@link NOW}. */
export const FRESH: EvidenceRecordRef = {
  id: "ev-fresh",
  criterion: FIRST,
  completed_at: "2026-11-17T11:00:00.000Z",
  freshness_seconds: 86_400,
};

/** A record for the first criterion that expired weeks before {@link NOW}. */
export const STALE: EvidenceRecordRef = {
  ...FRESH,
  id: "ev-stale",
  completed_at: "2026-11-01T00:00:00.000Z",
};

/** A fresh record, but for the second criterion. */
export const OTHER: EvidenceRecordRef = {
  ...FRESH,
  id: "ev-other",
  criterion: SECOND,
};

/** A linter that is configured in `ruff.toml` and that nothing runs. */
export const LINTER = {
  tool: "ruff",
  command: null,
  moment: "none",
  locators: [{ path: "ruff.toml", line: 4 }],
} as const;

/**
 * The facts a report is checked against.
 * @param change - Facts that differ from the defaults
 * @returns The context
 */
export function context(
  change: Partial<AuditReportContext> = {}
): AuditReportContext {
  return {
    criteria: CRITERIA,
    evidence: [FRESH, STALE, OTHER],
    now: NOW,
    repository: {
      lineCount: file => FILES[file] ?? null,
      isFolder: folder => FOLDERS.includes(folder),
    },
    ...change,
  };
}

/**
 * Check a report against the default facts.
 * @param report - Candidate report
 * @returns The violations found
 */
export function violationsOf(report: unknown): readonly AuditReportViolation[] {
  return validateAuditReport(report, context()).violations;
}

/**
 * The complete report with its first finding changed.
 * @param change - Fields to set on the finding
 * @returns The report
 */
export function withFirst(
  change: Readonly<Record<string, unknown>>
): SampleReport {
  return amendFinding(completeAuditReport(), AT_FIRST, change);
}
