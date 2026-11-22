/**
 * The shape of the report's `probes` section: one entry for each outside
 * system the audit tried, or declined, to read.
 *
 * The check that judges a report cannot see the network, so the shape holds
 * each probe to its own word. A probe that says the system answered must
 * carry the request that was made. One that says the read was refused must
 * quote the error. One that says nothing was tried must say why. A field that
 * belongs to another result is refused, so an entry can never say two things
 * at once.
 *
 * A probe is named by its position in the list and never by its content: a
 * malformed entry is the likeliest place for a credential to have been pasted
 * by mistake, and a message must not repeat one.
 *
 * These functions return plain messages. `./audit-report-shape.ts` turns them
 * into the report's shape violations, so this module imports nothing from it.
 * @module controls/audit-report-probes-shape
 */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import {
  AUDIT_PROBE_RESULTS,
  HOSTING_PLATFORM_PROBE_ID,
  PROBE_ID_MAX_LENGTH,
  PROBE_ID_PATTERN,
  type AuditProbeResult,
} from "./audit-probe-types.js";

const PROBE_FIELDS: readonly string[] = [
  "id",
  "system",
  "needed_by",
  "result",
  "request",
  "observed_error",
  "reason",
  "access_needed",
];
const DEPENDENT_FIELDS: readonly string[] = ["criterion", "scope"];

/** How each result is said in a message. */
const SAYS: Readonly<Record<AuditProbeResult, string>> = {
  reachable: "says the system was reached",
  unreachable: "says the system could not be reached",
  "not-attempted": "says no request was attempted",
};

/** The fields each result may not carry. */
const LEFT_OUT: Readonly<Record<AuditProbeResult, readonly string[]>> = {
  reachable: ["observed_error", "reason", "access_needed"],
  unreachable: ["reason"],
  "not-attempted": ["request", "observed_error"],
};

/**
 * Tell whether a value is text with something in it.
 * @param value - Candidate
 * @returns Whether it is a non-blank string
 */
function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Tell whether a value is text with something in it, on one line.
 * @param value - Candidate
 * @returns Whether it is a non-blank string with no line break
 */
function isOneLine(value: unknown): value is string {
  return isFilled(value) && !/[\n\r]/u.test(value);
}

/**
 * Tell whether a value is a probe id.
 * @param value - Candidate
 * @returns Whether it is short, lower-case words joined by hyphens
 */
function isProbeId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length <= PROBE_ID_MAX_LENGTH &&
    PROBE_ID_PATTERN.test(value)
  );
}

/**
 * Tell whether a value is one of the three results.
 * @param value - Candidate
 * @returns Whether it is
 */
function isResult(value: unknown): value is AuditProbeResult {
  return (AUDIT_PROBE_RESULTS as readonly unknown[]).includes(value);
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
 * Check one finding a probe says depends on it.
 * @param raw - Candidate
 * @param label - Which dependent this is, for the message
 * @returns What is wrong with it
 */
function dependentProblems(raw: unknown, label: string): readonly string[] {
  if (!isJsonObject(raw) || !isFilled(raw.criterion) || !isFilled(raw.scope)) {
    return [`${label} must be an object with a "criterion" and a "scope".`];
  }
  return unknownKeys(raw, DEPENDENT_FIELDS, label);
}

/**
 * Check the list of findings a probe says depend on it.
 * @param raw - The probe
 * @param label - Which probe this is, for the message
 * @returns What is wrong with the list
 */
function neededByProblems(raw: JsonObject, label: string): readonly string[] {
  return Array.isArray(raw.needed_by)
    ? raw.needed_by.flatMap((dependent, index) =>
        dependentProblems(dependent, `${label}, dependent ${index + 1}`)
      )
    : [
        `${label}: "needed_by" must be a list of the findings that depend on this system, each a "criterion" and a "scope"; leave it empty when none does.`,
      ];
}

/**
 * Check the fields a probe's result calls for, and the ones it rules out.
 * @param raw - The probe
 * @param result - Its result
 * @param label - Which probe this is, for the message
 * @returns What is wrong with them
 */
function resultProblems(
  raw: JsonObject,
  result: AuditProbeResult,
  label: string
): readonly string[] {
  const says = `${label} ${SAYS[result]}`;
  const needsRequest = result === "reachable" && !isOneLine(raw.request);
  const badRequest =
    result === "unreachable" &&
    raw.request !== undefined &&
    !isOneLine(raw.request);
  return [
    ...(needsRequest
      ? [
          `${says}, so it needs a "request": the read-only request that was made, on one line. A system is never recorded as reachable without one.`,
        ]
      : []),
    ...(badRequest
      ? [
          `${label}: "request" must be the read-only request that was made, on one line, or be left out when none was sent.`,
        ]
      : []),
    ...(result === "unreachable" && !isFilled(raw.observed_error)
      ? [
          `${says}, so it needs an "observed_error": the error, quoted as it was received.`,
        ]
      : []),
    ...(result === "not-attempted" && !isOneLine(raw.reason)
      ? [
          `${says}, so it needs a "reason": why not, in plain words on one line.`,
        ]
      : []),
    ...(result !== "reachable" && !isOneLine(raw.access_needed)
      ? [
          `${label} needs an "access_needed": the access an agent needs to read this system, in plain words on one line.`,
        ]
      : []),
    ...LEFT_OUT[result]
      .filter(field => raw[field] !== undefined)
      .map(field => `${says}, so "${field}" must be left out.`),
  ];
}

/**
 * Check one probe.
 * @param raw - Candidate probe
 * @param index - Its position in the list, from 0
 * @returns What is wrong with it
 */
function probeProblems(raw: unknown, index: number): readonly string[] {
  const label = `Probe number ${index + 1} in the list`;
  if (!isJsonObject(raw)) return [`${label} is not an object.`];
  return [
    ...unknownKeys(raw, PROBE_FIELDS, label),
    ...(isProbeId(raw.id)
      ? []
      : [
          `${label} needs an "id": a short name for the system in lower-case words joined by hyphens, such as ${HOSTING_PLATFORM_PROBE_ID}.`,
        ]),
    ...(isOneLine(raw.system)
      ? []
      : [
          `${label} needs a "system": what the outside system is, in plain words on one line.`,
        ]),
    ...neededByProblems(raw, label),
    ...(isResult(raw.result)
      ? resultProblems(raw, raw.result, label)
      : [
          `${label}: "result" must be one of ${AUDIT_PROBE_RESULTS.join(", ")}.`,
        ]),
  ];
}

/**
 * Check the `probes` section.
 * @param value - What the report holds under `probes`; `undefined` when the
 *   key is absent
 * @returns What is wrong with it; nothing when it is absent
 */
export function probesSectionProblems(value: unknown): readonly string[] {
  if (value === undefined) return [];
  return Array.isArray(value)
    ? value.flatMap((probe, index) => probeProblems(probe, index))
    : [`The report's "probes" must be a list.`];
}
