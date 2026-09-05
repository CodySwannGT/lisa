/**
 * Tests for the push-side success line saying WHY it passed.
 *
 * ## The two states that shared a sentence
 *
 * When the deferral added for CodySwannGT/lisa#3851 fires — the push range holds
 * only merge commits, so the pull request's own range carries the requirement —
 * the gate printed a line byte-identical to the one it prints when the range was
 * simply empty:
 *
 * ```
 * B  WORK_ITEM_TRACKING_OK 0 commit(s), PR body, and tracker backlink   ← empty range
 * C  WORK_ITEM_TRACKING_OK 0 commit(s), PR body, and tracker backlink   ← deferral
 * ```
 *
 * Both statements are true. They are not the same fact: one says the subject is
 * one level up, the other says there was nothing to look at. **Only the range
 * separates them, and the range is not in the output**, so attribution required
 * measuring it by hand and reading the source — neither of which an operator
 * reading a push transcript has (CodySwannGT/lisa#3886).
 *
 * `alreadyTraced` explains a zero only for `protectedExempt`, and a back-merge
 * onto a feature branch has none, so the zero went unexplained.
 *
 * ## Why the third scenario is the one that matters
 *
 * A fix that added a clause to only one branch, or the same clause to both,
 * would satisfy "a deferral says it deferred" and "an empty range does not claim
 * one" while leaving the states indistinguishable — which IS the defect. So the
 * load-bearing assertion is a direct **inequality between the two rendered
 * lines**, and `pushSuccessLine` is exported so both can be produced in one
 * process. A test that read one shape out of a subprocess transcript would pin
 * whichever it reproduced and say nothing about the other.
 *
 * ## What this must not do
 *
 * Relax anything. The clause is appended to a line that already said OK; the
 * verdict, the exit status and every gate are untouched. A diagnostic fix that
 * also softened enforcement would not be a diagnostic fix, so the last case here
 * is the refusal control.
 * @module tests/unit/scripts/work-item-push-success-attribution
 */

import { describe, expect, it } from "vitest";

import { pushSuccessLine } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

/** A commit-side result, with the fields this line reads. */
const result = (over: {
  relevant?: number;
  mergeExempt?: number;
  protectedExempt?: number;
  verify?: string;
}): Record<string, unknown> => ({
  contract: { verify: over.verify ?? "full" },
  mergeExempt: over.mergeExempt ?? 0,
  protectedExempt: over.protectedExempt ?? 0,
  relevant: over.relevant ?? 0,
  releaseExempt: 0,
});

/** The clause that separates the two zero-commit states. */
const MERGE_CLAUSE = "merge commit(s)";

/** State B: the range was empty and a pull request exists. */
const EMPTY_RANGE = pushSuccessLine(result({}), "");

/** State C: the range held only merge commits, so the PR's range carries it. */
const MERGE_ONLY = pushSuccessLine(result({ mergeExempt: 2 }), "");

describe("the two zero-commit states are distinguishable", () => {
  it("renders different lines for an empty range and a deferral", () => {
    // THE acceptance criterion. Everything else in this file describes the two
    // strings; this asserts the property the ticket is about, directly.
    expect(EMPTY_RANGE).not.toBe(MERGE_ONLY);
  });

  it("both still report the same verdict, because only the wording changed", () => {
    // The corollary that keeps a diagnostic fix a diagnostic fix. Neither line
    // stops being a success, and neither gains a caveat that reads as one.
    expect(EMPTY_RANGE.startsWith("WORK_ITEM_TRACKING_OK")).toBe(true);
    expect(MERGE_ONLY.startsWith("WORK_ITEM_TRACKING_OK")).toBe(true);
  });
});

describe("a deferral says it deferred", () => {
  it("states the merge count", () => {
    expect(MERGE_ONLY).toContain(`2 ${MERGE_CLAUSE}`);
  });

  it("says the pull request's own range carries the requirement", () => {
    // The half a reader acts on: it names WHERE the check happens instead,
    // rather than merely admitting this push did not do it.
    expect(MERGE_ONLY).toContain(
      "the pull request's own range carries the requirement"
    );
  });

  it("says this push introduced no authored work", () => {
    // Without this the merge count reads as a count of things that WERE
    // checked, which is the opposite of what it means.
    expect(MERGE_ONLY).toContain("introduces no authored work");
  });
});

describe("an empty range does not claim to have deferred", () => {
  it("carries no merge-commit clause", () => {
    // The rejection control on the other side. A clause rendered in both
    // branches would satisfy every assertion above and restore the collision.
    expect(EMPTY_RANGE).not.toContain(MERGE_CLAUSE);
    expect(EMPTY_RANGE).not.toContain("carries the requirement");
  });

  it("is exactly the line it always was", () => {
    // Pinned verbatim: this is the shape thousands of pushes already print, and
    // changing it was not asked for. A fix that rewrote the common case to make
    // the rare one legible would be paid for by every reader.
    expect(EMPTY_RANGE).toBe(
      "WORK_ITEM_TRACKING_OK 0 commit(s), PR body, and tracker backlink"
    );
  });
});

describe("the clause is scoped to the state that earns it", () => {
  it("stays silent when the range had authored work of its own", () => {
    // `mergeExempt` alone does not mean deferral. A push carrying three
    // trailered commits AND a merge proved its own subject here, so claiming
    // the pull request carries it would be false in the useful direction.
    const withWork = pushSuccessLine(
      result({ mergeExempt: 1, relevant: 3 }),
      ""
    );

    expect(withWork).toContain("3 commit(s)");
    expect(withWork).not.toContain(MERGE_CLAUSE);
  });

  it("renders beside the deploy-chain clause rather than replacing it", () => {
    // A back-merge onto a deploy-chain branch is both: commits traced where
    // they were authored, and merges whose subject is the pull request. Both
    // sentences are true and the reader needs both.
    const both = pushSuccessLine(
      result({ mergeExempt: 2, protectedExempt: 4 }),
      ""
    );

    expect(both).toContain("4 already on a deploy-chain branch");
    expect(both).toContain(`2 ${MERGE_CLAUSE}`);
  });

  it("keeps the ref label a multi-ref push prefixes", () => {
    expect(
      pushSuccessLine(result({ mergeExempt: 2 }), "refs/heads/x: ")
    ).toContain("OK refs/heads/x: 0 commit(s)");
  });

  it("still says what a trailer-level run did NOT prove", () => {
    // `provedHere` must survive the change: a `trailer` run that claimed a
    // tracker backlink would be asserting a check it deliberately skipped.
    const trailerLevel = pushSuccessLine(
      result({ mergeExempt: 2, verify: "trailer" }),
      ""
    );

    expect(trailerLevel).toContain("the tracker was not contacted");
    expect(trailerLevel).toContain(`2 ${MERGE_CLAUSE}`);
  });
});
