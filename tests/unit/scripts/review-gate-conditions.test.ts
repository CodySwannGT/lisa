/**
 * The review gate says WHICH condition it observed (#3716, #3600).
 *
 * `reviewGateState` returned `unsatisfied` from four structurally different
 * situations — nobody reviewed, a review ran and OBJECTED, the reviewer is
 * late, and the reviewer said something the vocabulary does not know. All four
 * published one word, and the correct operator response differs in every case:
 * investigate the silence, read the objection, wait and re-run, or classify the
 * phrase. An operator handed one token for four situations gets it wrong three
 * times out of four.
 *
 * That collapse is why #3706, #3716 and #3600 each described a different defect
 * and each was partly right. They are four faces of one impoverished vocabulary,
 * which is why this is one change rather than three.
 *
 * The sharpest of the four is `objected`: the script's own prose says a review
 * that "RAN AND OBJECTED is the case this gate exists to let through to a
 * human", and it then reported that identically to nobody-reviewed. Blocking is
 * correct there, so no exit code was ever wrong — what was missing was any way
 * to tell an operator which of the four they were looking at.
 *
 * **Severity is deliberately unchanged, and the rejection controls below pin
 * that.** #3600 reads the gate as "backwards" and asks for the severities to be
 * reconciled; only half of that survives the invariant the gate enforces, which
 * is that a review ACTUALLY HAPPENED. `pending` means it has not happened yet,
 * so blocking is right — making it report-only would merge an unreviewed pull
 * request whenever a reviewer ran slow.
 * @module tests/unit/scripts/review-gate-conditions
 */
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

/** One verdict as this suite consumes it. */
interface Verdict {
  readonly state: string;
  readonly condition: string;
  readonly why: string;
}

/** The exports this suite exercises. */
interface GuardModule {
  readonly REVIEW_GATE_STATES: Record<string, string>;
  readonly REVIEW_GATE_CONDITIONS: Record<string, string>;
  readonly REVIEW_GATE_BLOCKING: readonly string[];
  readonly NEVER_BLOCKING: readonly string[];
  readonly VIOLATIONS: Record<string, string>;
  reviewGateState(
    reading: { present: boolean; state?: string; description?: string },
    vocabulary?: { waive?: readonly string[]; satisfy?: readonly string[] }
  ): Verdict;
}

let mod: GuardModule;

beforeAll(async () => {
  mod = (await import(
    pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
  )) as unknown as GuardModule;
});

describe("every condition the gate can observe is named", () => {
  it("names an absent check", () => {
    expect(mod.reviewGateState({ present: false }).condition).toBe(
      mod.REVIEW_GATE_CONDITIONS.absent
    );
  });

  it.each([["FAILURE"], ["ERROR"]])(
    "names a review that ran and objected (%s)",
    state => {
      expect(mod.reviewGateState({ present: true, state }).condition).toBe(
        mod.REVIEW_GATE_CONDITIONS.objected
      );
    }
  );

  it.each([["PENDING"], ["IN_PROGRESS"], [""]])(
    "names a reviewer that is merely late (%s)",
    state => {
      expect(mod.reviewGateState({ present: true, state }).condition).toBe(
        mod.REVIEW_GATE_CONDITIONS.pending
      );
    }
  );

  it("names an unrecognised success description", () => {
    expect(
      mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Something the vocabulary has never seen",
      }).condition
    ).toBe(mod.REVIEW_GATE_CONDITIONS.unrecognised);
  });

  it("names a waiver", () => {
    expect(
      mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Review rate limited",
      }).condition
    ).toBe(mod.REVIEW_GATE_CONDITIONS.waived);
  });

  it("names a review that ran", () => {
    expect(
      mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Review completed",
      }).condition
    ).toBe(mod.REVIEW_GATE_CONDITIONS.satisfied);
  });
});

describe("the four unsatisfying conditions are distinguishable", () => {
  // THE POINT OF THE CHANGE. Same severity, four different observations. This
  // case fails the moment anyone collapses them back into one token — which is
  // the state the gate shipped in.
  it("shares one severity across four distinct conditions", () => {
    const readings = [
      { present: false },
      { present: true, state: "FAILURE" },
      { present: true, state: "PENDING" },
      { present: true, state: "SUCCESS", description: "brand new phrase" },
    ];
    const verdicts = readings.map(reading => mod.reviewGateState(reading));

    expect(
      new Set(verdicts.map(verdict => verdict.state)),
      "all four are the same severity — that part is correct and unchanged"
    ).toEqual(new Set([mod.REVIEW_GATE_STATES.unsatisfied]));

    expect(
      new Set(verdicts.map(verdict => verdict.condition)).size,
      "but they are four different observations, and each needs a different response"
    ).toBe(4);
  });
});

describe("severity is unchanged — the gate was not weakened", () => {
  // Rejection controls. A suite that only asserted the new tokens would pass
  // just as well against a gate that had been quietly loosened to stop
  // blocking late reviewers, which is the change #3600 asks for and the
  // invariant forbids.
  it("still blocks a late reviewer rather than waving it through", () => {
    const verdict = mod.reviewGateState({ present: true, state: "PENDING" });

    expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
    expect(verdict.state).not.toBe(mod.REVIEW_GATE_STATES.waived);
    expect(verdict.state).not.toBe(mod.REVIEW_GATE_STATES.satisfied);
  });

  it("keeps unsatisfied blocking and waived report-only", () => {
    expect(mod.REVIEW_GATE_BLOCKING).toContain(
      mod.VIOLATIONS["reviewUnsatisfied"]
    );
    expect(mod.NEVER_BLOCKING).toContain(mod.VIOLATIONS["reviewWaived"]);
    expect(mod.NEVER_BLOCKING).not.toContain(
      mod.VIOLATIONS["reviewUnsatisfied"]
    );
  });

  it("still lets a genuine review through", () => {
    expect(
      mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Review completed",
      }).state
    ).toBe(mod.REVIEW_GATE_STATES.satisfied);
  });
});

describe("the late-reviewer message carries the only safe remedy", () => {
  // A re-request OVERWRITES the commit status rather than adding to it, so
  // under throttle it destroys a substantive objection one-way and replaces it
  // with a rate-limit string. That is a data-destroying operation available to
  // anyone triaging this red, and it was recorded in no ticket the gate points
  // at. Putting it in the message is the only place the person who needs it is
  // guaranteed to look.
  it("says to re-run, and warns against re-requesting", () => {
    const why = mod
      .reviewGateState({
        present: true,
        state: "PENDING",
      })
      .why.toLowerCase();

    expect(why).toContain("re-run");
    expect(why).toContain("do not re-request");
    expect(why).toContain("overwrites");
  });

  it("frames lateness as timing rather than as a verdict on the code", () => {
    const why = mod
      .reviewGateState({ present: true, state: "PENDING" })
      .why.toLowerCase();

    expect(why).toContain("lateness");
  });
});
