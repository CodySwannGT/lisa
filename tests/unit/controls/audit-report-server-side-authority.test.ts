/**
 * Whether required checks can be skipped is decided on the hosting platform,
 * so the report may only say they cannot be when it records a successful read
 * of that platform.
 *
 * Finding a pipeline file shows that checks exist. Whether a change can be
 * merged without them is a setting the platform holds, and no file in the
 * repository shows it. A report that says the checks are enforced there
 * without having read the setting is refused, and so is one that probed the
 * platform without tying that probe to the requirement
 * (CodySwannGT/lisa#4981).
 */
import { describe, expect, it } from "vitest";

import {
  HOSTING_PLATFORM_PROBE_ID,
  SERVER_SIDE_AUTHORITY,
  validateAuditReport,
} from "../../../src/controls/audit-report.js";
import { SERVER_SIDE_AUTHORITY_RULE } from "../../../src/controls/audit-report-rules/server-side-authority.js";
import {
  AUTHORITY,
  notAttemptedProbe,
  reachableProbe,
  unreachableProbe,
  waitingOn,
  withProbes,
} from "../../helpers/audit-probes.js";
import {
  amendFinding,
  completeAuditReport,
  reportMissing,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  CRITERIA,
  EXISTS_NOT_ENFORCED,
  FRESH,
  LINTER,
  PROVED,
  context,
  violationsOf,
} from "./audit-report-facts.js";

const NO_READ = {
  rule: SERVER_SIDE_AUTHORITY_RULE,
  message: `This finding says the hosting platform enforces the required checks, but the report records no read of that platform's merge settings. Record the read under "probes" with the id "${HOSTING_PLATFORM_PROBE_ID}", or change the state to "unknown" and say in "next" what access is needed.`,
  ...AUTHORITY,
  field: "state",
};

/**
 * The complete report saying the platform enforces the checks.
 * @param state - The state the finding claims
 * @returns The report
 */
function enforced(state: string = EXISTS_NOT_ENFORCED): SampleReport {
  return amendFinding(completeAuditReport(), AUTHORITY, {
    state,
    mechanisms: [LINTER],
    ...(state === PROVED ? { evidence_id: FRESH.id } : {}),
  });
}

/**
 * Check a report with an evidence record on file for the requirement.
 * @param report - The report
 * @returns The violations found
 */
function checked(report: SampleReport): readonly unknown[] {
  return validateAuditReport(
    report,
    context({ evidence: [{ ...FRESH, criterion: AUTHORITY.criterion }] })
  ).violations;
}

describe("the requirement that checks cannot be skipped", () => {
  it("is in the catalogue, answered once for the repository", () => {
    expect(SERVER_SIDE_AUTHORITY).toEqual(AUTHORITY);
    expect(
      CRITERIA.filter(criterion => criterion.id === AUTHORITY.criterion).map(
        criterion => criterion.answered
      )
    ).toEqual(["repository"]);
  });

  it.each([[EXISTS_NOT_ENFORCED], [PROVED]])(
    "is refused as %s when no probe of the hosting platform is on record",
    state => {
      expect(checked(enforced(state))).toEqual([NO_READ]);
      expect(checked(withProbes(enforced(state), []))).toEqual([NO_READ]);
    }
  );

  it("is refused when only another system was probed", () => {
    const tracker = reachableProbe({ id: "tracker", needed_by: [] });

    expect(checked(withProbes(enforced(), [tracker]))).toEqual([NO_READ]);
  });

  it.each([[EXISTS_NOT_ENFORCED], [PROVED]])(
    "is accepted as %s when the hosting platform was read",
    state => {
      expect(checked(withProbes(enforced(state), [reachableProbe()]))).toEqual(
        []
      );
    }
  );

  it.each([
    ["could not be reached", unreachableProbe()],
    ["was not tried", notAttemptedProbe()],
  ])(
    "is refused when the hosting platform %s, by the rule about what a finding depends on",
    (_name, probe) => {
      expect(
        checked(withProbes(enforced(), [probe])).map(
          violation => (violation as { rule: string }).rule
        )
      ).toEqual(["probe-dependents"]);
    }
  );

  it.each([["missing"], ["unknown"]])(
    "needs no probe in the state %s, where nothing is claimed",
    state => {
      expect(
        violationsOf(amendFinding(completeAuditReport(), AUTHORITY, { state }))
      ).toEqual([]);
      expect(violationsOf(reportMissing([]))).toEqual([]);
    }
  );
});

describe("a probe of the hosting platform", () => {
  it.each([
    ["reachable", reachableProbe({ needed_by: [] })],
    ["unreachable", unreachableProbe({ needed_by: [] })],
    ["not attempted", notAttemptedProbe({ needed_by: [] })],
  ])(
    "always lists that requirement as depending on it, also when %s",
    (_name, probe) => {
      expect(violationsOf(withProbes(completeAuditReport(), [probe]))).toEqual([
        {
          rule: SERVER_SIDE_AUTHORITY_RULE,
          message: `Whether required checks can be skipped is decided on the hosting platform, so this requirement always depends on the probe "${HOSTING_PLATFORM_PROBE_ID}". Add this requirement, with the scope ".", to that probe's "needed_by".`,
          ...AUTHORITY,
        },
      ]);
    }
  );

  it("then holds the finding to what the probe found", () => {
    expect(
      violationsOf(
        withProbes(waitingOn(completeAuditReport()), [unreachableProbe()])
      )
    ).toEqual([]);
  });
});
