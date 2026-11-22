/**
 * The shape of the `probes` section of an audit report.
 *
 * A probe is the record of one harmless read the audit tried against an
 * outside system. The check that judges a report cannot see the network, so
 * the shape itself has to hold the report to its word: "reachable" is only
 * accepted with the request that was made, "unreachable" with the error that
 * came back, and "not-attempted" with the reason (CodySwannGT/lisa#4981).
 */
import { describe, expect, it } from "vitest";

import {
  AUDIT_PROBE_RESULTS,
  HOSTING_PLATFORM_PROBE_ID,
  TRACKER_PROBE_ID,
} from "../../../src/controls/audit-report.js";
import {
  HOSTING_PLATFORM_QUESTION_ID,
  SETUP_QUESTION_IDS,
} from "../../../src/controls/question-ids.js";
import {
  notAttemptedProbe,
  reachableProbe,
  unreachableProbe,
  waitingOn,
  withProbes,
  type SampleProbe,
} from "../../helpers/audit-probes.js";
import { completeAuditReport } from "../../helpers/control-audit-report.js";
import { RULE, violationsOf } from "./audit-report-facts.js";

const FIRST_PROBE = "Probe number 1 in the list";

/**
 * The shape problems of a report holding one probe, as text.
 * @param probe - The probe, valid or not
 * @returns One message per shape violation
 */
function shapeProblems(probe: unknown): readonly string[] {
  return violationsOf(withProbes(waitingOn(completeAuditReport()), [probe]))
    .filter(violation => violation.rule === RULE.shape)
    .map(violation => violation.message);
}

/**
 * A probe with some of its fields taken away.
 * @param probe - The probe to start from
 * @param fields - The fields to remove
 * @returns The probe without them
 */
function without(probe: SampleProbe, fields: readonly string[]): SampleProbe {
  return Object.fromEntries(
    Object.entries(probe).filter(([key]) => !fields.includes(key))
  );
}

describe("the probes section", () => {
  it("may be left out, and is then an empty list", () => {
    expect(violationsOf(completeAuditReport())).toEqual([]);
    expect(violationsOf(withProbes(completeAuditReport(), []))).toEqual([]);
  });

  it("must be a list", () => {
    expect(
      violationsOf({ ...completeAuditReport(), probes: {} }).map(
        violation => violation.message
      )
    ).toEqual([`The report's "probes" must be a list.`]);
  });

  it("records three results and no others", () => {
    expect(AUDIT_PROBE_RESULTS).toEqual([
      "reachable",
      "unreachable",
      "not-attempted",
    ]);
    expect(shapeProblems(reachableProbe({ result: "ok" }))).toEqual([
      `${FIRST_PROBE}: "result" must be one of reachable, unreachable, not-attempted.`,
    ]);
  });

  it("uses the setup questions' ids for the hosting platform and the tracker", () => {
    expect(HOSTING_PLATFORM_PROBE_ID).toBe(HOSTING_PLATFORM_QUESTION_ID);
    expect(SETUP_QUESTION_IDS).toContain(TRACKER_PROBE_ID);
  });
});

describe("a probe", () => {
  it.each([
    ["reachable", reachableProbe()],
    ["unreachable", unreachableProbe()],
    [
      "unreachable with no request recorded",
      without(unreachableProbe(), ["request"]),
    ],
    ["not attempted", notAttemptedProbe()],
  ])(
    "passes when it is %s and carries what that result needs",
    (_name, probe) => {
      expect(shapeProblems(probe)).toEqual([]);
    }
  );

  it("is an object", () => {
    expect(shapeProblems("github")).toEqual([
      `${FIRST_PROBE} is not an object.`,
    ]);
  });

  it("is closed: a field Lisa does not read is refused", () => {
    expect(shapeProblems(reachableProbe({ status: 200 }))).toEqual([
      `${FIRST_PROBE} has a field named "status" that Lisa does not read. Remove it.`,
    ]);
  });

  it.each([
    ["Hosting Platform"],
    ["hosting_platform"],
    ["-hosting"],
    [""],
    [7],
    ["a".repeat(41)],
  ])("needs a short lower-case id, so %j is refused", id => {
    expect(shapeProblems(reachableProbe({ id }))).toEqual([
      `${FIRST_PROBE} needs an "id": a short name for the system in lower-case words joined by hyphens, such as hosting-platform.`,
    ]);
  });

  it.each([["system"], ["needed_by"], ["result"]])("needs its %s", field => {
    expect(shapeProblems(without(reachableProbe(), [field]))).toHaveLength(1);
  });

  it("says what the system is on one line", () => {
    expect(
      shapeProblems(reachableProbe({ system: "GitHub\nthe platform" }))
    ).toEqual([
      `${FIRST_PROBE} needs a "system": what the outside system is, in plain words on one line.`,
    ]);
  });
});

describe("a reachable probe", () => {
  it("is refused without the request that was made", () => {
    expect(shapeProblems(without(reachableProbe(), ["request"]))).toEqual([
      `${FIRST_PROBE} says the system was reached, so it needs a "request": the read-only request that was made, on one line. A system is never recorded as reachable without one.`,
    ]);
  });

  it("is refused with a blank request", () => {
    expect(shapeProblems(reachableProbe({ request: "  " }))).toHaveLength(1);
  });

  it.each([
    ["observed_error", "HTTP 401"],
    ["reason", "Not needed."],
    ["access_needed", "an account"],
  ])("may not carry %s", (field, value) => {
    expect(shapeProblems(reachableProbe({ [field]: value }))).toEqual([
      `${FIRST_PROBE} says the system was reached, so "${field}" must be left out.`,
    ]);
  });
});

describe("an unreachable probe", () => {
  it("quotes the error that came back", () => {
    expect(
      shapeProblems(without(unreachableProbe(), ["observed_error"]))
    ).toEqual([
      `${FIRST_PROBE} says the system could not be reached, so it needs an "observed_error": the error, quoted as it was received.`,
    ]);
  });

  it("may quote an error of several lines", () => {
    expect(
      shapeProblems(
        unreachableProbe({ observed_error: "gh: Not Found (HTTP 404)\n{}" })
      )
    ).toEqual([]);
  });

  it("says what access is needed", () => {
    expect(
      shapeProblems(without(unreachableProbe(), ["access_needed"]))
    ).toEqual([
      `${FIRST_PROBE} needs an "access_needed": the access an agent needs to read this system, in plain words on one line.`,
    ]);
  });

  it("may not carry a reason for not trying", () => {
    expect(shapeProblems(unreachableProbe({ reason: "No tool." }))).toEqual([
      `${FIRST_PROBE} says the system could not be reached, so "reason" must be left out.`,
    ]);
  });
});

describe("a probe that was not attempted", () => {
  it("says why", () => {
    expect(shapeProblems(without(notAttemptedProbe(), ["reason"]))).toEqual([
      `${FIRST_PROBE} says no request was attempted, so it needs a "reason": why not, in plain words on one line.`,
    ]);
  });

  it("says what access is needed", () => {
    expect(
      shapeProblems(without(notAttemptedProbe(), ["access_needed"]))
    ).toHaveLength(1);
  });

  it.each([
    ["request", "GET repos/example/widgets"],
    ["observed_error", "HTTP 401"],
  ])("may not carry %s", (field, value) => {
    expect(shapeProblems(notAttemptedProbe({ [field]: value }))).toEqual([
      `${FIRST_PROBE} says no request was attempted, so "${field}" must be left out.`,
    ]);
  });
});

describe("what a probe says depends on it", () => {
  it("is a list, empty when nothing does", () => {
    expect(shapeProblems(reachableProbe({ needed_by: "AC5.1" }))).toEqual([
      `${FIRST_PROBE}: "needed_by" must be a list of the findings that depend on this system, each a "criterion" and a "scope"; leave it empty when none does.`,
    ]);
  });

  it.each([
    [{ criterion: "AC5.1" }],
    [{ scope: "." }],
    [{ criterion: "", scope: "." }],
    ["AC5.1@."],
  ])("names each finding by criterion and scope, so %j is refused", entry => {
    expect(shapeProblems(reachableProbe({ needed_by: [entry] }))).toEqual([
      `${FIRST_PROBE}, dependent 1 must be an object with a "criterion" and a "scope".`,
    ]);
  });

  it("is closed", () => {
    expect(
      shapeProblems(
        reachableProbe({
          needed_by: [{ criterion: "AC5.1", scope: ".", why: "merge rules" }],
        })
      )
    ).toEqual([
      `${FIRST_PROBE}, dependent 1 has a field named "why" that Lisa does not read. Remove it.`,
    ]);
  });
});
