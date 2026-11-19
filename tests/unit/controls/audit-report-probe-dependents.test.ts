/**
 * A finding that depends on an outside system the audit could not read is
 * never reported as in place.
 *
 * A tool being configured does not mean an agent can reach it. When a probe
 * did not get an answer, every finding the probe lists as depending on it must
 * say so: its state is `unknown`, and its next step names the access that is
 * missing, in the probe's own words (CodySwannGT/lisa#4981).
 */
import { describe, expect, it } from "vitest";

import { validateAuditReport } from "../../../src/controls/audit-report.js";
import { PROBE_DEPENDENTS_RULE } from "../../../src/controls/audit-report-rules/probe-dependents.js";
import {
  AUTHORITY,
  PLATFORM,
  PLATFORM_ACCESS,
  notAttemptedProbe,
  reachableProbe,
  unreachableProbe,
  waitingOn,
  withProbes,
  type SampleProbe,
} from "../../helpers/audit-probes.js";
import {
  amendFinding,
  askAbout,
  completeAuditReport,
  type SampleReport,
} from "../../helpers/control-audit-report.js";
import {
  API,
  EXISTS_NOT_ENFORCED,
  FRESH,
  LINTER,
  PART_FIRST,
  PROVED,
  WHOLE,
  context,
  violationsOf,
} from "./audit-report-facts.js";

const MIXED = [WHOLE, API, "web"];
const SONAR = "sonarcloud";
const SONAR_ACCESS =
  "a SonarCloud token with permission to browse this project";

/**
 * What the rule says about a report.
 * @param report - The report
 * @returns The rule's violations
 */
function found(report: SampleReport): readonly unknown[] {
  return violationsOf(report).filter(
    violation => violation.rule === PROBE_DEPENDENTS_RULE
  );
}

/**
 * The complete report with the hosting-platform finding in a given state and
 * one probe of the platform.
 * @param state - The finding's state
 * @param probe - The probe
 * @returns The report
 */
function authorityIn(state: string, probe: SampleProbe): SampleReport {
  const report = amendFinding(completeAuditReport(), AUTHORITY, {
    state,
    mechanisms: state === "missing" ? [] : [LINTER],
  });
  return withProbes(
    state === "question" ? askAbout(report, AUTHORITY) : report,
    [probe]
  );
}

describe("a finding that depends on a system the audit could not reach", () => {
  it.each([
    [EXISTS_NOT_ENFORCED],
    ["missing"],
    ["not-applicable"],
    ["question"],
  ])("is refused in the state %s", state => {
    expect(found(authorityIn(state, unreachableProbe()))).toEqual([
      {
        rule: PROBE_DEPENDENTS_RULE,
        message: `This finding depends on the outside system probed as "${PLATFORM}", which the audit could not reach, so nothing shows whether the requirement is met. Change its state to "unknown" and say in "next" what access is needed.`,
        ...AUTHORITY,
        field: "state",
      },
    ]);
  });

  it("is refused as proved even when a fresh evidence record is cited", () => {
    const report = withProbes(
      amendFinding(completeAuditReport(), AUTHORITY, {
        state: PROVED,
        evidence_id: FRESH.id,
        mechanisms: [LINTER],
      }),
      [unreachableProbe()]
    );
    const evidence = [{ ...FRESH, criterion: AUTHORITY.criterion }];

    expect(
      validateAuditReport(report, context({ evidence })).violations
    ).toEqual([
      expect.objectContaining({ rule: PROBE_DEPENDENTS_RULE, field: "state" }),
    ]);
  });

  it("is refused the same way when the read was never attempted", () => {
    expect(
      found(authorityIn(EXISTS_NOT_ENFORCED, notAttemptedProbe()))
    ).toEqual([
      {
        rule: PROBE_DEPENDENTS_RULE,
        message: `This finding depends on the outside system probed as "${PLATFORM}", which the audit did not try to reach, so nothing shows whether the requirement is met. Change its state to "unknown" and say in "next" what access is needed.`,
        ...AUTHORITY,
        field: "state",
      },
    ]);
  });

  it("passes as unknown when its next step names the access, in the probe's words", () => {
    expect(
      violationsOf(
        withProbes(waitingOn(completeAuditReport()), [unreachableProbe()])
      )
    ).toEqual([]);
    expect(
      violationsOf(
        withProbes(waitingOn(completeAuditReport()), [notAttemptedProbe()])
      )
    ).toEqual([]);
  });

  it("is refused as unknown when its next step does not name the access", () => {
    const report = withProbes(
      amendFinding(completeAuditReport(), AUTHORITY, { state: "unknown" }),
      [unreachableProbe()]
    );

    expect(found(report)).toEqual([
      {
        rule: PROBE_DEPENDENTS_RULE,
        message: `This finding depends on the outside system probed as "${PLATFORM}", which the audit could not reach, but its "next" field does not say what access is needed. Copy the probe's "access_needed" into it, word for word.`,
        ...AUTHORITY,
        field: "next",
      },
    ]);
  });

  it("finds the access in a next step whatever its spacing or capitals", () => {
    const report = withProbes(
      amendFinding(waitingOn(completeAuditReport()), AUTHORITY, {
        next: `To check this, an agent needs\n  ${PLATFORM_ACCESS.toUpperCase()}.`,
      }),
      [unreachableProbe()]
    );

    expect(found(report)).toEqual([]);
  });

  it("is held to every system it depends on", () => {
    const dependent = { criterion: PART_FIRST, scope: API };
    const sonar = unreachableProbe({
      id: SONAR,
      system: "SonarCloud, which the pipeline sends its analysis to",
      needed_by: [dependent],
      request: "a read of the project's quality gate",
      observed_error: "HTTP 401",
      access_needed: SONAR_ACCESS,
    });
    const report = withProbes(
      waitingOn(completeAuditReport(MIXED), dependent),
      [reachableProbe({ needed_by: [AUTHORITY, dependent] }), sonar]
    );

    expect(
      found(report).map(violation => (violation as { field: string }).field)
    ).toEqual(["next"]);
    expect(
      found(
        withProbes(
          waitingOn(completeAuditReport(MIXED), dependent, SONAR_ACCESS),
          [reachableProbe({ needed_by: [AUTHORITY, dependent] }), sonar]
        )
      )
    ).toEqual([]);
  });
});

describe("a finding that depends on a system the audit reached", () => {
  it.each([[EXISTS_NOT_ENFORCED], ["missing"], ["unknown"]])(
    "may be in the state %s",
    state => {
      expect(violationsOf(authorityIn(state, reachableProbe()))).toEqual([]);
    }
  );
});
