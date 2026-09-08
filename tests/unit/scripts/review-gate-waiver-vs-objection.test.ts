/**
 * A waiver may not cover a review that HAPPENED (#3706).
 *
 * The review gate classified an evidence-bearing check from two inputs only:
 * the status `state` and its `description`. When the description matched an
 * entitlement waiver the verdict was `waived`, which publishes the check-run
 * conclusion `neutral`, which blocks nothing and merges.
 *
 * **The description is not a function of whether a review happened.** Measured
 * on CodySwannGT/lisa#3762: the check reported `success` with the description
 * `Review rate limited` and the vendor HAD reviewed, posting
 * `CHANGES_REQUESTED` with a comment that found a real defect. The same string
 * therefore carries two opposite facts, and the gate collapsed them in the
 * PERMISSIVE direction — a pull request a reviewer objected to rendered
 * `neutral` and merged.
 *
 * Re-measured on this repository 2026-09-06, the last 40 merged pull requests,
 * reading the `CodeRabbit` status on each head SHA: 34 reported `Review rate
 * limited` and 6 `Review completed`. Of those 34 waived merges, **7 carried
 * review activity** (`reviews.totalCount > 0`) while the gate's published
 * verdict asserted "this pull request is UNREVIEWED". So the collapse is not a
 * corner case reachable only in theory: one waived merge in five here is a
 * pull request the waiver described wrongly.
 *
 * ## What this suite pins, and what it deliberately does not
 *
 * The owner's ruling on #3221 and again on #3706 stands and is pinned below as
 * a rejection control: a GENUINELY unreviewed pull request under a rate limit
 * still waives, still renders `neutral`, and still merges, because a pull
 * request author cannot fix a vendor entitlement. Nothing here reddens that
 * path, and a change that did would be caught by
 * `waives a rate-limited check on a pull request with no review activity`.
 *
 * What changes is only the case the waiver was never entitled to cover: review
 * activity EXISTS at the head. An objection there is `unsatisfied`; review
 * activity without an objection stays `waived` but stops asserting that nobody
 * reviewed.
 *
 * ## The authority for "a review happened"
 *
 * Not the check's conclusion and not its description — both were measured
 * saying the wrong thing. `reviewDecision` and `reviewThreads` on the pull
 * request itself, which is the only surface that answers the question, and
 * which `gh pr checks` cannot see at all. `reviewDecision` is GitHub's own
 * computation of the latest state per reviewer, so a DISMISSED objection is
 * not resurrected here — that failure direction is #3720's and this must not
 * manufacture it.
 * @module tests/unit/scripts/review-gate-waiver-vs-objection
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

/** The measured vendor string that means opposite things on two pull requests. */
const RATE_LIMITED = "Review rate limited";

/** One verdict as this suite consumes it. */
interface Verdict {
  readonly state: string;
  readonly condition: string;
  readonly why: string;
}

/**
 * What a pull request's own review surface reported, as the gate reads it.
 *
 * `read` is a fact about the READ and the field every consumer branches on
 * first; `present` and `objected` only mean anything when it is true.
 */
interface ReviewActivity {
  readonly read: boolean;
  readonly present: boolean;
  readonly objected: boolean;
}

/** The exports this suite exercises. */
interface GuardModule {
  readonly REVIEW_GATE_STATES: Record<string, string>;
  readonly REVIEW_GATE_CONDITIONS: Record<string, string>;
  readonly REVIEW_VERDICT_CONCLUSIONS: Record<string, string>;
  readonly REVIEW_GATE_BLOCKING: readonly string[];
  readonly NEVER_BLOCKING: readonly string[];
  readonly VIOLATIONS: Record<string, string>;
  reviewGateState(
    reading: {
      present: boolean;
      state?: string;
      description?: string;
      reviewActivity?: ReviewActivity | undefined;
    },
    vocabulary?: { waive?: readonly string[]; satisfy?: readonly string[] }
  ): Verdict;
  evaluateReviewGate(
    declaration: Record<string, unknown>,
    checks: ReadonlyArray<{
      name: string;
      state: string;
      description?: string;
    }>,
    options?: { headSha?: string; reviewActivity?: ReviewActivity }
  ): {
    violations: ReadonlyArray<{ kind: string; condition: string }>;
    states: Record<string, string>;
    conditions: Record<string, string>;
    descriptions: Record<string, string>;
  };
  reviewGateVerdict(reading: {
    states?: Record<string, string>;
    conditions?: Record<string, string>;
    descriptions?: Record<string, string>;
  }): { verdict: string; conclusion: string; title: string };
  readonly UNREAD_REVIEW_ACTIVITY: ReviewActivity;
  reviewActivityFrom(payload: unknown): ReviewActivity;
  inspectVacuity(
    argv: readonly string[],
    declaration: Record<string, unknown>,
    options?: Record<string, unknown>
  ):
    | {
        violations: ReadonlyArray<{ kind: string }>;
        verdict: { conclusion: string; title: string };
      }
    | undefined;
}

let mod: GuardModule;

/** The one declared evidence-bearing check every case below reads. */
const DECLARATION = {
  evidence_bearing_checks: { CodeRabbit: { satisfy: [] } },
} as const;

beforeAll(async () => {
  mod = (await import(
    pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
  )) as unknown as GuardModule;
});

describe("a waiver cannot cover a review that objected", () => {
  it("refuses to waive a rate-limited check when the pull request carries an objection", () => {
    const verdict = mod.reviewGateState({
      present: true,
      state: "SUCCESS",
      description: RATE_LIMITED,
      reviewActivity: { read: true, present: true, objected: true },
    });

    expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
    expect(verdict.condition).toBe(mod.REVIEW_GATE_CONDITIONS.objected);
    expect(verdict.state).not.toBe(mod.REVIEW_GATE_STATES.waived);
  });

  it("publishes that objection as `failure`, never as the `neutral` a waiver publishes", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: "CodeRabbit", state: "SUCCESS", description: RATE_LIMITED }],
      { reviewActivity: { read: true, present: true, objected: true } }
    );
    const verdict = mod.reviewGateVerdict(gate);

    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied);
    expect(verdict.conclusion).not.toBe(mod.REVIEW_VERDICT_CONCLUSIONS.waived);
  });

  it("routes the objection to the kind that can block, not to the waiver kind", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: "CodeRabbit", state: "SUCCESS", description: RATE_LIMITED }],
      { reviewActivity: { read: true, present: true, objected: true } }
    );

    expect(gate.violations).toHaveLength(1);
    expect(mod.REVIEW_GATE_BLOCKING).toContain(gate.violations[0]?.kind);
    expect(mod.NEVER_BLOCKING).not.toContain(gate.violations[0]?.kind);
  });

  it("does not call an objected pull request UNREVIEWED in the published title", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: "CodeRabbit", state: "SUCCESS", description: RATE_LIMITED }],
      { reviewActivity: { read: true, present: true, objected: true } }
    );

    expect(mod.reviewGateVerdict(gate).title).not.toContain("UNREVIEWED");
  });
});

describe("a waiver stops asserting that nobody reviewed", () => {
  it("waives without the UNREVIEWED claim when review activity exists but does not object", () => {
    const verdict = mod.reviewGateState({
      present: true,
      state: "SUCCESS",
      description: RATE_LIMITED,
      reviewActivity: { read: true, present: true, objected: false },
    });

    expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.waived);
    expect(verdict.condition).toBe(mod.REVIEW_GATE_CONDITIONS.waivedWithReview);
    expect(verdict.why).not.toContain("UNREVIEWED");
  });

  it("still publishes that as `neutral`, so the owner's waiver keeps its severity", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: "CodeRabbit", state: "SUCCESS", description: RATE_LIMITED }],
      { reviewActivity: { read: true, present: true, objected: false } }
    );

    expect(mod.reviewGateVerdict(gate).conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.waived
    );
    expect(gate.violations[0]?.kind).toBe(mod.VIOLATIONS.reviewWaived);
  });

  it("drops the UNREVIEWED claim from the PUBLISHED TITLE, which is what gets quoted", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: "CodeRabbit", state: "SUCCESS", description: RATE_LIMITED }],
      { reviewActivity: { read: true, present: true, objected: false } }
    );
    const title = mod.reviewGateVerdict(gate).title;

    expect(title).toContain("WAIVED");
    expect(title).not.toContain("is UNREVIEWED");
    expect(title).toContain("do NOT record it as unreviewed");
  });

  it("still leads with UNREVIEWED when the pull request really carries nothing", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: "CodeRabbit", state: "SUCCESS", description: RATE_LIMITED }],
      { reviewActivity: { read: true, present: false, objected: false } }
    );

    expect(mod.reviewGateVerdict(gate).title).toContain(
      "this pull request is UNREVIEWED"
    );
  });
});

describe("rejection controls: the paths this change must NOT move", () => {
  it("waives a rate-limited check on a pull request with no review activity", () => {
    const verdict = mod.reviewGateState({
      present: true,
      state: "SUCCESS",
      description: RATE_LIMITED,
      reviewActivity: { read: true, present: false, objected: false },
    });

    expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.waived);
    expect(verdict.condition).toBe(mod.REVIEW_GATE_CONDITIONS.waived);
  });

  it("waives when the review surface could NOT be read, rather than manufacturing a red", () => {
    for (const reviewActivity of [undefined, mod.UNREAD_REVIEW_ACTIVITY]) {
      const verdict = mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: RATE_LIMITED,
        reviewActivity,
      });

      expect(verdict.state).toBe(mod.REVIEW_GATE_STATES.waived);
      expect(verdict.state).not.toBe(mod.REVIEW_GATE_STATES.unsatisfied);
    }
  });

  it("says the waiver is unverified when the review surface could not be read", () => {
    for (const reviewActivity of [undefined, mod.UNREAD_REVIEW_ACTIVITY]) {
      expect(
        mod.reviewGateState({
          present: true,
          state: "SUCCESS",
          description: RATE_LIMITED,
          reviewActivity,
        }).why
      ).toContain("could not be read");
    }
  });

  it("still satisfies a completed review, whatever the review surface says", () => {
    expect(
      mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Review completed",
        reviewActivity: { read: true, present: false, objected: false },
      }).state
    ).toBe(mod.REVIEW_GATE_STATES.satisfied);
  });

  it("still refuses an unrecognised description, review activity or not", () => {
    expect(
      mod.reviewGateState({
        present: true,
        state: "SUCCESS",
        description: "Review partially completed",
        reviewActivity: { read: true, present: true, objected: false },
      }).condition
    ).toBe(mod.REVIEW_GATE_CONDITIONS.unrecognised);
  });

  it("still reports an absent check as absent, review activity or not", () => {
    expect(
      mod.reviewGateState({
        present: false,
        reviewActivity: { read: true, present: true, objected: false },
      }).condition
    ).toBe(mod.REVIEW_GATE_CONDITIONS.absent);
  });
});

describe("reading the review surface GitHub actually answers with", () => {
  it("reports an objection from `reviewDecision`", () => {
    expect(
      mod.reviewActivityFrom({
        reviewDecision: "CHANGES_REQUESTED",
        reviews: { totalCount: 1 },
        reviewThreads: { totalCount: 0, nodes: [] },
      })
    ).toEqual({ read: true, present: true, objected: true });
  });

  it("reports an objection from an unresolved review thread", () => {
    expect(
      mod.reviewActivityFrom({
        reviewDecision: null,
        reviews: { totalCount: 0 },
        reviewThreads: { totalCount: 1, nodes: [{ isResolved: false }] },
      })
    ).toEqual({ read: true, present: true, objected: true });
  });

  it("reports review activity without an objection when every thread is resolved", () => {
    expect(
      mod.reviewActivityFrom({
        reviewDecision: "APPROVED",
        reviews: { totalCount: 2 },
        // All three threads, not one of three. The fixture used to declare
        // `totalCount: 3` while supplying a single node, which is a truncated
        // page rather than the "every thread is resolved" case in the name —
        // harmless while nothing read `totalCount`, and wrong as soon as
        // something did. The assertion is unchanged; the input now matches what
        // it claims to be.
        reviewThreads: {
          totalCount: 3,
          nodes: [
            { isResolved: true },
            { isResolved: true },
            { isResolved: true },
          ],
        },
      })
    ).toEqual({ read: true, present: true, objected: false });
  });

  it("will not call a truncated thread page `no objection`", () => {
    // Raised in review. The query asks for the first 50 threads. A pull request
    // with more than that, whose only unresolved thread sorts past the page,
    // returned `objected: false` — and a neutral waiver was then allowed to
    // cover a live objection.
    //
    // The fix reads `totalCount`, which the query already requests, so the
    // shortfall is visible without a second request. UNREAD is the honest
    // answer: the page seen genuinely does not say whether anybody objected.
    expect(
      mod.reviewActivityFrom({
        reviewDecision: null,
        reviews: { totalCount: 1 },
        reviewThreads: {
          totalCount: 51,
          nodes: Array.from({ length: 50 }, () => ({ isResolved: true })),
        },
      })
    ).toEqual({ read: false, present: false, objected: false });
  });

  it("still reports an objection it can SEE, even on a truncated page", () => {
    // The two verdicts do not need the same evidence, and collapsing them into
    // "truncated means unread" would throw away a sound answer: a thread nobody
    // fetched cannot un-object the unresolved one already in hand. Without this
    // the fix above would trade a false negative for a lost true positive.
    expect(
      mod.reviewActivityFrom({
        reviewDecision: null,
        reviews: { totalCount: 1 },
        reviewThreads: {
          totalCount: 99,
          nodes: [{ isResolved: true }, { isResolved: false }],
        },
      })
    ).toEqual({ read: true, present: true, objected: true });
  });

  it("reports no activity for the genuinely unreviewed pull request", () => {
    expect(
      mod.reviewActivityFrom({
        reviewDecision: null,
        reviews: { totalCount: 0 },
        reviewThreads: { totalCount: 0, nodes: [] },
      })
    ).toEqual({ read: true, present: false, objected: false });
  });

  it("says the read FAILED — never `no activity` — for a payload it cannot read", () => {
    expect(mod.reviewActivityFrom(undefined)).toEqual({
      read: false,
      present: false,
      objected: false,
    });
    expect(mod.reviewActivityFrom({ reviews: null })).toEqual({
      read: false,
      present: false,
      objected: false,
    });
  });

  it("never spends a failed read as the value that grants a silent waiver", () => {
    // `{read: true, present: false}` is the ONLY value that lets a waiver pass
    // without saying it was uncorroborated. A failed read must not be able to
    // produce it — that is the fail-open shape #3848's guard refuses.
    expect(mod.UNREAD_REVIEW_ACTIVITY.read).toBe(false);
    expect(mod.reviewActivityFrom("not an object").read).toBe(false);
  });
});

/**
 * A pure classifier nothing calls is the defect one square over.
 *
 * The gate's own family of findings is "a control that reports a conclusion it
 * never reached", and a fix that lives only in an unwired function is the same
 * object: the unit tests above would go green while every real pull request
 * kept merging on a waiver that never consulted the review surface. These
 * exercise `inspectVacuity`, which is what the workflow runs.
 */
describe("the review surface is actually read on the path the workflow runs", () => {
  /** A declaration with one evidence-bearing check, as this repository ships. */
  const declaration = {
    required_contexts: ["CodeRabbit"],
    workflows: [".github/workflows/ci.yml"],
    skip_job_declarations: {},
    evidence_bearing_checks: { CodeRabbit: {} },
  };

  /**
   * Runs the arm the workflow runs, with every network seam injected.
   *
   * @param description - What the CodeRabbit status reported
   * @param activity - What the injected review surface returns
   * @returns The inspection, plus how many times the surface was read
   */
  const inspect = (
    description: string,
    activity: ReviewActivity | undefined
  ): {
    inspection: ReturnType<GuardModule["inspectVacuity"]>;
    reads: number;
  } => {
    let reads = 0;
    const inspection = mod.inspectVacuity(
      ["--vacuity", "--pr=1", "--settle-timeout=0"],
      declaration,
      {
        headSha: () => "0f0f0f0f",
        fetch: () => [
          { name: "CodeRabbit", state: "SUCCESS", bucket: "pass", description },
        ],
        reviewActivity: () => {
          reads += 1;
          return activity;
        },
        fetchCarried: () => [],
      }
    );
    return { inspection, reads };
  };

  it("turns a waived merge into a blocking failure when the surface shows an objection", () => {
    const { inspection, reads } = inspect(RATE_LIMITED, {
      read: true,
      present: true,
      objected: true,
    });

    expect(reads).toBe(1);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
    );
    expect(inspection?.verdict.title).toContain("OBJECTED");
    // The vacuity arm files its own report-only finding on the same row, so
    // this names the review-gate kind rather than trusting an ordering.
    expect(
      (inspection?.violations ?? []).map(violation => violation.kind)
    ).toContain(mod.VIOLATIONS.reviewUnsatisfied);
    expect(
      (inspection?.violations ?? []).map(violation => violation.kind)
    ).not.toContain(mod.VIOLATIONS.reviewWaived);
  });

  it("still waives, and still publishes `neutral`, when the surface shows nothing", () => {
    const { inspection, reads } = inspect(RATE_LIMITED, {
      read: true,
      present: false,
      objected: false,
    });

    expect(reads).toBe(1);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.waived
    );
  });

  it("does not read the surface at all when the review gate is satisfied", () => {
    const { inspection, reads } = inspect("Review completed", undefined);

    expect(reads).toBe(0);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.satisfied
    );
  });
});
