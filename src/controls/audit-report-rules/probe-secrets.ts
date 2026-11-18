/**
 * Rule: nothing shaped like a credential is written into a probe.
 *
 * A probe records a request that was sent with a credential and an error that
 * came back from it. That is the one place in a report where a token is
 * likely to be copied by accident: a header pasted with its value, a web
 * address with a password in it, an error that repeats the address it failed
 * on. The report refers to a secret by its name and never holds its value, so
 * the shapes of one are refused here, where the risk is introduced.
 *
 * What counts as the shape of a credential is not decided here. Every field
 * is handed to the one scanner the control commands share
 * (`../secret-scan.ts`), which the rest of the report, the register and the
 * evidence are held to as well, so no two of them can disagree about the
 * same string. In short: a shape only a credential has, anywhere; a web
 * address with a user name or password in front of the host; the value after
 * an authorization scheme; and a long random-looking value, only beside a
 * name that says it is a secret. A long random-looking string on its own is
 * left alone in every field, because a commit hash and a request id look the
 * same.
 *
 * It will miss a credential of an unusual shape. The answer to a refusal is
 * always the same, which is why the message gives it: write the name the
 * value goes by.
 *
 * A message from this rule says which probe, by its position in the list, and
 * which field. It never repeats what it found.
 * @module controls/audit-report-rules/probe-secrets
 */
import type { AuditProbe } from "../audit-probe-types.js";
import type {
  AuditReportRule,
  AuditReportViolation,
} from "../audit-report-types.js";
import { VALUE_NOT_REPEATED } from "../secret-scan-json.js";
import { credentialKinds } from "../secret-scan.js";
import { describeCredentialKind } from "../secret-shapes.js";

/** The name this rule's violations carry. */
export const PROBE_SECRETS_RULE = "probe-secrets";

/** The probe fields that hold free text, in the order they are checked. */
const TEXT_FIELDS = [
  "id",
  "system",
  "request",
  "observed_error",
  "reason",
  "access_needed",
] as const;

/**
 * Check one probe.
 * @param probe - The probe
 * @param index - Its position in the list, from 0
 * @returns One violation per shape per field
 */
function probeViolations(
  probe: AuditProbe,
  index: number
): readonly AuditReportViolation[] {
  return TEXT_FIELDS.flatMap(field =>
    credentialKinds(probe[field] ?? "", { name: field }).map(kind => ({
      rule: PROBE_SECRETS_RULE,
      message: `Probe number ${index + 1} in the list holds something shaped like a credential in its "${field}": ${describeCredentialKind(kind)}. Take the value out and write the name it goes by instead. ${VALUE_NOT_REPEATED}`,
    }))
  );
}

/**
 * No probe holds anything shaped like a credential in its free text.
 * @param report - The report
 * @returns The violations found
 */
export const probesHoldNoCredentials: AuditReportRule = report =>
  report.probes.flatMap((probe, index) => probeViolations(probe, index));
