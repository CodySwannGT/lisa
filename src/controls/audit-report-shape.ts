/**
 * The shape of an audit report: which sections it has, which fields a finding
 * has, and which words each field may hold.
 *
 * Shape is checked before any rule runs, and every shape problem is collected
 * rather than stopping at the first, so one run of the check tells the author
 * everything that is malformed. Rules then work on a typed report and never
 * re-check types.
 *
 * ## Adding a top-level section
 *
 * The report is closed: a key that is not on {@link AUDIT_REPORT_SECTIONS} is
 * refused, so a misspelt section is never silently ignored. To add a section,
 * add its type to `AuditReport`, write its parser, and add one entry to the
 * list. A section that may be absent returns its empty value when given
 * `undefined`.
 * @module controls/audit-report-shape
 */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import {
  AUDIT_FINDING_STATES,
  AUDIT_REPORT_SCHEMA_VERSION,
  MECHANISM_MOMENTS,
  MECHANISM_MOMENT_FAMILIES,
  NO_MOMENT,
  PLAIN_LANGUAGE_FIELDS,
  type AuditReport,
  type AuditReportViolation,
} from "./audit-report-types.js";

/** The rule name every shape problem is reported under. */
export const SHAPE_RULE = "shape";

/** What reading one section produced. */
export interface AuditReportSectionResult {
  /** The section's typed value. Only used when nothing at all was wrong. */
  readonly value: unknown;
  readonly violations: readonly AuditReportViolation[];
}

/** One top-level key of the report and how it is read. */
export interface AuditReportSection {
  readonly key: string;
  /**
   * Read the section.
   * @param value - What the report holds under the key; `undefined` when the
   *   key is absent
   * @returns The typed value and anything wrong with it
   */
  readonly parse: (value: unknown) => AuditReportSectionResult;
}

/** A problem with one finding, before it is tied to that finding. */
interface FindingProblem {
  readonly message: string;
  readonly field?: string;
}

const FINDING_FIELDS: readonly string[] = [
  "criterion",
  "scope",
  "state",
  ...PLAIN_LANGUAGE_FIELDS,
  "mechanisms",
  "evidence_id",
];
const MECHANISM_FIELDS: readonly string[] = [
  "tool",
  "command",
  "moment",
  "locators",
];
const LOCATOR_FIELDS: readonly string[] = ["path", "line"];
const MOMENT_FAMILY = new RegExp(
  String.raw`^(?:${MECHANISM_MOMENT_FAMILIES.join("|")})(?::[a-z0-9][a-z0-9-]*)?$`,
  "u"
);
const MOMENT_WORDS = [
  ...MECHANISM_MOMENTS,
  ...MECHANISM_MOMENT_FAMILIES,
  NO_MOMENT,
].join(", ");

/**
 * Tell whether a value is text with something in it.
 * @param value - Candidate
 * @returns Whether it is a non-blank string
 */
function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Tell whether a value names a moment a mechanism can run at.
 * @param value - Candidate
 * @returns Whether it is a fixed moment, a moment family or `none`
 */
function isMoment(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value === NO_MOMENT ||
      (MECHANISM_MOMENTS as readonly string[]).includes(value) ||
      MOMENT_FAMILY.test(value))
  );
}

/**
 * Name the keys of an object that are not on its closed list.
 * @param value - The object
 * @param known - The keys it may have
 * @param label - What the object is, for the message
 * @returns One problem per unknown key
 */
function unknownKeys(
  value: JsonObject,
  known: readonly string[],
  label: string
): readonly string[] {
  return Object.keys(value)
    .filter(key => !known.includes(key))
    .map(
      key =>
        `${label} has a field named "${key}" that Lisa does not read. Remove it.`
    );
}

/**
 * Check one file-and-line pointer.
 * @param raw - Candidate pointer
 * @param label - Which pointer this is, for the message
 * @returns What is wrong with it
 */
function locatorProblems(raw: unknown, label: string): readonly string[] {
  if (!isJsonObject(raw)) {
    return [`${label} must be an object with a "path" and a "line".`];
  }
  return [
    ...unknownKeys(raw, LOCATOR_FIELDS, label),
    ...(isFilled(raw.path)
      ? []
      : [`${label} needs a "path": the file, relative to the repository.`]),
    ...(typeof raw.line === "number" &&
    Number.isInteger(raw.line) &&
    raw.line >= 1
      ? []
      : [`${label} needs a "line": a whole number, counted from 1.`]),
  ];
}

/**
 * Check a mechanism's command against the moment it runs at.
 * @param raw - The mechanism
 * @param label - Which mechanism this is, for the message
 * @returns What is wrong with the command
 */
function commandProblems(raw: JsonObject, label: string): readonly string[] {
  if (isFilled(raw.command)) return [];
  const runs = isMoment(raw.moment) && raw.moment !== NO_MOMENT;
  if (raw.command === null && !runs) return [];
  return [
    runs
      ? `${label} runs at a moment, so its "command" must quote the command that runs it.`
      : `${label}: "command" must quote the command, or be null when nothing runs the tool.`,
  ];
}

/**
 * Check one mechanism.
 * @param raw - Candidate mechanism
 * @param label - Which mechanism this is, for the message
 * @returns What is wrong with it
 */
function mechanismProblems(raw: unknown, label: string): readonly string[] {
  if (!isJsonObject(raw)) return [`${label} must be an object.`];
  return [
    ...unknownKeys(raw, MECHANISM_FIELDS, label),
    ...(isFilled(raw.tool)
      ? []
      : [`${label} needs a "tool": the tool's name.`]),
    ...(isMoment(raw.moment)
      ? []
      : [`${label}: "moment" must be one of ${MOMENT_WORDS}.`]),
    ...commandProblems(raw, label),
    ...(Array.isArray(raw.locators)
      ? raw.locators.flatMap((locator, index) =>
          locatorProblems(locator, `${label}, pointer ${index + 1}`)
        )
      : [`${label} needs "locators": a list of file-and-line pointers.`]),
  ];
}

/**
 * Check the fields of one finding.
 * @param raw - The finding, known to be an object
 * @returns What is wrong with it
 */
function findingProblems(raw: JsonObject): readonly FindingProblem[] {
  const text = ["criterion", "scope", ...PLAIN_LANGUAGE_FIELDS]
    .filter(field => typeof raw[field] !== "string")
    .map(field => ({ field, message: `The "${field}" field must be text.` }));
  const state = (AUDIT_FINDING_STATES as readonly unknown[]).includes(raw.state)
    ? []
    : [
        {
          field: "state",
          message: `The "state" field must be one of ${AUDIT_FINDING_STATES.join(", ")}.`,
        },
      ];
  const evidence =
    raw.evidence_id === undefined || isFilled(raw.evidence_id)
      ? []
      : [
          {
            field: "evidence_id",
            message: `The "evidence_id" field must be the id of an evidence record, or be left out.`,
          },
        ];
  const mechanisms = Array.isArray(raw.mechanisms)
    ? raw.mechanisms.flatMap((mechanism, index) =>
        mechanismProblems(mechanism, `Mechanism ${index + 1}`)
      )
    : [
        `The "mechanisms" field must be a list; leave it empty when nothing was found.`,
      ];
  return [
    ...unknownKeys(raw, FINDING_FIELDS, "This finding").map(message => ({
      message,
    })),
    ...text,
    ...state,
    ...evidence,
    ...mechanisms.map(message => ({ field: "mechanisms", message })),
  ];
}

/**
 * Turn the problems of one finding into violations that say which finding.
 *
 * A finding is located by its criterion and scope. When it has no usable
 * criterion, its position in the list is all there is to go on.
 * @param raw - Candidate finding
 * @param index - Its position in the list, from 0
 * @returns One violation per problem
 */
function findingViolations(
  raw: unknown,
  index: number
): readonly AuditReportViolation[] {
  const position = `Finding number ${index + 1} in the list`;
  if (!isJsonObject(raw)) {
    return [{ rule: SHAPE_RULE, message: `${position} is not an object.` }];
  }
  const located = isFilled(raw.criterion);
  return findingProblems(raw).map(problem => ({
    rule: SHAPE_RULE,
    message: located ? problem.message : `${position}: ${problem.message}`,
    ...(located ? { criterion: String(raw.criterion) } : {}),
    ...(typeof raw.scope === "string" ? { scope: raw.scope } : {}),
    ...(problem.field === undefined ? {} : { field: problem.field }),
  }));
}

/**
 * Wrap one message as a violation of the report as a whole.
 * @param message - What is wrong
 * @returns The violation
 */
function reportViolation(message: string): AuditReportViolation {
  return { rule: SHAPE_RULE, message };
}

/** The report's sections, in the order they are read. */
export const AUDIT_REPORT_SECTIONS: readonly AuditReportSection[] = [
  {
    key: "schema_version",
    parse: value => ({
      value,
      violations:
        value === AUDIT_REPORT_SCHEMA_VERSION
          ? []
          : [
              reportViolation(
                `The report's "schema_version" must be ${AUDIT_REPORT_SCHEMA_VERSION}.`
              ),
            ],
    }),
  },
  {
    key: "scopes",
    parse: value => ({
      value,
      violations:
        Array.isArray(value) && value.every(scope => typeof scope === "string")
          ? []
          : [
              reportViolation(
                `The report's "scopes" must be a list of folder paths, with "." for the whole repository.`
              ),
            ],
    }),
  },
  {
    key: "findings",
    parse: value => ({
      value,
      violations: Array.isArray(value)
        ? value.flatMap((finding, index) => findingViolations(finding, index))
        : [reportViolation(`The report's "findings" must be a list.`)],
    }),
  },
];

/** A report whose shape is sound, or the reasons it is not. */
export interface ParsedAuditReport {
  /** The typed report; `null` when anything was wrong with its shape. */
  readonly report: AuditReport | null;
  readonly violations: readonly AuditReportViolation[];
}

/**
 * Check a candidate report's shape.
 * @param candidate - Parsed JSON of any shape
 * @param sections - The sections a report may have
 * @returns The typed report, or every shape problem found
 */
export function parseAuditReport(
  candidate: unknown,
  sections: readonly AuditReportSection[] = AUDIT_REPORT_SECTIONS
): ParsedAuditReport {
  if (!isJsonObject(candidate)) {
    return {
      report: null,
      violations: [
        reportViolation(
          `The audit report must be a JSON object with "schema_version", "scopes" and "findings".`
        ),
      ],
    };
  }
  const keys = sections.map(section => section.key);
  const unknown = Object.keys(candidate)
    .filter(key => !keys.includes(key))
    .map(key =>
      reportViolation(
        `The report has a section named "${key}" that this version of Lisa does not read. Remove it, or update Lisa.`
      )
    );
  const results = sections.map(section => ({
    key: section.key,
    ...section.parse(candidate[section.key]),
  }));
  const violations = [
    ...unknown,
    ...results.flatMap(result => result.violations),
  ];
  return {
    report:
      violations.length === 0
        ? (Object.fromEntries(
            results.map(result => [result.key, result.value])
          ) as unknown as AuditReport)
        : null,
    violations,
  };
}
