/**
 * The facts the audit report suites check a report against.
 *
 * A report is valid or not relative to the catalogue, the evidence file, the
 * clock, the repository, whether a tracker is configured, and what people
 * have typed on the answer lines of the rendered report. The suites share one
 * in-memory set of them so each case changes a single finding and nothing
 * else (CodySwannGT/lisa#4978, CodySwannGT/lisa#4980).
 * @module tests/unit/controls/audit-report-facts
 */
import {
  AUDIT_REPORT_MARKDOWN_PATH,
  validateAuditReport,
  type AuditReportContext,
  type AuditReportViolation,
  type InlineAnswers,
} from "../../../src/controls/audit-report.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import type { EvidenceRecordRef } from "../../../src/controls/evidence.js";
import {
  amendFinding,
  askAbout,
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";

/** The instant every case is checked at. */
export const NOW = new Date("2026-11-17T12:00:00.000Z");

/** The in-scope criteria of the shipped catalogue. */
export const CRITERIA = inScopeCriteria(loadCriterionCatalogue());

/**
 * The first two in-scope criterion ids. Both are answered once, for the whole
 * repository, so neither may be filed under a folder.
 */
export const FIRST = CRITERIA[0]?.id ?? "";
export const SECOND = CRITERIA[1]?.id ?? "";

/** The criteria answered once for the whole repository. */
export const REPOSITORY_WIDE = CRITERIA.filter(
  criterion => criterion.answered === "repository"
);

/** The criteria answered once for each part. */
export const PER_PART = CRITERIA.filter(
  criterion => criterion.answered === "part"
);

/** The first two criterion ids that are answered once for each part. */
export const PART_FIRST = PER_PART[0]?.id ?? "";
export const PART_SECOND = PER_PART[1]?.id ?? "";

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
  questions: "questions",
  recordedAnswers: "recorded-answers",
  scopes: "scopes",
  shape: "shape",
  trackerQuestion: "tracker-question",
} as const;

/** Line counts of the files the in-memory repository holds. */
const FILES: Readonly<Record<string, number>> = {
  "ruff.toml": 5,
  "api/ruff.toml": 5,
};
const FOLDERS = [WHOLE, API, "web"];

/**
 * A record for the first criterion, completed an hour before {@link NOW}. It
 * is about the whole repository and stands on its own: a setting read from
 * the hosting platform, not one half of a paired proof.
 */
export const FRESH: EvidenceRecordRef = {
  id: "ev-fresh",
  criterion: FIRST,
  completed_at: "2026-11-17T11:00:00.000Z",
  freshness_seconds: 86_400,
  entry_id: "code-style@.",
  scope: WHOLE,
  rung: "observed",
  half: null,
  moment: "pull-request",
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
 * What reading the rendered report gives when a person typed each of the
 * given answers on its question's answer line. An answer in a report counts
 * only then, so a case that holds a report to its rules with answers on
 * record has to say they were typed (CodySwannGT/lisa#4978).
 * @param answers - The answers, as the report's `answers` holds them
 * @returns The answer lines, as read from `.lisa/audit/report.md`
 */
export function typedAnswers(
  answers: readonly {
    readonly id: string;
    readonly question: string;
    readonly answer: string;
  }[]
): InlineAnswers {
  return {
    rendered: true,
    problems: [],
    entries: answers.map(({ id, question, answer }, index) => ({
      id,
      question,
      answer,
      answered: true,
      file: AUDIT_REPORT_MARKDOWN_PATH,
      line: 12 + index * 7,
    })),
  };
}

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
    trackerConfigured: false,
    inlineAnswers: { rendered: false, problems: [], entries: [] },
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
 * The complete report with its first finding changed. A finding put in the
 * state that needs a person's answer is given its question, because one
 * without the other is refused (CodySwannGT/lisa#4980).
 * @param change - Fields to set on the finding
 * @returns The report
 */
export function withFirst(
  change: Readonly<Record<string, unknown>>
): SampleReport {
  const changed = amendFinding(completeAuditReport(), AT_FIRST, change);
  return change.state === "question" ? askAbout(changed, AT_FIRST) : changed;
}
