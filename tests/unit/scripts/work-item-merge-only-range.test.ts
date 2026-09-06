/**
 * The precondition the merge-only deferral actually means to assert (#3921).
 *
 * ## Two claims that agreed by accident
 *
 * The deferral shipped as `rangeIsPartial && relevant === 0 && mergeExempt > 0`.
 * `mergeExempt > 0` is satisfied by a range in which SOME commits are merges,
 * which is strictly weaker than the thing that makes "there is no authored work
 * here to trace" true — that EVERY commit in the range was exempt. The right
 * answer came out anyway because `relevant === 0` was carrying that claim, so
 * the two conjuncts agreed by coincidence rather than by construction, and a
 * refactor that loosened `relevant` would have taken the deferral with it in
 * silence. No defect was ever observed; that is an argument for tightening the
 * condition while it is cheap, not for leaving it.
 *
 * ## Why the first case is the control
 *
 * `mergeOnlyRange` now reads the denominator directly: the exemptions have to
 * add up to the commits examined. The load-bearing case is therefore a result
 * whose counters DO NOT add up — a range with a merge and one commit that is
 * neither exempt nor counted relevant. The old condition defers on it; this one
 * refuses to. Every other case here passes under both conditions and exists to
 * pin what must not change.
 *
 * ## Why it is not `mergeExempt === examined`
 *
 * "Nothing but merges" is a different, stronger claim than "nothing authored".
 * A back-merge of a non-default deploy branch drags release commits along with
 * the merge; the range still introduced no authored work, and refusing it would
 * reopen the #3851 deadlock through the door the deferral closed. The
 * merges-plus-release case below is that rejection control.
 * @module tests/unit/scripts/work-item-merge-only-range
 */

import { describe, expect, it } from "vitest";

import { mergeOnlyRange } from "../../../all/copy-overwrite/scripts/lisa-work-item.mjs";

/**
 * A commit-side result carrying only the counters the predicate reads.
 *
 * `examined` is passed explicitly on every case, because the whole subject of
 * this file is whether the predicate reads it rather than inferring it.
 * @param over - The counters this case varies
 * @returns A result object shaped like `validateCommits` returns
 */
const result = (over: {
  examined: number;
  relevant?: number;
  mergeExempt?: number;
  protectedExempt?: number;
  releaseExempt?: number;
}): Record<string, unknown> => ({
  examined: over.examined,
  mergeExempt: over.mergeExempt ?? 0,
  protectedExempt: over.protectedExempt ?? 0,
  relevant: over.relevant ?? 0,
  releaseExempt: over.releaseExempt ?? 0,
});

describe("a range that authored something does not defer", () => {
  it("refuses to defer when the exemptions do not account for the range", () => {
    // THE control. One merge and one commit that no exemption claimed: the
    // range introduced authored work, so the commit-side question has a subject
    // HERE and the pull request does not carry it. The superseded condition
    // (`relevant === 0 && mergeExempt > 0`) defers on exactly this input, which
    // is why `relevant` is pinned to 0 — this asserts the predicate stands on
    // its own rather than on a counter another function maintains.
    expect(mergeOnlyRange(result({ examined: 2, mergeExempt: 1 }))).toBe(false);
  });

  it("refuses to defer on a range of trailered commits plus a merge", () => {
    // The ordinary shape of the same fact, with `relevant` telling the truth.
    expect(
      mergeOnlyRange(result({ examined: 4, mergeExempt: 1, relevant: 3 }))
    ).toBe(false);
  });
});

describe("a range with no authored work defers", () => {
  it("defers when every commit examined was a merge", () => {
    expect(mergeOnlyRange(result({ examined: 3, mergeExempt: 3 }))).toBe(true);
  });

  it("defers when the merges came with release commits", () => {
    // The rejection control on over-tightening. `mergeExempt === examined`
    // would refuse this and refuse a legitimate back-merge of a deploy branch
    // with "no non-merge commit linked to a work item" — the #3851 deadlock.
    expect(
      mergeOnlyRange(result({ examined: 3, mergeExempt: 1, releaseExempt: 2 }))
    ).toBe(true);
  });

  it("defers when the merges came with deploy-chain commits", () => {
    expect(
      mergeOnlyRange(
        result({ examined: 5, mergeExempt: 1, protectedExempt: 4 })
      )
    ).toBe(true);
  });
});

describe("the states that are exempt for some other reason", () => {
  it("does not call an empty range a deferral", () => {
    // Nothing was examined, so nothing was deferred. Saying otherwise is the
    // collision #3886 fixed, restored one layer down.
    expect(mergeOnlyRange(result({ examined: 0 }))).toBe(false);
  });

  it("does not claim a release-only range deferred to a pull request", () => {
    // A release push has its own exemption and its own wording. A merge is what
    // makes the subject live one level up; without one there is no pull request
    // this range's requirement was handed to.
    expect(mergeOnlyRange(result({ examined: 2, releaseExempt: 2 }))).toBe(
      false
    );
  });

  it("does not claim a deploy-chain-only range deferred to a pull request", () => {
    // Traced where authored, which is a different sentence the success line
    // already renders separately.
    expect(mergeOnlyRange(result({ examined: 2, protectedExempt: 2 }))).toBe(
      false
    );
  });

  it("is false rather than throwing when there is no result at all", () => {
    // The commit side can fail before producing one; the caller reads this
    // predicate on the error path too.
    expect(mergeOnlyRange(undefined)).toBe(false);
  });
});
