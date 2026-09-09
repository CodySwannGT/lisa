/**
 * The review gate reads review OBJECTS, not only a vendor's sentence (#3706).
 *
 * ## The collapse this pins open
 *
 * Every state the gate could previously reach was settled by the status
 * DESCRIPTION, and the description does not answer the question the gate asks.
 * Measured on this repository, the SAME string means opposite things:
 *
 * | description            | did a review read the diff? | today's verdict |
 * |------------------------|-----------------------------|-----------------|
 * | `Review rate limited`  | no                          | WAIVED, merges  |
 * | `Review rate limited`  | YES — posted CHANGES_REQUESTED and found a real defect | WAIVED, merges |
 *
 * A classifier reading the string collapses those two rows, and it collapses
 * them PERMISSIVELY: the pull request a reviewer objected to merges on a waiver
 * written for the pull request nobody read.
 *
 * ## And it is not only the rate-limited string
 *
 * Measured over the 60 most recently updated MERGED pull requests here: 2
 * carried a standing `CHANGES_REQUESTED` from the reviewer at the merged head,
 * and on both of them the status description was `Review completed` — so the
 * gate published `REVIEWED` and the objection never reached the surface a merge
 * decision reads. That population is the one this change moves: ~3% of merges,
 * every one of which a reviewer had objected to. It does NOT touch the ~87% that
 * waive because nothing reviewed them; that is a policy question this change
 * deliberately leaves to a human.
 *
 * ## Four outcomes, and the suite refuses to be satisfied by fewer
 *
 * The acceptance criterion names four, and the fixture that matters is the one
 * a string-reading classifier passes anyway: a rate-limited response on a pull
 * request WHERE A REVIEW NONETHELESS EXISTS. A suite built only from
 * rate-limited-and-genuinely-unreviewed is satisfied by exactly the classifier
 * that fails in production.
 *
 * Every "this passes" assertion here is paired with a rejection control, for the
 * reason the ticket gives: a test asserting only that a reviewed pull request
 * passes is satisfied by a gate that passes everything.
 * @module tests/unit/scripts/review-objection-at-head
 */
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT_REL =
  "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs";

const CODERABBIT = "CodeRabbit";
const HEAD = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const OLDER = "0000111122223333444455556666777788889999";
const RATE_LIMITED = "Review rate limited";
const COMPLETED = "Review completed";
const GH_FAILED = "gh exited 1";

/** One review object as this suite builds them. */
interface ReviewObject {
  readonly state: string;
  readonly commitSha?: string;
  readonly author: string;
}

/** What a verdict renders as. */
interface Verdict {
  readonly verdict: string;
  readonly conclusion: string;
  readonly title: string;
}

/** The standing an objection probe reports. */
interface Objection {
  readonly objected: boolean;
  readonly reviewers: readonly string[];
  readonly staleDropped: number;
  readonly unread?: string;
  readonly violations: readonly { kind: string; message: string }[];
}

/** The exports this suite exercises. */
interface GuardModule {
  readonly REVIEW_OBJECTION_STATE: string;
  readonly REVIEW_GATE_STATES: Record<string, string>;
  readonly REVIEW_VERDICT_CONCLUSIONS: Record<string, string>;
  readonly VIOLATIONS: Record<string, string>;
  readObjectionAtHead(
    reviews: readonly ReviewObject[],
    headSha: string | undefined
  ): { objected: boolean; reviewers: string[]; staleDropped: number };
  readReviewObjection(
    pr: string,
    repo: string | undefined,
    headSha: string | undefined,
    options?: { fetchReviews?: () => readonly ReviewObject[] }
  ): Objection;
  waiverEscalates(
    rate: { waived?: number; sampled?: number } | undefined,
    threshold: number | undefined
  ): boolean;
  reviewGateVerdict(reading?: Record<string, unknown>): Verdict;
  violationBlocks(
    violation: { kind: string },
    policy: {
      warnOnly: boolean;
      failOnVacuous: boolean;
      requireReviewEvidence: boolean;
    }
  ): boolean;
}

let mod: GuardModule;

beforeAll(async () => {
  mod = (await import(
    pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
  )) as unknown as GuardModule;
});

/**
 * A verdict reading for one CodeRabbit description, plus anything else.
 * @param description - What the status reported
 * @param extra - Further reading keys, such as an objection
 * @returns The reading `reviewGateVerdict` consumes
 */
function reading(
  description: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const state =
    description === COMPLETED
      ? mod.REVIEW_GATE_STATES.satisfied
      : mod.REVIEW_GATE_STATES.waived;
  return {
    states: { [CODERABBIT]: state },
    conditions: {
      [CODERABBIT]: description === COMPLETED ? "satisfied" : "waived",
    },
    descriptions: { [CODERABBIT]: description },
    ...extra,
  };
}

describe("an objection is read from review objects, at this head", () => {
  it("sees a CHANGES_REQUESTED submitted against this head", () => {
    const standing = mod.readObjectionAtHead(
      [{ state: "CHANGES_REQUESTED", commitSha: HEAD, author: "coderabbitai" }],
      HEAD
    );
    expect(standing.objected).toBe(true);
    expect(standing.reviewers).toEqual(["coderabbitai"]);
  });

  it("does NOT see an objection submitted against an older head", () => {
    // The rejection control for the assertion above, and a real direction of
    // harm rather than a symmetry exercise: measured here, 4 of the last 60
    // merged pull requests carried a CHANGES_REQUESTED and only 2 were at the
    // merged head. Counting the other 2 would redden pull requests whose
    // authors had already addressed the objection — a false RED, which this
    // gate's own prose calls the expensive kind to introduce while chasing a
    // false green.
    const standing = mod.readObjectionAtHead(
      [
        {
          state: "CHANGES_REQUESTED",
          commitSha: OLDER,
          author: "coderabbitai",
        },
      ],
      HEAD
    );
    expect(standing.objected).toBe(false);
    expect(standing.staleDropped).toBe(1);
  });

  it("drops a review whose commit is unknown, rather than admitting it", () => {
    const standing = mod.readObjectionAtHead(
      [{ state: "CHANGES_REQUESTED", author: "coderabbitai" }],
      HEAD
    );
    expect(standing.objected).toBe(false);
  });

  it("does not mistake an approval at head for an objection", () => {
    const standing = mod.readObjectionAtHead(
      [{ state: "APPROVED", commitSha: HEAD, author: "coderabbitai" }],
      HEAD
    );
    expect(standing.objected).toBe(false);
  });

  it("reads nothing when there is no head to read against", () => {
    const standing = mod.readObjectionAtHead(
      [{ state: "CHANGES_REQUESTED", commitSha: HEAD, author: "coderabbitai" }],
      undefined
    );
    expect(standing.objected).toBe(false);
  });
});

describe("the gate distinguishes FOUR outcomes, not two", () => {
  const objection = {
    objected: true,
    reviewers: ["coderabbitai"],
    staleDropped: 0,
  };

  it("REVIEWED — a review ran and said nothing was wrong", () => {
    const verdict = mod.reviewGateVerdict(reading(COMPLETED));
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.satisfied);
    expect(verdict.title).toContain("REVIEWED");
  });

  it("WAIVED — rate limited, and no review exists", () => {
    const verdict = mod.reviewGateVerdict(reading(RATE_LIMITED));
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.waived);
    expect(verdict.title).toContain("WAIVED");
  });

  it("UNREVIEWED — the declared check reported nothing at all", () => {
    const verdict = mod.reviewGateVerdict({
      states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.unsatisfied },
      conditions: { [CODERABBIT]: "absent" },
      descriptions: {},
    });
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied);
    expect(verdict.title).toContain("UNREVIEWED");
  });

  it("OBJECTED — rate limited, AND a review nonetheless objected", () => {
    // THE FIXTURE THE TICKET DEMANDS. A classifier built only from
    // rate-limited-and-genuinely-unreviewed passes a string-reading
    // implementation, which is exactly the implementation that fails in
    // production. This row and the WAIVED row carry the identical description.
    const verdict = mod.reviewGateVerdict(reading(RATE_LIMITED, { objection }));
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied);
    expect(verdict.title).toContain("OBJECTED");
    expect(verdict.title).not.toContain("WAIVED");
  });

  it("OBJECTED — the shape actually measured: `Review completed` plus an objection", () => {
    // 2 of the 60 most recently updated merged pull requests here. Before this
    // change the gate published `REVIEWED — CodeRabbit reported "Review
    // completed"` on both, which is true of the check and false of the pull
    // request.
    const verdict = mod.reviewGateVerdict(reading(COMPLETED, { objection }));
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied);
    expect(verdict.title).toContain("OBJECTED");
  });

  it("renders all four as four distinct titles", () => {
    const titles = [
      mod.reviewGateVerdict(reading(COMPLETED)).title,
      mod.reviewGateVerdict(reading(RATE_LIMITED)).title,
      mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.unsatisfied },
        conditions: { [CODERABBIT]: "absent" },
        descriptions: {},
      }).title,
      mod.reviewGateVerdict(reading(RATE_LIMITED, { objection })).title,
    ];
    expect(new Set(titles).size).toBe(4);
  });
});

describe("a probe that could not read is not a probe that found nothing", () => {
  it("reports UNREAD when the reviews cannot be fetched", () => {
    const standing = mod.readReviewObjection("1", "OWNER/NAME", HEAD, {
      fetchReviews: () => {
        throw new Error(GH_FAILED);
      },
    });
    expect(standing.unread).toContain(GH_FAILED);
    expect(standing.violations.map(v => v.kind)).toEqual([
      mod.VIOLATIONS.reviewObjectionUnread,
    ]);
  });

  it("caps a satisfied verdict below REVIEWED when the probe failed", () => {
    const verdict = mod.reviewGateVerdict(
      reading(COMPLETED, {
        objection: { objected: false, reviewers: [], unread: GH_FAILED },
      })
    );
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.waived);
    expect(verdict.title).toContain("OBJECTION STANDING UNKNOWN");
  });

  it("never blocks the build on its own failed read", () => {
    // The rejection control for the cap above. Reddening an author's pull
    // request because one API call failed is the "gate that gets deleted"
    // shape; capping the RENDERING is the proportionate response.
    for (const policy of [
      { warnOnly: false, failOnVacuous: false, requireReviewEvidence: true },
      { warnOnly: false, failOnVacuous: true, requireReviewEvidence: true },
    ]) {
      expect(
        mod.violationBlocks(
          { kind: mod.VIOLATIONS["reviewObjectionUnread"] as string },
          policy
        )
      ).toBe(false);
    }
  });

  it("DOES block on a real objection, once the gate is armed", () => {
    const standing = mod.readReviewObjection("1", "OWNER/NAME", HEAD, {
      fetchReviews: () => [
        { state: "CHANGES_REQUESTED", commitSha: HEAD, author: "coderabbitai" },
      ],
    });
    expect(standing.violations.map(v => v.kind)).toEqual([
      mod.VIOLATIONS.reviewObjected,
    ]);
    expect(
      mod.violationBlocks(
        { kind: mod.VIOLATIONS["reviewObjected"] as string },
        { warnOnly: false, failOnVacuous: false, requireReviewEvidence: true }
      )
    ).toBe(true);
    // And only once armed — the gate is opt-in per repository, exactly as
    // `review_evidence_unsatisfied` already is.
    expect(
      mod.violationBlocks(
        { kind: mod.VIOLATIONS["reviewObjected"] as string },
        { warnOnly: false, failOnVacuous: false, requireReviewEvidence: false }
      )
    ).toBe(false);
  });
});

describe("the waive-rate escalation lever ships DOWN", () => {
  const waiveRate = { waived: 36, sampled: 40 };

  it("changes nothing when no threshold was set", () => {
    // THE SAFETY PROPERTY OF THIS WHOLE CHANGE. No workflow in this tree passes
    // `--waive-rate-escalate`, so every waived pull request renders exactly as
    // it did before: `neutral`, blocking nothing. Whether 36-of-40 should stop
    // being tolerated is a decision for the repository owner, not for this
    // script.
    const verdict = mod.reviewGateVerdict(reading(RATE_LIMITED, { waiveRate }));
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.waived);
    expect(verdict.title).not.toContain("THRESHOLD");
  });

  it("escalates the RENDERING once a repository sets a threshold it passes", () => {
    const verdict = mod.reviewGateVerdict(
      reading(RATE_LIMITED, { waiveRate, escalate: 20 })
    );
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied);
    expect(verdict.title).toContain("THRESHOLD");
    // The severity is untouched: the waiver stays report-only in the exit code
    // whatever the threshold says. Those arrays ARE the owner's ruling, and a
    // flag that reached through them would repeal a decision from a CLI.
    expect(
      mod.violationBlocks(
        { kind: mod.VIOLATIONS["reviewWaived"] as string },
        { warnOnly: false, failOnVacuous: true, requireReviewEvidence: true }
      )
    ).toBe(false);
  });

  it("does not escalate below the threshold", () => {
    expect(mod.waiverEscalates(waiveRate, 37)).toBe(false);
    expect(mod.waiverEscalates(waiveRate, 36)).toBe(true);
  });

  it("refuses to escalate on a rate that was never measured", () => {
    // `sampleWaiveRate` is best-effort by construction — an unreachable API
    // returns undefined. Escalating on that would be a verdict reached from a
    // measurement that never happened, which is the family of defect this whole
    // gate is about.
    expect(mod.waiverEscalates(undefined, 1)).toBe(false);
    expect(mod.waiverEscalates({ waived: 0, sampled: 0 }, 1)).toBe(false);
  });

  it("ignores a threshold that is not a positive integer", () => {
    expect(mod.waiverEscalates(waiveRate, 0)).toBe(false);
    expect(mod.waiverEscalates(waiveRate, undefined)).toBe(false);
  });
});
