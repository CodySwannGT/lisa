/**
 * The decision table of the paired proof (CodySwannGT/lisa#4995).
 *
 * Two questions, each answered from what was observed and nothing else: what
 * one half of a proof showed, and what the two halves together say about the
 * control. Nothing here starts a process; the cases are the table.
 * @module tests/unit/controls/proof-judgement
 */
import { describe, expect, it } from "vitest";

import {
  entryVerdict,
  observeHalf,
  type HalfObservation,
} from "../../../src/controls/proof-judgement.js";
import type {
  ProofAnswer,
  ProofJudgement,
} from "../../../src/controls/proof-types.js";

const SHAPE = ["Found 1 error"];
const WRONG_REASON = "wrong-reason";
const NOT_MEASURED = "not-measured";

/**
 * An answer from a command that ran.
 * @param code - Its exit status
 * @param extra - Anything else the answer carries
 * @returns The answer
 */
function answered(
  code: number | null,
  extra: Partial<ProofAnswer> = {}
): ProofAnswer {
  return { command: ["check"], cwd: "/copy", code, output: "", ...extra };
}

/**
 * The gate runner's reading of an answer.
 * @param verdict - What it made of the answer
 * @param declared - Whether the output carried the declared failure text
 * @returns The reading
 */
function judged(
  verdict: ProofJudgement["verdict"],
  declared = false
): ProofJudgement {
  return { verdict, declared, matched: declared ? SHAPE : [] };
}

describe("what one half of a proof showed", () => {
  it("is accepted when the command passed", () => {
    expect(observeHalf(answered(0), judged("passed"), SHAPE)).toEqual({
      outcome: "accepted",
      reason: "accepted",
    });
  });

  it("is rejected only when the command failed with the declared failure text", () => {
    expect(observeHalf(answered(1), judged("failed", true), SHAPE)).toEqual({
      outcome: "rejected",
      reason: "rejected-as-declared",
    });
  });

  it.each([
    ["a failure the gate runner recognises", judged("failed")],
    ["a failure nothing recognises", judged(NOT_MEASURED)],
  ])(
    "is unknown for %s that does not carry the declared failure text",
    (_, judgement) => {
      expect(observeHalf(answered(1), judgement, SHAPE)).toEqual({
        outcome: "unknown",
        reason: WRONG_REASON,
      });
    }
  );

  it("is unknown when the entry declares no failure text to match", () => {
    expect(observeHalf(answered(1), judged("failed"), [])).toEqual({
      outcome: "unknown",
      reason: "no-failure-shape",
    });
  });

  it("is still accepted with no failure text declared: a pass needs none", () => {
    expect(observeHalf(answered(0), judged("passed"), []).outcome).toBe(
      "accepted"
    );
  });

  it("is unknown when the text is there but the gate runner says nothing was measured", () => {
    expect(observeHalf(answered(1), judged(NOT_MEASURED, true), SHAPE)).toEqual(
      { outcome: "unknown", reason: "nothing-measured" }
    );
  });

  it("is unknown for exit 0 from a run the gate runner does not believe", () => {
    expect(observeHalf(answered(0), judged(NOT_MEASURED), SHAPE)).toEqual({
      outcome: "unknown",
      reason: "nothing-measured",
    });
  });

  it("is unknown when the command was stopped at its time limit", () => {
    expect(
      observeHalf(
        answered(null, { timedOut: true }),
        judged("killed", true),
        SHAPE
      )
    ).toEqual({ outcome: "unknown", reason: "timed-out" });
  });

  it("is unknown when the command was killed", () => {
    expect(observeHalf(answered(null), judged("killed"), SHAPE)).toEqual({
      outcome: "unknown",
      reason: "killed",
    });
  });

  it("is unknown when the command never started", () => {
    expect(
      observeHalf(
        answered(null, { notStarted: "the program was not found" }),
        judged(NOT_MEASURED),
        SHAPE
      )
    ).toEqual({ outcome: "unknown", reason: "not-started" });
  });

  it("never reads a command with no exit status as accepted or rejected", () => {
    const judgements: readonly ProofJudgement[] = [
      judged("passed"),
      judged("failed", true),
    ];

    expect(
      judgements.map(
        judgement => observeHalf(answered(null), judgement, SHAPE).outcome
      )
    ).toEqual(["unknown", "unknown"]);
  });
});

describe("what the two halves say about a control", () => {
  const rejected: HalfObservation = {
    outcome: "rejected",
    reason: "rejected-as-declared",
  };
  const accepted: HalfObservation = { outcome: "accepted", reason: "accepted" };
  const timedOut: HalfObservation = { outcome: "unknown", reason: "timed-out" };
  const wrongReason: HalfObservation = {
    outcome: "unknown",
    reason: WRONG_REASON,
  };

  it("passes only when the bad change was rejected and the clean one accepted", () => {
    expect(entryVerdict(rejected, accepted)).toEqual({
      outcome: "passed",
      failed_halves: [],
      reason: "proved",
    });
  });

  it("fails on the clean half when the gate rejects everything", () => {
    expect(entryVerdict(rejected, rejected)).toEqual({
      outcome: "failed",
      failed_halves: ["clean"],
      reason: "clean-rejected",
    });
  });

  it("fails on the violating half when the gate accepts everything", () => {
    expect(entryVerdict(accepted, accepted)).toEqual({
      outcome: "failed",
      failed_halves: ["violation"],
      reason: "violation-accepted",
    });
  });

  it("fails on both halves when the gate has them the wrong way round", () => {
    expect(entryVerdict(accepted, rejected)).toEqual({
      outcome: "failed",
      failed_halves: ["violation", "clean"],
      reason: "violation-accepted-clean-rejected",
    });
  });

  it("is unknown when the bad change was turned away for another reason", () => {
    expect(entryVerdict(wrongReason, accepted)).toEqual({
      outcome: "unknown",
      failed_halves: [],
      reason: WRONG_REASON,
    });
  });

  it("is unknown when the clean half gave no answer", () => {
    expect(entryVerdict(rejected, timedOut)).toEqual({
      outcome: "unknown",
      failed_halves: [],
      reason: "timed-out",
    });
  });

  it("names the first half that gave no answer when neither did", () => {
    expect(entryVerdict(wrongReason, timedOut).reason).toBe(WRONG_REASON);
  });

  it("still fails when one half failed and the other gave no answer", () => {
    expect(entryVerdict(accepted, timedOut)).toMatchObject({
      outcome: "failed",
      failed_halves: ["violation"],
    });
    expect(entryVerdict(timedOut, rejected)).toMatchObject({
      outcome: "failed",
      failed_halves: ["clean"],
    });
  });

  it("passes in exactly one of the nine combinations", () => {
    const each = [rejected, accepted, timedOut];
    const outcomes = each.flatMap(violation =>
      each.map(clean => entryVerdict(violation, clean).outcome)
    );

    expect(outcomes.filter(outcome => outcome === "passed")).toHaveLength(1);
  });
});
