/**
 * Unit controls for check-run evidence in the third-party review prover.
 *
 * The reviewer this repository declares now reports as a check run whose title
 * is a generic "Finished"; only the first line of its summary says whether a
 * review completed (CodySwannGT/lisa#4553). These cases pin the three pieces
 * that make that readable without loosening anything: which run speaks for the
 * reviewer, what that run says, and how its reading is reported. The legacy
 * status suite beside this file is deliberately left unchanged — it is the
 * proof that statuses read exactly as they did.
 * @module tests/unit/scripts/third-party-review-check-run
 */
import { describe, expect, it } from "vitest";

import {
  checkRunResult,
  COMPLETED_REVIEW_RESULT,
  configuredReviewers,
  EVIDENCE_OUTCOMES,
  EVIDENCE_READINGS,
  EVIDENCE_SOURCES,
  humanReport,
  main,
  READING_SENTENCES,
  readReviewerEvidence,
  reviewEvidenceVerdict,
  selectReviewerCheckRun,
  substituteMarker,
} from "../../../all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

const REPO_ARG = "--repo=acme/code";
const CONTEXT = "Example Reviewer";
const APP = 347564;
const HEAD = "c".repeat(40);
const OTHER_HEAD = "d".repeat(40);
const FINISHED = "Finished";
const REVIEW_COMPLETED = "Review completed";
const RATE_LIMITED = "Review rate limited";

/** One reviewer, pinned to its app, as a project declares it. */
const PINNED = {
  "code-review": {
    "pull-request": {
      level: "required",
      await: CONTEXT,
      posted_by: APP,
      evidence: { reviewer: true, proof: [REVIEW_COMPLETED] },
    },
  },
};

/** The same reviewer with no pin. */
const UNPINNED = {
  "code-review": {
    "pull-request": {
      level: "required",
      await: CONTEXT,
      evidence: { reviewer: true, proof: [REVIEW_COMPLETED] },
    },
  },
};

/** A resolved reviewer, as the prover sees one. */
interface Reviewer {
  readonly gateId: string;
  readonly context: string;
  readonly proof: string[];
  readonly postedBy?: unknown;
}

/**
 * The single reviewer a gates block declares.
 * @param gates - A gates block
 * @returns Its reviewer
 */
const reviewerOf = (gates: object): Reviewer => {
  const [reviewer] = configuredReviewers({ gates }) as Reviewer[];
  if (!reviewer) throw new Error("expected one reviewer");
  return reviewer;
};

/**
 * One raw check run, defaulting to a completed review by the declared app.
 * @param overrides - Raw fields a case observes differently
 * @returns The run
 */
const run = (overrides: Record<string, unknown> = {}) => ({
  id: 10,
  name: CONTEXT,
  head_sha: HEAD,
  status: "completed",
  conclusion: "success",
  app: { id: APP, slug: "example-reviewer" },
  output: {
    title: FINISHED,
    summary: `${COMPLETED_REVIEW_RESULT}\nRun ID: x\n| Step | Completed |`,
  },
  ...overrides,
});

describe("configuredReviewers carries the declared app", () => {
  it("resolves a pinned reviewer's app id", () => {
    expect(reviewerOf(PINNED).postedBy).toBe(APP);
  });

  it("leaves an unpinned reviewer's app absent", () => {
    expect(reviewerOf(UNPINNED)).not.toHaveProperty("postedBy");
  });

  it("carries a malformed pin as declared, so it matches no app", () => {
    const declaredNull = reviewerOf({
      "code-review": {
        "pull-request": {
          ...PINNED["code-review"]["pull-request"],
          posted_by: null,
        },
      },
    });

    expect(declaredNull.postedBy).toBeNull();
    expect(
      selectReviewerCheckRun({
        reviewer: declaredNull,
        runs: [run()],
        sha: HEAD,
      }).run
    ).toBeNull();
  });
});

describe("checkRunResult reads the run's structured result", () => {
  it("canonicalises the one completed result on a successful completed run", () => {
    expect(checkRunResult(run())).toEqual({
      text: COMPLETED_REVIEW_RESULT,
      canonical: REVIEW_COMPLETED,
    });
  });

  it.each(["neutral", "failure", "skipped", null])(
    "keeps the result line verbatim when the conclusion is %s",
    conclusion => {
      expect(checkRunResult(run({ conclusion }))).toEqual({
        text: COMPLETED_REVIEW_RESULT,
        canonical: COMPLETED_REVIEW_RESULT,
      });
    }
  );

  it("lets a no-work title decide before any summary is read", () => {
    expect(
      checkRunResult(
        run({
          output: {
            title: RATE_LIMITED,
            summary: COMPLETED_REVIEW_RESULT,
          },
        })
      ).canonical
    ).toBe(RATE_LIMITED);
  });

  it("lets a no-work first line decide over the title", () => {
    expect(
      checkRunResult(
        run({
          output: {
            title: REVIEW_COMPLETED,
            summary: "Result: Rate limited - Review rate limited",
          },
        })
      ).text
    ).toBe("Result: Rate limited - Review rate limited");
  });

  it("falls back to the title when there is no summary", () => {
    expect(
      checkRunResult(run({ output: { title: FINISHED, summary: null } }))
        .canonical
    ).toBe(FINISHED);
  });

  it("falls back to the title beside a plain summary", () => {
    expect(
      checkRunResult(
        run({ output: { title: FINISHED, summary: "Plain details" } })
      ).canonical
    ).toBe(FINISHED);
  });

  it("reads no phrase from a summary that is not text, and reports the value it was", () => {
    expect(
      checkRunResult(run({ output: { title: REVIEW_COMPLETED, summary: 7 } }))
    ).toEqual({ text: "7", canonical: "Malformed check-run summary" });
  });

  it.each([
    "Result: Failure - Review completed",
    "> Result: Success - Review completed",
    "Result = Success - Review completed",
  ])("keeps any other result-shaped first line authoritative: %s", line => {
    expect(
      checkRunResult(
        run({ output: { title: REVIEW_COMPLETED, summary: line } })
      ).canonical
    ).toBe(line);
  });

  it("reads nothing from later lines", () => {
    expect(
      checkRunResult(
        run({
          output: {
            title: FINISHED,
            summary: `metadata\n${COMPLETED_REVIEW_RESULT}`,
          },
        })
      ).canonical
    ).toBe(FINISHED);
  });

  it("treats a run with no output as reporting nothing", () => {
    expect(checkRunResult(run({ output: undefined }))).toEqual({
      text: "",
      canonical: "",
    });
  });
});

describe("selectReviewerCheckRun picks the run that speaks for the reviewer", () => {
  it("ignores runs for other names without listing them", () => {
    expect(
      selectReviewerCheckRun({
        reviewer: reviewerOf(PINNED),
        runs: [run({ name: "Something Else" })],
        sha: HEAD,
      })
    ).toEqual({ run: null, ignored: [] });
  });

  it("refuses a run for another head and says so", () => {
    const { run: selected, ignored } = selectReviewerCheckRun({
      reviewer: reviewerOf(PINNED),
      runs: [run({ head_sha: OTHER_HEAD })],
      sha: HEAD,
    });

    expect(selected).toBeNull();
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.reason).toContain(OTHER_HEAD);
  });

  it("refuses a run from an app the gate does not pin, and says so", () => {
    const { run: selected, ignored } = selectReviewerCheckRun({
      reviewer: reviewerOf(PINNED),
      runs: [run({ app: { id: 15368, slug: "github-actions" } })],
      sha: HEAD,
    });

    expect(selected).toBeNull();
    expect(ignored[0]?.reason).toContain("15368");
    expect(ignored[0]?.reason).toContain(String(APP));
  });

  it("accepts any app when the gate pins none", () => {
    expect(
      selectReviewerCheckRun({
        reviewer: reviewerOf(UNPINNED),
        runs: [run({ app: { id: 15368 } })],
        sha: HEAD,
      }).run
    ).not.toBeNull();
  });

  it("treats a reviewer resolved without a pin field as unpinned", () => {
    expect(
      selectReviewerCheckRun({
        reviewer: { context: CONTEXT, proof: ["review completed"] },
        runs: [run()],
        sha: HEAD,
      }).run
    ).not.toBeNull();
  });

  it("refuses every run when the head itself is unknown", () => {
    expect(
      selectReviewerCheckRun({
        reviewer: reviewerOf(PINNED),
        runs: [run({ head_sha: undefined })],
        sha: undefined,
      }).run
    ).toBeNull();
  });

  it("keeps the newest run, by creation and then id", () => {
    const older = run({ id: 1, conclusion: "neutral" });
    const newer = run({ id: 2 });

    expect(
      selectReviewerCheckRun({
        reviewer: reviewerOf(PINNED),
        runs: [newer, older],
        sha: HEAD,
      }).run
    ).toBe(newer);
    expect(
      selectReviewerCheckRun({
        reviewer: reviewerOf(PINNED),
        runs: [
          run({ id: 9, created_at: "2026-11-02T10:00:00Z" }),
          run({ id: 3, created_at: "2026-11-02T11:00:00Z", conclusion: "x" }),
        ],
        sha: HEAD,
      }).run?.conclusion
    ).toBe("x");
  });

  it("answers no run for a read that failed", () => {
    expect(
      selectReviewerCheckRun({
        reviewer: reviewerOf(PINNED),
        runs: null,
        sha: HEAD,
      })
    ).toEqual({ run: null, ignored: [] });
  });
});

describe("readReviewerEvidence over both representations", () => {
  it("reads a completed run as review work, saying where it came from", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewerOf(PINNED),
      statuses: [],
      checkRuns: [run()],
      sha: HEAD,
    });

    expect(reading).toMatchObject({
      reviewed: true,
      reading: EVIDENCE_READINGS.reviewed,
      source: EVIDENCE_SOURCES.checkRun,
      observed: COMPLETED_REVIEW_RESULT,
      state: "success",
      checkRunId: 10,
    });
  });

  it.each([
    ["neutral", EVIDENCE_READINGS.unsuccessful],
    ["cancelled", EVIDENCE_READINGS.unsuccessful],
    [null, EVIDENCE_READINGS.unsuccessful],
  ])("reads a %s run as %s", (conclusion, expected) => {
    expect(
      readReviewerEvidence({
        reviewer: reviewerOf(PINNED),
        statuses: [],
        checkRuns: [run({ conclusion })],
        sha: HEAD,
      }).reading
    ).toBe(expected);
  });

  it("reads an unfinished run as pending, never as evidence", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewerOf(PINNED),
      statuses: [],
      checkRuns: [run({ status: "in_progress", conclusion: null })],
      sha: HEAD,
    });

    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(EVIDENCE_READINGS.pending);
    expect(reading.state).toBe("in_progress");
  });

  it.each([
    ["an uppercase lifecycle", { status: "COMPLETED" }],
    ["an uppercase conclusion", { conclusion: "SUCCESS" }],
  ])("credits nothing for %s GitHub never sends", (_name, spelling) => {
    const reading = readReviewerEvidence({
      reviewer: reviewerOf(PINNED),
      statuses: [],
      checkRuns: [
        run({
          output: { title: REVIEW_COMPLETED, summary: null },
          ...spelling,
        }),
      ],
      sha: HEAD,
    });

    expect(reading.reviewed).toBe(false);
  });

  it("reads exactly as before when called the legacy way", () => {
    const reading = readReviewerEvidence({
      reviewer: reviewerOf(PINNED),
      statuses: [
        { context: CONTEXT, state: "success", description: REVIEW_COMPLETED },
      ],
    });

    expect(reading.reviewed).toBe(true);
    expect(reading.source).toBe(EVIDENCE_SOURCES.status);
  });

  it("calls a failed check-run read unreadable when no status stands", () => {
    expect(
      readReviewerEvidence({
        reviewer: reviewerOf(PINNED),
        statuses: [],
        checkRuns: null,
        sha: HEAD,
      }).reading
    ).toBe(EVIDENCE_READINGS.unreadable);
  });

  it("calls a failed status read unreadable when no run stands", () => {
    expect(
      readReviewerEvidence({
        reviewer: reviewerOf(PINNED),
        statuses: null,
        checkRuns: [],
        sha: HEAD,
      }).reading
    ).toBe(EVIDENCE_READINGS.unreadable);
  });

  it("keeps a status's credit when only the check-run read failed", () => {
    expect(
      readReviewerEvidence({
        reviewer: reviewerOf(PINNED),
        statuses: [
          {
            context: CONTEXT,
            state: "success",
            description: REVIEW_COMPLETED,
          },
        ],
        checkRuns: null,
        sha: HEAD,
      }).reviewed
    ).toBe(true);
  });
});

describe("the verdict and its report", () => {
  it("gives the two new readings their own sentences", () => {
    expect(READING_SENTENCES[EVIDENCE_READINGS.unsuccessful]).toContain(
      "without success"
    );
    expect(READING_SENTENCES[EVIDENCE_READINGS.unreadable]).toContain(
      "could not be read"
    );
  });

  it("states what was observed when nothing could be read, never a guessed cause", () => {
    expect(READING_SENTENCES[EVIDENCE_READINGS.unreadable]).not.toMatch(
      /most often|token|permission/iu
    );
  });

  it("keeps the absent sentence an operator has been taught to quote", () => {
    expect(READING_SENTENCES[EVIDENCE_READINGS.absent]).toContain(
      "no third-party status was present at this head"
    );
    expect(READING_SENTENCES[EVIDENCE_READINGS.absent]).toContain("check run");
  });

  it("reads check runs keyed by the reviewer's context", () => {
    expect(
      reviewEvidenceVerdict({
        reviewers: [reviewerOf(PINNED)],
        statuses: [],
        checkRuns: { [CONTEXT]: [run()] },
        comments: [],
        sha: HEAD,
      }).outcome
    ).toBe(EVIDENCE_OUTCOMES.satisfied);
  });

  it("reports a check-run reading by its run, its conclusion and its words", () => {
    const report = humanReport(
      reviewEvidenceVerdict({
        reviewers: [reviewerOf(PINNED)],
        statuses: [],
        checkRuns: {
          [CONTEXT]: [
            run({
              conclusion: "neutral",
              output: { title: RATE_LIMITED, summary: null },
            }),
          ],
        },
        comments: [],
        sha: HEAD,
      })
    );

    expect(report).toContain("check run neutral");
    expect(report).toContain(JSON.stringify(RATE_LIMITED));
    expect(report).toContain("NOTHING stands in its place");
  });

  it("lists a run it ignored, and why", () => {
    const report = humanReport(
      reviewEvidenceVerdict({
        reviewers: [reviewerOf(PINNED)],
        statuses: [],
        checkRuns: { [CONTEXT]: [run({ app: { id: 15368 } })] },
        comments: [],
        sha: HEAD,
      })
    );

    expect(report).toContain("no status or check run posted");
    expect(report).toContain("ignored check run 10");
    expect(report).toContain("15368");
  });

  it("says an unreadable reviewer could not be read", () => {
    const report = humanReport(
      reviewEvidenceVerdict({
        reviewers: [reviewerOf(PINNED)],
        statuses: [],
        checkRuns: { [CONTEXT]: null },
        comments: [],
        sha: HEAD,
      })
    );

    expect(report).toContain("(unreadable)");
    expect(report).toContain(
      READING_SENTENCES[EVIDENCE_READINGS.unreadable] as string
    );
  });
});

describe("main reads check runs once per reviewer, and only when asked", () => {
  /** A sink that swallows output. */
  const quiet = { write: () => undefined };

  it("reads the reviewer's runs and credits a completed one", () => {
    const asked: Array<readonly [string, string]> = [];
    const code = main([`--sha=${HEAD}`, REPO_ARG], {
      gates: PINNED,
      pulls: () => [1],
      statuses: () => [],
      checkRuns: (sha: string, context: string) => {
        asked.push([sha, context]);
        return [run()];
      },
      comments: () => [],
      out: quiet,
    });

    expect(code).toBe(0);
    expect(asked).toEqual([[HEAD, CONTEXT]]);
  });

  it("reads a context two gates share only once", () => {
    const asked: string[] = [];
    main([`--sha=${HEAD}`, REPO_ARG], {
      gates: {
        ...PINNED,
        "second-review": PINNED["code-review"],
      },
      pulls: () => [1],
      statuses: () => [],
      checkRuns: (_sha: string, context: string) => {
        asked.push(context);
        return [run()];
      },
      comments: () => [],
      out: quiet,
    });

    expect(asked).toEqual([CONTEXT]);
  });

  it("does not read check runs for a run woken by an undeclared app", () => {
    const code = main([`--sha=${HEAD}`, "--context=Some Other App"], {
      gates: PINNED,
      pulls: () => {
        throw new Error("must not read pull requests for a foreign context");
      },
      checkRuns: () => {
        throw new Error("must not read check runs for a foreign context");
      },
      out: quiet,
    });

    expect(code).toBe(0);
  });

  it("does not mix a live read into a caller's injected status evidence", () => {
    const chunks: string[] = [];
    const code = main([`--sha=${HEAD}`, REPO_ARG, "--json"], {
      gates: PINNED,
      pulls: () => [1],
      statuses: () => [],
      comments: () => [],
      out: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    });
    const verdict = JSON.parse(chunks.join(""));

    expect(code).toBe(1);
    expect(verdict.readings[0].reading).toBe(EVIDENCE_READINGS.absent);
  });

  it("does not mix a live status read into a caller's injected check runs", () => {
    const chunks: string[] = [];
    const code = main([`--sha=${HEAD}`, REPO_ARG, "--json"], {
      gates: PINNED,
      pulls: () => [1],
      checkRuns: () => [],
      comments: () => [],
      out: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    });
    const verdict = JSON.parse(chunks.join(""));

    expect(code).toBe(1);
    expect(verdict.readings[0].reading).toBe(EVIDENCE_READINGS.absent);
  });
});

describe("a substitute for a rate-limited check run counts only from a writer (#4628)", () => {
  const RATE_LIMITED_RUN = run({
    conclusion: "neutral",
    output: { title: RATE_LIMITED, summary: RATE_LIMITED },
  });
  const MARKER = substituteMarker({ context: CONTEXT, sha: HEAD });

  /**
   * The CLI's JSON verdict over one comment, with every read injected.
   * @param login - The comment's author
   * @returns The exit code and the verdict
   */
  const decide = (login: string) => {
    const chunks: string[] = [];
    const code = main([`--sha=${HEAD}`, REPO_ARG, "--json"], {
      gates: PINNED,
      pulls: () => [1],
      checkRuns: () => [RATE_LIMITED_RUN],
      comments: () => [{ body: MARKER, user: { login } }],
      canWrite: (author: string) => author === "maintainer",
      out: {
        write: (text: string) => {
          chunks.push(text);
        },
      },
    });
    return { code, verdict: JSON.parse(chunks.join("")) };
  };

  it("refuses a stranger's first-line marker and names them", () => {
    const { code, verdict } = decide("drive-by");

    expect(code).toBe(1);
    expect(verdict.outcome).toBe(EVIDENCE_OUTCOMES.unsatisfied);
    expect(verdict.readings[0].source).toBe(EVIDENCE_SOURCES.checkRun);
    expect(verdict.readings[0].substituteRefusals).toEqual([
      { author: "drive-by", reason: "no write access" },
    ]);
  });

  it("counts a writer's first-line marker", () => {
    const { code, verdict } = decide("maintainer");

    expect(code).toBe(0);
    expect(verdict.outcome).toBe(EVIDENCE_OUTCOMES.substituted);
  });
});
