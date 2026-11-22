/**
 * Rule: the probes of a report agree with the rest of it.
 *
 * Which findings rely on an outside system is data, written on the probe.
 * That is only worth something when it can be followed: each system is
 * probed once, each finding a probe lists is one the report holds and is
 * listed once, and what an operator reads about the system is in plain words.
 *
 * The request on record is also held to being a read. This rule cannot see
 * what was sent, but a report that writes down a request that changes
 * something has said so itself, and the audit never sends one.
 * @module controls/audit-report-rules/probes
 */
import type { AuditProbe } from "../audit-probe-types.js";
import type {
  AuditReport,
  AuditReportRule,
  AuditReportViolation,
} from "../audit-report-types.js";
import { criterionIdsIn } from "../catalogue.js";

/** The name this rule's violations carry. */
export const PROBES_RULE = "probes";

/** The probe fields an operator reads as sentences. */
const PLAIN_FIELDS = ["system", "reason", "access_needed"] as const;

/** HTTP methods that always change something. */
const WRITE_METHOD = /\b(?:PUT|PATCH|DELETE)\b/u;

/** The method that changes something unless it carries a query. */
const POST_METHOD = /\bPOST\b/u;

/** What marks a POST as a query that only reads. */
const QUERY_LANGUAGE = /graphql/iu;

/** Words that change something whatever sends them. */
const WRITE_WORDS = /\bgit\s+push\b|\bmutation\b/iu;

/**
 * Tell whether a recorded request changes something.
 * @param request - The request as the probe records it
 * @returns Whether it is anything but a read
 */
function isWrite(request: string): boolean {
  return (
    WRITE_METHOD.test(request) ||
    WRITE_WORDS.test(request) ||
    (POST_METHOD.test(request) && !QUERY_LANGUAGE.test(request))
  );
}

/**
 * Name the ids more than one probe carries.
 * @param probes - The report's probes
 * @returns Each shared id, once
 */
function sharedIds(probes: readonly AuditProbe[]): readonly string[] {
  const ids = probes.map(probe => probe.id);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
}

/**
 * Check the findings one probe lists against the findings the report holds.
 * @param probe - The probe
 * @param report - The report
 * @returns One violation per entry that names no finding, or names one twice
 */
function dependentViolations(
  probe: AuditProbe,
  report: AuditReport
): readonly AuditReportViolation[] {
  return probe.needed_by.flatMap((dependent, index) => {
    const at = (candidate: {
      readonly criterion: string;
      readonly scope: string;
    }): boolean =>
      candidate.criterion === dependent.criterion &&
      candidate.scope === dependent.scope;
    const place = { criterion: dependent.criterion, scope: dependent.scope };
    if (probe.needed_by.findIndex(at) !== index) {
      return [
        {
          rule: PROBES_RULE,
          message: `The probe "${probe.id}" lists this requirement twice. List it once.`,
          ...place,
        },
      ];
    }
    return report.findings.some(at)
      ? []
      : [
          {
            rule: PROBES_RULE,
            message: `The probe "${probe.id}" lists this requirement as depending on it, but the report has no finding for it there. List only findings the report holds, each with its own "criterion" and "scope".`,
            ...place,
          },
        ];
  });
}

/**
 * Check the words of one probe.
 * @param probe - The probe
 * @returns One violation per field that names a requirement by its id, and
 *   one when the recorded request is not a read
 */
function wordingViolations(probe: AuditProbe): readonly AuditReportViolation[] {
  return [
    ...PLAIN_FIELDS.filter(
      field => criterionIdsIn(probe[field] ?? "").length > 0
    ).map(field => ({
      rule: PROBES_RULE,
      message: `The probe "${probe.id}" names a requirement by its id in "${field}". Say it in plain words: an id belongs in "needed_by" only.`,
    })),
    ...(probe.request !== undefined && isWrite(probe.request)
      ? [
          {
            rule: PROBES_RULE,
            message: `The probe "${probe.id}" records a request that changes something. The audit only reads: a probe is one harmless read, and nothing else may be sent.`,
          },
        ]
      : []),
  ];
}

/**
 * Each system is probed once, each listed finding exists and is listed once,
 * the plain fields are plain, and the recorded request is a read.
 * @param report - The report
 * @returns The violations found
 */
export const probesAreWellFormed: AuditReportRule = report => [
  ...sharedIds(report.probes).map(id => ({
    rule: PROBES_RULE,
    message: `Two probes share the id "${id}". Each outside system is probed once: keep one entry for it.`,
  })),
  ...report.probes.flatMap(probe => [
    ...dependentViolations(probe, report),
    ...wordingViolations(probe),
  ]),
];
