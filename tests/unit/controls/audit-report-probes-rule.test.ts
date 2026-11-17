/**
 * How the probes of an audit report are held to the rest of it.
 *
 * Which findings rely on an outside system is written down, on the probe, as
 * a list of findings. That list is only worth something when each entry names
 * a finding the report really holds, each system is probed once, the words an
 * operator reads are plain, and the request on record is a read
 * (CodySwannGT/lisa#4981).
 */
import { describe, expect, it } from "vitest";

import { PROBES_RULE } from "../../../src/controls/audit-report-rules/probes.js";
import {
  AUTHORITY,
  PLATFORM,
  notAttemptedProbe,
  reachableProbe,
  unreachableProbe,
  waitingOn,
  withProbes,
  type SampleProbe,
} from "../../helpers/audit-probes.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import { API, PART_FIRST, WHOLE, violationsOf } from "./audit-report-facts.js";

const MIXED = [WHOLE, API, "web"];

/**
 * What the rule says about a report holding the given probes.
 * @param probes - The probes
 * @param scopes - The parts the report covers
 * @returns The rule's violations
 */
function found(
  probes: readonly SampleProbe[],
  scopes: readonly string[] = [WHOLE]
): readonly unknown[] {
  return violationsOf(withProbes(completeAuditReport(scopes), probes)).filter(
    violation => violation.rule === PROBES_RULE
  );
}

describe("the probes of a report", () => {
  it("pass when each names findings the report holds", () => {
    expect(
      violationsOf(withProbes(completeAuditReport(), [reachableProbe()]))
    ).toEqual([]);
    expect(
      violationsOf(
        withProbes(waitingOn(completeAuditReport()), [unreachableProbe()])
      )
    ).toEqual([]);
  });

  it("pass when a system is probed that no finding depends on", () => {
    expect(
      found([
        reachableProbe(),
        reachableProbe({
          id: "tracker",
          system: "Linear, where the pipeline files say work is tracked",
          needed_by: [],
          request: "a read of the signed-in account",
        }),
      ])
    ).toEqual([]);
  });

  it("probe each system once", () => {
    expect(found([reachableProbe(), reachableProbe()])).toEqual([
      {
        rule: PROBES_RULE,
        message: `Two probes share the id "${PLATFORM}". Each outside system is probed once: keep one entry for it.`,
      },
    ]);
  });

  it("name a finding by the folder it is filed under", () => {
    const dependent = { criterion: PART_FIRST, scope: API };

    expect(
      found([reachableProbe({ needed_by: [AUTHORITY, dependent] })], MIXED)
    ).toEqual([]);
    expect(
      found([reachableProbe({ needed_by: [AUTHORITY, dependent] })])
    ).toEqual([
      {
        rule: PROBES_RULE,
        message: `The probe "${PLATFORM}" lists this requirement as depending on it, but the report has no finding for it there. List only findings the report holds, each with its own "criterion" and "scope".`,
        criterion: PART_FIRST,
        scope: API,
      },
    ]);
  });

  it("list a finding once", () => {
    expect(
      found([reachableProbe({ needed_by: [AUTHORITY, AUTHORITY] })])
    ).toEqual([
      {
        rule: PROBES_RULE,
        message: `The probe "${PLATFORM}" lists this requirement twice. List it once.`,
        ...AUTHORITY,
      },
    ]);
  });

  it.each([["system"], ["reason"], ["access_needed"]])(
    "keep requirement ids out of %s, which an operator reads",
    field => {
      const probe = notAttemptedProbe({
        [field]: "The platform that decides AC5.1 for this repository",
      });

      expect(found([probe])).toEqual([
        {
          rule: PROBES_RULE,
          message: `The probe "${PLATFORM}" names a requirement by its id in "${field}". Say it in plain words: an id belongs in "needed_by" only.`,
        },
      ]);
    }
  );

  it.each([
    ["PUT repos/example/widgets/rulesets/7"],
    ["PATCH repos/example/widgets"],
    ["DELETE repos/example/widgets/rulesets/7"],
    ["gh api -X POST repos/example/widgets/rulesets"],
    ["gh api --method POST repos/example/widgets/rulesets"],
    ["git push origin main"],
    ["mutation { issueCreate(input: {}) { success } }"],
  ])("refuse a recorded request that is not a read: %s", request => {
    expect(found([reachableProbe({ request })])).toEqual([
      {
        rule: PROBES_RULE,
        message: `The probe "${PLATFORM}" records a request that changes something. The audit only reads: a probe is one harmless read, and nothing else may be sent.`,
      },
    ]);
  });

  it.each([
    ["GET repos/example/widgets/rulesets"],
    ["gh api repos/example/widgets/branches/main"],
    ["query { viewer { id } } sent as a POST to the GraphQL address"],
    ["git ls-remote --heads origin"],
  ])("accept a read: %s", request => {
    expect(found([reachableProbe({ request })])).toEqual([]);
  });
});
