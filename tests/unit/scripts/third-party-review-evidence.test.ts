/**
 * Tests for the third-party review evidence prover (issue #3591).
 *
 * The assertion that carries the most weight is the fail-closed one. Every
 * other case here describes a string somebody has already seen; that one
 * describes the string nobody has seen yet, and it is the only assertion that
 * survives the vocabulary changing under it. A denylist implementation passes
 * every other test in this file and fails that one — which is precisely how a
 * green-but-inert review gate is built.
 *
 * The reviewer-object cases are separate on purpose. An empty-bodied `APPROVED`
 * review is an ordinary human approval, and the moment empty-description
 * reasoning leaks from status descriptions onto review objects, real approvals
 * start reading as hollow.
 * @module tests/unit/scripts/third-party-review-evidence
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyReviewObject,
  configuredReviewers,
  EVIDENCE_OUTCOMES,
  EVIDENCE_READINGS,
  humanReport,
  main,
  readReviewerEvidence,
  REVIEW_OBJECT_VERDICTS,
  reviewEvidenceVerdict,
  substituteMarker,
  substitutePosted,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";
import { validateGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const CONTEXT = "Example Reviewer";
const OTHER_CONTEXT = "Second Reviewer";
const REVIEWED_WHEN = "Review completed";
/** The most common no-work description a throttled reviewer posts. */
const THROTTLED = "Review rate limited";
const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

/** One gates block declaring a single third-party reviewer. */
const ONE_REVIEWER = {
  "code-review": {
    "pull-request": {
      level: "required",
      await: CONTEXT,
      evidence: { reviewer: true, proof: [REVIEWED_WHEN] },
    },
  },
};

/**
 * The reviewer list this project's gates declare.
 * @param gates - A gates block
 * @returns The resolved reviewers
 */
const reviewersOf = (gates: object) =>
  configuredReviewers({ gates }) as ReadonlyArray<{
    context: string;
    proof: string[];
  }>;

/**
 * Read one reviewer's evidence off a single status description.
 * @param description - The status description to present
 * @returns The reading
 */
const readingFor = (description: string | null | undefined) =>
  readReviewerEvidence({
    reviewer: reviewersOf(ONE_REVIEWER)[0],
    statuses: [{ context: CONTEXT, state: "success", description }],
  });

/**
 * The whole verdict for one head, given statuses and comments.
 * @param options - Statuses and comments to present
 * @param options.statuses - Commit statuses at the head
 * @param options.comments - Issue comments on the pull request
 * @param options.gates - The gates block, defaulting to one reviewer
 * @returns The verdict
 */
const verdictFor = ({
  statuses = [],
  comments = [],
  gates = ONE_REVIEWER,
}: {
  statuses?: ReadonlyArray<object>;
  comments?: ReadonlyArray<{ body: string }>;
  gates?: object;
}) =>
  reviewEvidenceVerdict({
    reviewers: reviewersOf(gates),
    statuses,
    comments,
    sha: HEAD,
  });

describe("configuredReviewers", () => {
  it("returns an empty list when no gate declares a reviewer", () => {
    expect(
      reviewersOf({
        "code-review": {
          "pull-request": { level: "required", await: CONTEXT },
        },
      })
    ).toEqual([]);
  });

  it("ignores a gate that marks a reviewer but awaits nothing", () => {
    expect(
      reviewersOf({
        "code-review": {
          "pull-request": {
            level: "required",
            run: "review",
            evidence: { reviewer: true, proof: [REVIEWED_WHEN] },
          },
        },
      })
    ).toEqual([]);
  });

  it("resolves one reviewer per declaring gate", () => {
    const reviewers = reviewersOf({
      ...ONE_REVIEWER,
      "x-second-review": {
        "pull-request": {
          level: "required",
          await: OTHER_CONTEXT,
          evidence: { reviewer: true, proof: ["Deep review done"] },
        },
      },
    });
    expect(reviewers.map(reviewer => reviewer.context)).toEqual([
      CONTEXT,
      OTHER_CONTEXT,
    ]);
  });

  it("carries the declared reviewed-when phrase normalised into the allowlist", () => {
    expect(reviewersOf(ONE_REVIEWER)[0]?.proof).toContain("review completed");
  });
});

describe("readReviewerEvidence — the allowlist grants credit", () => {
  it("treats the configured reviewed-when string as reviewed", () => {
    const reading = readingFor(REVIEWED_WHEN);
    expect(reading.reviewed).toBe(true);
    expect(reading.reading).toBe(EVIDENCE_READINGS.reviewed);
  });

  it("matches the reviewed-when string case-insensitively and space-collapsed", () => {
    expect(readingFor("  REVIEW   Completed ").reviewed).toBe(true);
  });

  it("does not grant credit for a description that merely contains the phrase", () => {
    expect(readingFor("Review completed for 2 of 21 files").reviewed).toBe(
      false
    );
  });
});

describe("readReviewerEvidence — every other shape is NOT REVIEWED", () => {
  it("treats a throttled description as not reviewed", () => {
    const reading = readingFor(THROTTLED);
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.noWork);
  });

  it("treats a manual-review-required skip as not reviewed", () => {
    const reading = readingFor(
      "Review skipped: manual review required for this OSS repository"
    );
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.noWork);
  });

  it("treats a file-count skip as not reviewed", () => {
    const reading = readingFor(
      "Review skipped: 303 files exceed the limit of 300"
    );
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.noWork);
  });

  it("treats an unrecognised description as not reviewed", () => {
    const reading = readingFor("Everything looks fine to me");
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.unrecognised);
  });

  it("treats an unrecognised SUCCESS description as not reviewed", () => {
    expect(
      readReviewerEvidence({
        reviewer: reviewersOf(ONE_REVIEWER)[0],
        statuses: [
          {
            context: CONTEXT,
            state: "success",
            description: "Analysis unavailable in this region",
          },
        ],
      }).reviewed
    ).toBe(false);
  });

  it("treats an empty description as not reviewed", () => {
    const reading = readingFor("");
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.empty);
  });

  it("treats a missing description as not reviewed", () => {
    expect(readingFor(undefined).reading).toBe(EVIDENCE_READINGS.empty);
  });

  it("treats an absent status as not reviewed", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewersOf(ONE_REVIEWER)[0],
      statuses: [{ context: "Some Other Check", state: "success" }],
    });
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.absent);
  });

  it("records the observed description verbatim so the trail says why", () => {
    expect(readingFor(THROTTLED).observed).toBe(THROTTLED);
  });
});

describe("reviewEvidenceVerdict", () => {
  it("reports an explicit no-op when no reviewer is configured", () => {
    const verdict = verdictFor({ gates: {} });
    expect(verdict.outcome).toBe(EVIDENCE_OUTCOMES.noReviewerConfigured);
    expect(verdict.readings).toEqual([]);
  });

  it("says a no-op is not a pass when no reviewer is configured", () => {
    expect(humanReport(verdictFor({ gates: {} }))).toContain("NOT a pass");
  });

  it("is satisfied when the reviewer showed real evidence", () => {
    expect(
      verdictFor({
        statuses: [
          { context: CONTEXT, state: "success", description: REVIEWED_WHEN },
        ],
      }).outcome
    ).toBe(EVIDENCE_OUTCOMES.satisfied);
  });

  it("is unsatisfied when the reviewer showed none and nothing substituted", () => {
    expect(
      verdictFor({
        statuses: [
          {
            context: CONTEXT,
            state: "success",
            description: THROTTLED,
          },
        ],
      }).outcome
    ).toBe(EVIDENCE_OUTCOMES.unsatisfied);
  });

  it("is unsatisfied when the reviewer posted nothing at all", () => {
    expect(verdictFor({ statuses: [] }).outcome).toBe(
      EVIDENCE_OUTCOMES.unsatisfied
    );
  });

  it("is substituted when a local adversarial review was posted at this head", () => {
    expect(
      verdictFor({
        statuses: [
          {
            context: CONTEXT,
            state: "success",
            description: THROTTLED,
          },
        ],
        comments: [
          {
            body: `${substituteMarker({ context: CONTEXT, sha: HEAD })}\nread`,
          },
        ],
      }).outcome
    ).toBe(EVIDENCE_OUTCOMES.substituted);
  });

  it("requires each configured reviewer to show its own evidence", () => {
    const gates = {
      ...ONE_REVIEWER,
      "x-second-review": {
        "pull-request": {
          level: "required",
          await: OTHER_CONTEXT,
          evidence: { reviewer: true, proof: [REVIEWED_WHEN] },
        },
      },
    };
    const verdict = verdictFor({
      gates,
      statuses: [
        { context: CONTEXT, state: "success", description: REVIEWED_WHEN },
        {
          context: OTHER_CONTEXT,
          state: "success",
          description: THROTTLED,
        },
      ],
    });
    expect(verdict.outcome).toBe(EVIDENCE_OUTCOMES.unsatisfied);
    expect(
      verdict.readings.map((reading: never) => reading["reviewed"])
    ).toEqual([true, false]);
  });

  it("reports a no-op when the commit is nobody's pull request head", () => {
    expect(
      reviewEvidenceVerdict({
        reviewers: reviewersOf(ONE_REVIEWER),
        statuses: [],
        comments: [],
        sha: HEAD,
        isPullRequestHead: false,
      }).outcome
    ).toBe(EVIDENCE_OUTCOMES.notAPullRequestHead);
  });
});

describe("an unsettled reviewer is deferred, never judged", () => {
  it("treats a pending status as pending rather than as no evidence", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewersOf(ONE_REVIEWER)[0],
      statuses: [
        { context: CONTEXT, state: "pending", description: "Review queued" },
      ],
    });
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.pending);
  });

  it("defers the verdict while a declared reviewer is still working", () => {
    expect(
      verdictFor({
        statuses: [
          {
            context: CONTEXT,
            state: "pending",
            description: "Review in progress",
          },
        ],
      }).outcome
    ).toBe(EVIDENCE_OUTCOMES.pending);
  });

  it("exits 0 while a declared reviewer is still working", () => {
    expect(
      main([`--sha=${HEAD}`], {
        gates: ONE_REVIEWER,
        pulls: () => [1],
        statuses: () => [
          {
            context: CONTEXT,
            state: "pending",
            description: "Review in progress",
          },
        ],
        comments: () => [],
        out: { write: () => undefined },
      })
    ).toBe(0);
  });
});

describe("a status from another app cannot change the answer", () => {
  it("reports an explicit no-op when the waking context is not a declared reviewer", () => {
    const chunks: string[] = [];
    const code = main([`--sha=${HEAD}`, "--context=Some Other App"], {
      gates: ONE_REVIEWER,
      pulls: () => {
        throw new Error("must not read pull requests for a foreign context");
      },
      out: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    });
    expect(code).toBe(0);
    expect(chunks.join("")).toContain("NO-OP");
    expect(chunks.join("")).toContain("NOT a pass");
  });

  it("still evaluates when the waking context IS a declared reviewer", () => {
    expect(
      main([`--sha=${HEAD}`, `--context=${CONTEXT}`], {
        gates: ONE_REVIEWER,
        pulls: () => [1],
        statuses: () => [
          { context: CONTEXT, state: "success", description: THROTTLED },
        ],
        comments: () => [],
        out: { write: () => undefined },
      })
    ).toBe(1);
  });
});

describe("substitutePosted", () => {
  it("finds a substitute posted for this reviewer at this head", () => {
    expect(
      substitutePosted({
        comments: [{ body: substituteMarker({ context: CONTEXT, sha: HEAD }) }],
        context: CONTEXT,
        sha: HEAD,
      })
    ).toBe(true);
  });

  it("does not accept a substitute written for an earlier head", () => {
    expect(
      substitutePosted({
        comments: [
          { body: substituteMarker({ context: CONTEXT, sha: OTHER_HEAD }) },
        ],
        context: CONTEXT,
        sha: HEAD,
      })
    ).toBe(false);
  });

  it("does not accept a substitute written for a different reviewer", () => {
    expect(
      substitutePosted({
        comments: [
          { body: substituteMarker({ context: OTHER_CONTEXT, sha: HEAD }) },
        ],
        context: CONTEXT,
        sha: HEAD,
      })
    ).toBe(false);
  });
});

describe("classifyReviewObject — a review OBJECT is not a status CONTEXT", () => {
  it("does not treat an empty-bodied APPROVED review as hollow", () => {
    expect(classifyReviewObject({ state: "APPROVED", body: "" })).toBe(
      REVIEW_OBJECT_VERDICTS.approval
    );
  });

  it("does not treat a body-less APPROVED review as hollow", () => {
    expect(classifyReviewObject({ state: "APPROVED" })).toBe(
      REVIEW_OBJECT_VERDICTS.approval
    );
  });

  it("treats an empty-bodied CHANGES_REQUESTED as a blocking objection", () => {
    expect(classifyReviewObject({ state: "CHANGES_REQUESTED", body: "" })).toBe(
      REVIEW_OBJECT_VERDICTS.objection
    );
  });
});

describe("validateGates — the reviewer marker is validated", () => {
  it("accepts a reviewer declaration carrying a proof phrase", () => {
    expect(validateGates(ONE_REVIEWER)).toEqual([]);
  });

  it("refuses a reviewer declaration with no proof phrase", () => {
    const problems = validateGates({
      "code-review": {
        "pull-request": {
          level: "required",
          await: CONTEXT,
          evidence: { reviewer: true },
        },
      },
    });
    expect(problems.join("\n")).toContain("ALLOWLIST");
  });

  it("refuses a non-boolean reviewer marker", () => {
    const problems = validateGates({
      "code-review": {
        "pull-request": {
          level: "required",
          await: CONTEXT,
          evidence: { reviewer: "yes", proof: [REVIEWED_WHEN] },
        },
      },
    });
    expect(problems.join("\n")).toContain("expected true or false");
  });

  it("refuses an evidence block on a moment that awaits nothing", () => {
    const problems = validateGates({
      "code-review": {
        "pull-request": {
          level: "required",
          run: "review",
          evidence: { reviewer: true, proof: [REVIEWED_WHEN] },
        },
      },
    });
    expect(problems.join("\n")).toContain("awaits nothing");
  });
});

describe("main", () => {
  /**
   * Capture what the CLI writes.
   * @returns A writable sink plus its accumulated text
   */
  const sink = () => {
    const chunks: string[] = [];
    return {
      chunks,
      stream: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    };
  };

  it("exits 1 and names the reviewer when evidence is missing at head", () => {
    const out = sink();
    const code = main([`--sha=${HEAD}`], {
      gates: ONE_REVIEWER,
      pulls: () => [1],
      statuses: () => [
        {
          context: CONTEXT,
          state: "success",
          description: THROTTLED,
        },
      ],
      comments: () => [],
      out: out.stream,
    });
    expect(code).toBe(1);
    expect(out.chunks.join("")).toContain(CONTEXT);
    expect(out.chunks.join("")).toContain(THROTTLED);
  });

  it("exits 0 and says NO-OP when no reviewer is configured", () => {
    const out = sink();
    const code = main([`--sha=${HEAD}`], { gates: {}, out: out.stream });
    expect(code).toBe(0);
    expect(out.chunks.join("")).toContain("NO-OP");
  });

  it("exits 0 when a substitute review stands at this head", () => {
    const code = main([`--sha=${HEAD}`], {
      gates: ONE_REVIEWER,
      pulls: () => [1],
      statuses: () => [
        {
          context: CONTEXT,
          state: "success",
          description: THROTTLED,
        },
      ],
      comments: () => [
        { body: substituteMarker({ context: CONTEXT, sha: HEAD }) },
      ],
      out: sink().stream,
    });
    expect(code).toBe(0);
  });

  it("exits 2 without a --sha rather than deciding on nothing", () => {
    const err = sink();
    expect(main([], { gates: ONE_REVIEWER, err: err.stream })).toBe(2);
  });
});

describe("the prover never re-requests a review", () => {
  it("names no review-request API path", () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs"
      ),
      "utf8"
    );
    expect(source).not.toContain("requested_reviewers");
    expect(source).not.toContain("--request");
  });
});
