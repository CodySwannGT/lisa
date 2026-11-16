/**
 * The third-party review prover reads a reviewer by the project's config, not
 * by one vendor's wording (CodySwannGT/lisa#4909).
 *
 * A project declares its reviewer as a gate: the name it reports under
 * (`await`), the phrases that mean it read the code (`evidence.proof`), the
 * phrases that mean it did nothing (`evidence.no_work`), and — for a reviewer
 * that only submits a pull-request review — the account that writes it
 * (`evidence.review_by`). These cases use a reviewer that is not CodeRabbit
 * and wording CodeRabbit never uses, so a prover that still only knew
 * CodeRabbit's strings fails them.
 * @module tests/unit/scripts/third-party-review-vendor-config
 */
import { describe, expect, it } from "vitest";

import {
  checkRunResult,
  COMPLETED_REVIEW_RESULT,
  configuredReviewers,
  EVIDENCE_OUTCOMES,
  EVIDENCE_READINGS,
  EVIDENCE_SOURCES,
  readReviewerEvidence,
  reviewEvidenceVerdict,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";
import { validateGates } from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { classifyCheckDescription } from "../../../typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

const HEAD = "e".repeat(40);
const OLDER = "f".repeat(40);
const CONTEXT = "Greptile Review";
const LOGIN = "greptile-apps[bot]";
const DECLARED = "Review complete";
const PAUSED = "Paused by plan";
const SHIPPED_PROOF = "Review completed";

/**
 * One reviewer gate, as a project declares it.
 * @param evidence - Extra evidence keys
 * @returns The gates block
 */
function gates(evidence: Record<string, unknown>) {
  return {
    "code-review": {
      "pull-request": {
        level: "required",
        await: CONTEXT,
        evidence: { reviewer: true, ...evidence },
      },
    },
  };
}

/**
 * The one reviewer a gates block declares.
 * @param evidence - Extra evidence keys
 * @returns The reviewer
 */
function reviewer(evidence: Record<string, unknown>) {
  const [only] = configuredReviewers({ gates: gates(evidence) });
  if (!only) throw new Error("expected one configured reviewer");
  return only;
}

/**
 * A completed check run under the reviewer's name at the head.
 * @param summary - The run's summary
 * @param conclusion - How the run concluded
 * @returns The raw run
 */
function run(summary: string, conclusion = "success") {
  return {
    id: 7,
    name: CONTEXT,
    head_sha: HEAD,
    status: "completed",
    conclusion,
    app: { id: 1 },
    output: { title: "Finished", summary },
  };
}

/**
 * A submitted pull-request review.
 * @param overrides - Fields to change
 * @returns The review object
 */
function review(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    state: "COMMENTED",
    commit_id: HEAD,
    submitted_at: "2026-11-16T10:00:00Z",
    user: { login: LOGIN, type: "Bot" },
    body: "Reviewed 4 files.",
    ...overrides,
  };
}

describe("a check run is credited by the reviewer's declared proof", () => {
  it("credits a plain first summary line the gate declares", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED] }),
      statuses: [],
      checkRuns: [run(`${DECLARED}\nFiles: 4`)],
      sha: HEAD,
    });
    expect(reading.reading).toBe(EVIDENCE_READINGS.reviewed);
  });

  it("credits a structured success that names a declared phrase", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED] }),
      statuses: [],
      checkRuns: [run(`Result: Success - ${DECLARED}`)],
      sha: HEAD,
    });
    expect(reading.reading).toBe(EVIDENCE_READINGS.reviewed);
  });

  it("does not credit the same line on a run that did not succeed", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED] }),
      statuses: [],
      checkRuns: [run(DECLARED, "neutral")],
      sha: HEAD,
    });
    expect(reading.reviewed).toBe(false);
  });

  it("does not credit a phrase no gate declared", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED] }),
      statuses: [],
      checkRuns: [run("Looked around")],
      sha: HEAD,
    });
    expect(reading.reviewed).toBe(false);
  });

  it("still credits CodeRabbit's line with no config change", () => {
    expect(
      checkRunResult({
        status: "completed",
        conclusion: "success",
        output: { title: "Finished", summary: COMPLETED_REVIEW_RESULT },
      })
    ).toEqual({ text: COMPLETED_REVIEW_RESULT, canonical: SHIPPED_PROOF });
  });
});

describe("the gate's own no-work phrases are honoured", () => {
  it("reads a declared no-work status as no work, not unrecognised", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED], no_work: [PAUSED] }),
      statuses: [{ context: CONTEXT, state: "success", description: PAUSED }],
      sha: HEAD,
    });
    expect(reading.reading).toBe(EVIDENCE_READINGS.noWork);
  });

  it("reads the same status as unrecognised when no gate declares it", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED] }),
      statuses: [{ context: CONTEXT, state: "success", description: PAUSED }],
      sha: HEAD,
    });
    expect(reading.reading).toBe(EVIDENCE_READINGS.unrecognised);
  });
});

describe("a reviewer proven by its own review (evidence.review_by)", () => {
  const declared = () => reviewer({ review_by: LOGIN });

  it("is credited by its submitted review on the head", () => {
    const reading = readReviewerEvidence({
      reviewer: declared(),
      statuses: [],
      checkRuns: [],
      sha: HEAD,
      reviews: [review()],
    });
    expect(reading).toMatchObject({
      reviewed: true,
      reading: EVIDENCE_READINGS.reviewed,
      source: EVIDENCE_SOURCES.review,
      observed: `COMMENTED review by ${LOGIN}`,
    });
  });

  it("matches the login without regard to case", () => {
    const reading = readReviewerEvidence({
      reviewer: declared(),
      statuses: [],
      sha: HEAD,
      reviews: [review({ user: { login: LOGIN.toUpperCase(), type: "Bot" } })],
    });
    expect(reading.reviewed).toBe(true);
  });

  it.each([
    ["a review of an earlier commit", review({ commit_id: OLDER })],
    [
      "a review from another account",
      review({ user: { login: "someone", type: "Bot" } }),
    ],
    [
      "a review from a user account with the same login",
      review({ user: { login: LOGIN, type: "User" } }),
    ],
    ["a dismissed review", review({ state: "DISMISSED" })],
    ["an unsubmitted review", review({ state: "PENDING" })],
  ])("is not credited by %s", (_name, object) => {
    const reading = readReviewerEvidence({
      reviewer: declared(),
      statuses: [],
      sha: HEAD,
      reviews: [object],
    });
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.absent);
  });

  it("reads as unreadable, not absent, when the reviews could not be read", () => {
    const reading = readReviewerEvidence({
      reviewer: declared(),
      statuses: [],
      sha: HEAD,
      reviews: null,
    });
    expect(reading.reading).toBe(EVIDENCE_READINGS.unreadable);
  });

  it("satisfies the verdict for the head", () => {
    const verdict = reviewEvidenceVerdict({
      reviewers: [declared()],
      statuses: [],
      checkRuns: {},
      comments: [],
      reviews: [review({ state: "APPROVED" })],
      sha: HEAD,
    });
    expect(verdict.outcome).toBe(EVIDENCE_OUTCOMES.satisfied);
  });

  it("changes nothing for a reviewer whose gate names no account", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED] }),
      statuses: [],
      sha: HEAD,
      reviews: [review()],
    });
    expect(reading.reviewed).toBe(false);
  });
});

describe("validating evidence.review_by", () => {
  it("accepts a reviewer declared by its account alone", () => {
    expect(validateGates(gates({ review_by: LOGIN }))).toEqual([]);
  });

  it.each([
    ["an empty login", ""],
    ["a non-string", 7],
  ])("refuses %s", (_name, value) => {
    expect(validateGates(gates({ review_by: value })).join(" ")).toContain(
      "review_by"
    );
  });

  it("refuses review_by on a signal that is not a reviewer", () => {
    const problems = validateGates({
      "code-review": {
        "pull-request": {
          level: "required",
          await: CONTEXT,
          evidence: { reviewer: false, review_by: LOGIN },
        },
      },
    });
    expect(problems.join(" ")).toContain("reviewer is not true");
  });
});

describe("a review never overrides a denial (#4916 review)", () => {
  const declared = () => reviewer({ review_by: LOGIN });

  it.each([
    ["a no-work check run", run("Review skipped: rate limited")],
    ["a failed check run", run("Looked around", "failure")],
  ])("is not credited after %s", (_name, object) => {
    const reading = readReviewerEvidence({
      reviewer: declared(),
      statuses: [],
      checkRuns: [object],
      sha: HEAD,
      reviews: [review({ state: "APPROVED" })],
    });
    expect(reading.reviewed).toBe(false);
    expect(reading.source).toBe(EVIDENCE_SOURCES.checkRun);
  });

  it("is not credited after a no-work status", () => {
    const reading = readReviewerEvidence({
      reviewer: declared(),
      statuses: [
        { context: CONTEXT, state: "success", description: "Review skipped" },
      ],
      sha: HEAD,
      reviews: [review()],
    });
    expect(reading.reviewed).toBe(false);
  });

  it("reads a review whose own words say it skipped as no work", () => {
    const reading = readReviewerEvidence({
      reviewer: declared(),
      statuses: [],
      sha: HEAD,
      reviews: [review({ body: "Review skipped: pull request too large" })],
    });
    expect(reading).toMatchObject({
      reviewed: false,
      reading: EVIDENCE_READINGS.noWork,
      source: EVIDENCE_SOURCES.review,
    });
  });
});

describe("a no-work phrase is read before a proof phrase", () => {
  it("denies a run whose no-work title also names a proof phrase", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED], no_work: ["review"] }),
      statuses: [],
      checkRuns: [
        {
          ...run("Result: Failure - Review failed"),
          output: {
            title: SHIPPED_PROOF,
            summary: "Result: Failure - Review failed",
          },
        },
      ],
      sha: HEAD,
    });
    expect(reading.reviewed).toBe(false);
  });
});

describe("both checkers fold whitespace the same way", () => {
  it("credits a proof phrase with doubled inner spaces in both", () => {
    expect(classifyCheckDescription("Review  completed")).toBe(
      classifyCheckDescription(SHIPPED_PROOF)
    );
    const reading = readReviewerEvidence({
      reviewer: reviewer({ proof: [DECLARED] }),
      statuses: [],
      checkRuns: [run("Result: Success - Review  completed")],
      sha: HEAD,
    });
    expect(reading.reviewed).toBe(true);
  });
});

describe("validating the reviewer's phrases and account", () => {
  it("refuses a review_by that is not a bot login", () => {
    expect(validateGates(gates({ review_by: "greptile" })).join(" ")).toContain(
      "[bot]"
    );
  });

  it("refuses review_by alongside posted_by", () => {
    const problems = validateGates({
      "code-review": {
        "pull-request": {
          level: "required",
          await: CONTEXT,
          posted_by: 347564,
          evidence: { reviewer: true, review_by: LOGIN },
        },
      },
    });
    expect(problems.join(" ")).toContain("posted_by");
  });

  it("refuses a proof phrase that contains a no-work phrase", () => {
    const problems = validateGates(
      gates({ proof: [DECLARED], no_work: ["review"] })
    );
    expect(problems.join(" ")).toContain("contains");
  });

  it("refuses an empty no-work phrase", () => {
    const problems = validateGates(
      gates({ proof: [DECLARED], no_work: [" "] })
    );
    expect(problems.join(" ")).toContain("non-empty");
  });
});
