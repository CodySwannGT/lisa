/**
 * Rule: the report says required checks cannot be skipped only when it
 * records a read of the hosting platform.
 *
 * A pipeline file shows that checks exist. Whether a change can be merged
 * without them is a setting the hosting platform holds, and no file in the
 * repository shows it. So the requirement about that setting is tied to the
 * probe of the hosting platform, here, in code, instead of being left to the
 * agent that wrote the report:
 *
 * - whenever the hosting platform was probed, the probe lists this
 *   requirement as depending on it. From there the rule about what a finding
 *   depends on (`./probe-dependents.ts`) applies: a platform that could not
 *   be read leaves the finding `unknown`, naming the access needed;
 * - a finding that says the checks are enforced there, with no probe of the
 *   platform on record at all, is refused.
 *
 * Together: the finding is `proved` or `exists-not-enforced` only beside a
 * probe of the hosting platform whose result is `reachable`.
 * @module controls/audit-report-rules/server-side-authority
 */
import {
  HOSTING_PLATFORM_PROBE_ID,
  SERVER_SIDE_AUTHORITY,
} from "../audit-probe-types.js";
import { isNeededBy, probeOf } from "../audit-probes.js";
import { LOCATED_STATES, type AuditReportRule } from "../audit-report-types.js";
import { findingViolation } from "../audit-report-wording.js";

/** The name this rule's violations carry. */
export const SERVER_SIDE_AUTHORITY_RULE = "server-side-authority";

/**
 * The requirement about checks that cannot be skipped is held to the probe of
 * the hosting platform.
 * @param report - The report
 * @returns The violations found
 */
export const serverSideAuthorityNeedsPlatformRead: AuditReportRule = report => {
  const platform = probeOf(report, HOSTING_PLATFORM_PROBE_ID);
  if (platform !== null) {
    return isNeededBy(platform, SERVER_SIDE_AUTHORITY)
      ? []
      : [
          {
            rule: SERVER_SIDE_AUTHORITY_RULE,
            message: `Whether required checks can be skipped is decided on the hosting platform, so this requirement always depends on the probe "${HOSTING_PLATFORM_PROBE_ID}". Add this requirement, with the scope "${SERVER_SIDE_AUTHORITY.scope}", to that probe's "needed_by".`,
            ...SERVER_SIDE_AUTHORITY,
          },
        ];
  }
  return report.findings
    .filter(
      finding =>
        finding.criterion === SERVER_SIDE_AUTHORITY.criterion &&
        LOCATED_STATES.includes(finding.state)
    )
    .map(finding =>
      findingViolation(
        SERVER_SIDE_AUTHORITY_RULE,
        finding,
        `This finding says the hosting platform enforces the required checks, but the report records no read of that platform's merge settings. Record the read under "probes" with the id "${HOSTING_PLATFORM_PROBE_ID}", or change the state to "unknown" and say in "next" what access is needed.`,
        "state"
      )
    );
};
