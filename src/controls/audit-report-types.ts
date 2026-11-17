/**
 * The audit report's vocabulary: its paths, its closed word lists, and the
 * types of the report, of a violation and of a rule.
 *
 * A leaf module on purpose. The shape parser, every rule and the renderer
 * import from here and from nowhere else in the report code, so adding a rule
 * or a report section never creates an import cycle. Import these names through
 * `./audit-report.js` unless you are one of those modules.
 * @module controls/audit-report-types
 */
import type { InScopeCriterion } from "./catalogue.js";
import type { EvidenceRecordRef } from "./evidence.js";
import type { RepositoryReader } from "./repository-reader.js";

/** The validated record the audit writes, relative to the repository root. */
export const AUDIT_REPORT_JSON_PATH = ".lisa/audit/report.json";

/** The readable report rendered from the record. */
export const AUDIT_REPORT_MARKDOWN_PATH = ".lisa/audit/report.md";

/** The only report version this code reads. */
export const AUDIT_REPORT_SCHEMA_VERSION = 1;

/** The scope that means the whole repository rather than one folder of it. */
export const REPOSITORY_SCOPE = ".";

/** Every state a criterion can be placed in, and it is placed in exactly one. */
export const AUDIT_FINDING_STATES = [
  "proved",
  "exists-not-enforced",
  "missing",
  "not-applicable",
  "unknown",
  "question",
] as const;

/** One of the six states. */
export type AuditFindingState = (typeof AUDIT_FINDING_STATES)[number];

/**
 * The states that claim a control exists, and so must point at the line that
 * shows it.
 */
export const LOCATED_STATES: readonly AuditFindingState[] = [
  "proved",
  "exists-not-enforced",
];

/** The three fields an operator reads, in the order they are read. */
export const PLAIN_LANGUAGE_FIELDS = ["what", "why", "next"] as const;

/** One of the three plain-language fields. */
export type PlainLanguageField = (typeof PLAIN_LANGUAGE_FIELDS)[number];

/** The moment of a mechanism that is present but that nothing runs. */
export const NO_MOMENT = "none";

/**
 * The fixed moments a mechanism can run at: the gate registry's own names, so
 * what the audit finds can be declared as a gate without translation.
 */
export const MECHANISM_MOMENTS = [
  "session-start",
  "pre-tool",
  "post-tool",
  "commit",
  "push",
  "pull-request",
] as const;

/**
 * Moment families: the bare name, or the name with an `:<environment>` suffix
 * such as `pre-deploy:production`.
 */
export const MECHANISM_MOMENT_FAMILIES = [
  "pre-deploy",
  "post-deploy",
  "continuous",
] as const;

/** A file and line that shows a mechanism is there. */
export interface AuditLocator {
  /** Repository-relative path, with `/` separators. */
  readonly path: string;
  /** Line number, counted from 1. */
  readonly line: number;
}

/** One thing the audit found that checks, or could check, a requirement. */
export interface AuditMechanism {
  /** The tool, by the name its own documentation uses. */
  readonly tool: string;
  /**
   * The command that runs it, as written where it was found. `null` only when
   * the moment is `none`: a tool that is configured but never run has no
   * command to quote.
   */
  readonly command: string | null;
  /** When it runs: a fixed moment, a moment family, or `none`. */
  readonly moment: string;
  /** Where it was found. */
  readonly locators: readonly AuditLocator[];
}

/**
 * Where one criterion stands: in the repository as a whole, or in one part of
 * it, as the catalogue says the criterion is answered.
 */
export interface AuditFinding {
  /** Criterion id. Detail for readers who know the specification. */
  readonly criterion: string;
  /** The folder the finding is about; `.` is the whole repository. */
  readonly scope: string;
  readonly state: AuditFindingState;
  /** What was found, in plain language. */
  readonly what: string;
  /** Why it matters, in plain language. */
  readonly why: string;
  /** What to do next, in plain language. */
  readonly next: string;
  readonly mechanisms: readonly AuditMechanism[];
  /** The evidence record that backs a `proved` finding. */
  readonly evidence_id?: string;
}

/** The audit report, after its shape has been checked. */
export interface AuditReport {
  readonly schema_version: typeof AUDIT_REPORT_SCHEMA_VERSION;
  /** The parts the report covers: `.` and each part's folder path. */
  readonly scopes: readonly string[];
  /**
   * One finding per in-scope criterion for each scope it is answered in: `.`
   * alone when the catalogue says it is answered once for the repository,
   * every listed folder when it says it is answered per part.
   */
  readonly findings: readonly AuditFinding[];
}

/** One thing wrong with a report. */
export interface AuditReportViolation {
  /** Stable name of the rule that was broken. */
  readonly rule: string;
  /**
   * What is wrong and what to do about it, in one plain sentence or two. It
   * never contains a criterion id: `criterion` carries that.
   */
  readonly message: string;
  /** The criterion the violation is about, when it is about one. */
  readonly criterion?: string;
  /** The scope the violation is about, when it is about one. */
  readonly scope?: string;
  /** The finding field the violation is about, when it is about one. */
  readonly field?: string;
}

/** The facts a report is checked against. Rules read these and nothing else. */
export interface AuditReportContext {
  /** The catalogue's in-scope criteria, in catalogue order. */
  readonly criteria: readonly InScopeCriterion[];
  /** The usable evidence records of the repository. */
  readonly evidence: readonly EvidenceRecordRef[];
  /** The current time, passed in so staleness can be tested. */
  readonly now: Date;
  /** The repository the report describes. */
  readonly repository: RepositoryReader;
}

/**
 * One validation rule: a pure function from a shape-checked report and the
 * facts to the violations it finds. Rules do not know about each other.
 */
export type AuditReportRule = (
  report: AuditReport,
  context: AuditReportContext
) => readonly AuditReportViolation[];
