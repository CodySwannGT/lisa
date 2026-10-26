/**
 * A writer's posted substitute review satisfies the review gate when the
 * declared reviewer never reported.
 *
 * The defect: a repository that declares a reviewer it has not installed saw
 * `🕵️ Review evidence gate` red on every pull request with no route to green,
 * while the response arm (`check-third-party-review-evidence.mjs`) already
 * accepted a `lisa:review-substitute` comment for the same head. The two arms
 * published opposite verdicts for one commit.
 *
 * The boundary this suite holds: a substitute stands in ONLY for a reviewer
 * that never reported (`absent` / `undetermined`), ONLY for this exact head,
 * ONLY from a writer, and ONLY as the comment's first line. It never overrules
 * a review that ran and objected.
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
const WRITER = "maintainer";
const READER = "drive-by";
const RATE_LIMITED = "Review rate limited";
const UNRECOGNISED = "Something new";
/** A review surface that was read and shows no objection. */
const CLEAN_SURFACE = { read: true, present: false, objected: false } as const;

/** One issue comment as this suite builds them. */
interface Comment {
  readonly body: string;
  readonly author: string;
}

/** A check row as the settle reader returns them. */
interface Check {
  readonly name: string;
  readonly state: string;
  readonly bucket?: string;
  readonly description?: string;
}

/** The exports this suite exercises. */
interface GuardModule {
  readonly REVIEW_GATE_STATES: Record<string, string>;
  readonly REVIEW_GATE_CONDITIONS: Record<string, string>;
  readonly REVIEW_VERDICT_CONCLUSIONS: Record<string, string>;
  readonly VIOLATIONS: Record<string, string>;
  reviewSubstituteMarker(context: string, sha: string): string;
  substitutesAtHead(
    comments: readonly Comment[],
    names: readonly string[],
    headSha: string | undefined,
    canWrite: (login: string) => boolean
  ): Set<string>;
  fetchWritePermission(login: string, repo: string | undefined): boolean;
  readReviewSubstitutes(
    declaration: Record<string, unknown>,
    pr: string,
    repo: string | undefined,
    headSha: string | undefined,
    options?: Record<string, unknown>
  ): Set<string>;
  evaluateReviewGate(
    declaration: Record<string, unknown>,
    checks: readonly Check[],
    options?: Record<string, unknown>
  ): {
    violations: ReadonlyArray<{ kind: string }>;
    states: Record<string, string>;
    conditions: Record<string, string>;
  };
  reviewGateVerdict(reading?: Record<string, unknown>): {
    verdict: string;
    conclusion: string;
    title: string;
  };
  inspectVacuity(
    argv: readonly string[],
    declaration: Record<string, unknown>,
    options?: Record<string, unknown>
  ):
    | {
        violations: ReadonlyArray<{ kind: string; token?: string }>;
        verdict: { conclusion: string; title: string };
      }
    | undefined;
}

let mod: GuardModule;

const DECLARATION = {
  evidence_bearing_checks: { [CODERABBIT]: {} },
} as const;

beforeAll(async () => {
  mod = (await import(
    pathToFileURL(path.join(REPO_ROOT, SCRIPT_REL)).href
  )) as unknown as GuardModule;
});

const writersOnly = (login: string): boolean => login === WRITER;

/**
 * The marker format, spelled out here so a drift in the script is caught.
 * @param context - The reviewer the substitute stands in for
 * @param sha - The head it reviewed
 * @returns The marker line
 */
const marker = (context: string, sha: string): string =>
  `<!-- lisa:review-substitute context="${context}" head="${sha}" -->`;

/**
 * A substitute comment body whose first line is the marker.
 * @param sha - The head the substitute claims to have reviewed
 * @param context - The reviewer it stands in for
 * @returns The comment body
 */
const substituteBody = (sha: string, context = CODERABBIT): string =>
  `${marker(context, sha)}\n## Local adversarial review\nNo findings.`;

describe("which comments count as a substitute", () => {
  it("matches the marker format the response arm and lisa-drive-pr-to-merge use", () => {
    expect(mod.reviewSubstituteMarker(CODERABBIT, HEAD)).toBe(
      marker(CODERABBIT, HEAD)
    );
  });

  it("counts a writer's first-line marker for this head", () => {
    const found = mod.substitutesAtHead(
      [{ body: substituteBody(HEAD), author: WRITER }],
      [CODERABBIT],
      HEAD,
      writersOnly
    );
    expect([...found]).toEqual([CODERABBIT]);
  });

  it("tolerates a CRLF first line", () => {
    const body = substituteBody(HEAD).replace("\n", "\r\n");
    const found = mod.substitutesAtHead(
      [{ body, author: WRITER }],
      [CODERABBIT],
      HEAD,
      writersOnly
    );
    expect(found.has(CODERABBIT)).toBe(true);
  });

  it.each([
    ["a commenter without write access", substituteBody(HEAD), READER],
    ["a substitute for an earlier push", substituteBody(OLDER), WRITER],
    [
      "a substitute for a different reviewer",
      substituteBody(HEAD, "Other Reviewer"),
      WRITER,
    ],
    [
      "a marker that is not the first line",
      `Post this to pass:\n${marker(CODERABBIT, HEAD)}`,
      WRITER,
    ],
  ])("ignores %s", (_label, body, author) => {
    const found = mod.substitutesAtHead(
      [{ body, author }],
      [CODERABBIT],
      HEAD,
      writersOnly
    );
    expect(found.size).toBe(0);
  });

  it("counts nothing without a concrete head", () => {
    const found = mod.substitutesAtHead(
      [{ body: substituteBody(HEAD), author: WRITER }],
      [CODERABBIT],
      undefined,
      writersOnly
    );
    expect(found.size).toBe(0);
  });

  it.each(["user_shortcode", "a/../b", "", "x y"])(
    "refuses to look up a login the pattern rejects: %j",
    login => {
      // No `gh` is reachable for these: the pattern refuses before any call.
      expect(mod.fetchWritePermission(login, "o/r")).toBe(false);
    }
  );

  it("fails closed when the comments cannot be read", () => {
    const found = mod.readReviewSubstitutes(DECLARATION, "1", "o/r", HEAD, {
      fetchComments: () => {
        throw new Error("gh exited 1");
      },
      canWrite: () => true,
    });
    expect(found.size).toBe(0);
  });

  it("asks about each author's permission once", () => {
    let asked = 0;
    mod.readReviewSubstitutes(DECLARATION, "1", "o/r", HEAD, {
      fetchComments: () => [
        { body: substituteBody(HEAD), author: READER },
        { body: substituteBody(HEAD), author: READER },
      ],
      canWrite: () => {
        asked += 1;
        return false;
      },
    });
    expect(asked).toBe(1);
  });
});

describe("what a substitute can and cannot stand in for", () => {
  const substitutes = new Set([CODERABBIT]);

  it("satisfies a reviewer that never reported", () => {
    const gate = mod.evaluateReviewGate(DECLARATION, [], {
      headSha: HEAD,
      substitutes,
      reviewActivity: CLEAN_SURFACE,
    });
    expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.satisfied);
    expect(gate.conditions[CODERABBIT]).toBe(
      mod.REVIEW_GATE_CONDITIONS.substituted
    );
    expect(gate.violations).toEqual([]);
  });

  it("satisfies a reviewer the settle wait gave up on", () => {
    const gate = mod.evaluateReviewGate(DECLARATION, [], {
      headSha: HEAD,
      waitExpired: true,
      substitutes,
      reviewActivity: CLEAN_SURFACE,
    });
    expect(gate.conditions[CODERABBIT]).toBe(
      mod.REVIEW_GATE_CONDITIONS.substituted
    );
  });

  it("never overrules a review that ran and objected", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [
        {
          name: CODERABBIT,
          state: "FAILURE",
          description: "Changes requested",
        },
      ],
      { headSha: HEAD, substitutes, reviewActivity: CLEAN_SURFACE }
    );
    expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
    expect(gate.conditions[CODERABBIT]).toBe(
      mod.REVIEW_GATE_CONDITIONS.objected
    );
  });

  it("does not stand in for a reviewer that is still working", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: CODERABBIT, state: "PENDING", description: "Review queued" }],
      { headSha: HEAD, substitutes, reviewActivity: CLEAN_SURFACE }
    );
    expect(gate.conditions[CODERABBIT]).toBe(
      mod.REVIEW_GATE_CONDITIONS.pending
    );
  });

  it("does not stand in for a reviewer still running when the wait expired", () => {
    // `undetermined` is also what an IN-FLIGHT row reads as after the wait
    // expires; standing in for it would race a review whose objection lands
    // after the merge.
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [
        {
          name: CODERABBIT,
          state: "PENDING",
          description: "Review in progress",
        },
      ],
      {
        headSha: HEAD,
        waitExpired: true,
        substitutes,
        reviewActivity: CLEAN_SURFACE,
      }
    );
    expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.unsatisfied);
    expect(gate.conditions[CODERABBIT]).toBe(
      mod.REVIEW_GATE_CONDITIONS.undetermined
    );
  });

  it.each([
    ["was rate limited", RATE_LIMITED],
    ["skipped", "Review skipped: manual review required"],
    ["said something unrecognised", UNRECOGNISED],
  ])(
    "stands in for a reviewer that %s, so a rate limit never needs a human",
    (_label, description) => {
      const gate = mod.evaluateReviewGate(
        DECLARATION,
        [{ name: CODERABBIT, state: "SUCCESS", description }],
        { headSha: HEAD, substitutes, reviewActivity: CLEAN_SURFACE }
      );
      expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.satisfied);
      expect(gate.conditions[CODERABBIT]).toBe(
        mod.REVIEW_GATE_CONDITIONS.substituted
      );
      expect(gate.violations).toEqual([]);
    }
  );

  it.each([
    ["could not be read", { read: false, present: false, objected: false }],
    ["was never read", undefined],
    [
      "shows an objection (CHANGES_REQUESTED or an unresolved thread)",
      { read: true, present: true, objected: true },
    ],
  ])(
    "never stands in for a reviewer that spoke when the review surface %s",
    (_label, activity) => {
      for (const description of [RATE_LIMITED, UNRECOGNISED]) {
        const gate = mod.evaluateReviewGate(
          DECLARATION,
          [{ name: CODERABBIT, state: "SUCCESS", description }],
          { headSha: HEAD, substitutes, reviewActivity: activity }
        );
        expect(gate.conditions[CODERABBIT], description).not.toBe(
          mod.REVIEW_GATE_CONDITIONS.substituted
        );
        expect(gate.states[CODERABBIT], description).not.toBe(
          mod.REVIEW_GATE_STATES.satisfied
        );
      }
    }
  );

  it.each([
    ["was never read", undefined],
    ["could not be read", { read: false, present: false, objected: false }],
    [
      "shows an earlier objection or an open thread",
      { read: true, present: true, objected: true },
    ],
  ])(
    "never stands in for a reviewer that never posted when the surface %s",
    (_label, activity) => {
      const gate = mod.evaluateReviewGate(DECLARATION, [], {
        headSha: HEAD,
        substitutes,
        reviewActivity: activity,
      });
      expect(gate.conditions[CODERABBIT]).not.toBe(
        mod.REVIEW_GATE_CONDITIONS.substituted
      );
    }
  );

  it("still files the waiver when nobody stood in for a rate limit", () => {
    const gate = mod.evaluateReviewGate(
      DECLARATION,
      [{ name: CODERABBIT, state: "SUCCESS", description: RATE_LIMITED }],
      { headSha: HEAD, substitutes: new Set() }
    );
    expect(gate.states[CODERABBIT]).toBe(mod.REVIEW_GATE_STATES.waived);
  });

  it("quotes what a rate-limited reviewer said rather than claiming it posted nothing", () => {
    const verdict = mod.reviewGateVerdict({
      states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied },
      conditions: { [CODERABBIT]: mod.REVIEW_GATE_CONDITIONS.substituted },
      descriptions: { [CODERABBIT]: RATE_LIMITED },
      objection: { objected: false, reviewers: [], staleDropped: 0 },
    });
    expect(verdict.title).toContain(
      `CodeRabbit reported ${JSON.stringify(RATE_LIMITED)} without reviewing`
    );
    expect(verdict.title).not.toContain("posted NO review status");
  });

  it("publishes SUBSTITUTED, not REVIEWED", () => {
    const verdict = mod.reviewGateVerdict({
      states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied },
      conditions: { [CODERABBIT]: mod.REVIEW_GATE_CONDITIONS.substituted },
      descriptions: {},
      objection: { objected: false, reviewers: [], staleDropped: 0 },
    });
    expect(verdict.conclusion).toBe(mod.REVIEW_VERDICT_CONCLUSIONS.satisfied);
    expect(verdict.title).toMatch(/^SUBSTITUTED — no third-party review/);
    expect(verdict.title).not.toMatch(/^REVIEWED/);
  });

  it.each([
    ["the objection read failed", { objection: { unread: "gh exited 1" } }],
    [
      "the pull request carries unreviewed work",
      {
        carried: { unreviewed: ["#1"], read: 1 },
        objection: { objected: false, reviewers: [], staleDropped: 0 },
      },
    ],
  ])(
    "never says the review ran when a substitute stood in and %s",
    (_label, extra) => {
      const verdict = mod.reviewGateVerdict({
        states: { [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied },
        conditions: { [CODERABBIT]: mod.REVIEW_GATE_CONDITIONS.substituted },
        descriptions: { [CODERABBIT]: RATE_LIMITED },
        ...extra,
      });
      expect(verdict.title).not.toMatch(/review ran/);
    }
  );

  it("does not claim 'no third-party review' when another reviewer did review", () => {
    const verdict = mod.reviewGateVerdict({
      states: {
        [CODERABBIT]: mod.REVIEW_GATE_STATES.satisfied,
        "Other Reviewer": mod.REVIEW_GATE_STATES.satisfied,
      },
      conditions: {
        [CODERABBIT]: mod.REVIEW_GATE_CONDITIONS.substituted,
        "Other Reviewer": mod.REVIEW_GATE_CONDITIONS.satisfied,
      },
      descriptions: { "Other Reviewer": "Review completed" },
      objection: { objected: false, reviewers: [], staleDropped: 0 },
    });
    expect(verdict.title).toMatch(/^SUBSTITUTED IN PART — .* 1 of 2 /);
    expect(verdict.title).not.toContain("no third-party review");
  });
});

describe("the armed gate end to end", () => {
  /**
   * Inspects one pull request.
   * @param options - What the seams return
   * @param options.substitutes - The substitute set, per head SHA
   * @param options.rows - The check rows every snapshot returns
   * @param options.heads - Successive head SHAs; the last one repeats
   * @param options.declaration - The declaration to inspect against
   * @returns The inspection and how often the settle loop slept
   */
  const inspect = ({
    substitutes,
    rows = [{ name: "🧹 Lint", state: "SUCCESS", bucket: "pass" }],
    heads = [HEAD],
    declaration = DECLARATION,
    reviews = [],
    activity = CLEAN_SURFACE,
  }: {
    substitutes: (sha: string | undefined) => Set<string>;
    rows?: readonly Check[];
    heads?: readonly string[];
    declaration?: Record<string, unknown>;
    reviews?: readonly { state: string; commitSha: string; author: string }[];
    activity?: { read: boolean; present: boolean; objected: boolean };
  }): {
    inspection: ReturnType<GuardModule["inspectVacuity"]>;
    sleeps: number;
    surfaceReads: number;
  } => {
    let surfaceReads = 0;
    let sleeps = 0;
    let now = 0;
    let call = 0;
    const inspection = mod.inspectVacuity(
      ["--vacuity", "--require-review-evidence", "--pr=1", "--repo=o/r"],
      declaration,
      {
        headSha: () => heads[Math.min(call++, heads.length - 1)],
        fetch: () => rows,
        now: () => now,
        sleep: (ms: number) => {
          sleeps += 1;
          now += ms;
        },
        readSubstitutes: (
          _declaration: unknown,
          _pr: unknown,
          _repo: unknown,
          sha: string | undefined
        ) => substitutes(sha),
        fetchCarried: () => [],
        fetchReviews: () => reviews,
        reviewActivity: () => {
          surfaceReads += 1;
          return activity;
        },
      }
    );
    return { inspection, sleeps, surfaceReads };
  };
  const rateLimited: readonly Check[] = [
    {
      name: CODERABBIT,
      state: "SUCCESS",
      bucket: "pass",
      description: RATE_LIMITED,
    },
  ];

  it("greens a rate-limited head with a substitute, without waiting", () => {
    const { inspection, sleeps } = inspect({
      substitutes: atHead,
      rows: rateLimited,
    });
    expect(sleeps).toBe(0);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.satisfied
    );
    expect(inspection?.verdict.title).toMatch(/^SUBSTITUTED/);
  });

  it("reads the review surface before standing in for a rate-limited reviewer", () => {
    const { surfaceReads } = inspect({
      substitutes: atHead,
      rows: rateLimited,
    });
    expect(surfaceReads).toBe(1);
  });

  it("never lets a substitute hide open threads or an earlier objection under a rate limit", () => {
    // A COMMENTED review with unresolved threads, or a CHANGES_REQUESTED on an
    // earlier push whose status a re-request overwrote with a rate limit: the
    // review objects at THIS head show nothing, only the surface does.
    const { inspection } = inspect({
      substitutes: atHead,
      rows: rateLimited,
      activity: { read: true, present: true, objected: true },
    });
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
    );
    expect(inspection?.verdict.title).not.toMatch(/^SUBSTITUTED/);
  });

  it("reads the review surface to stand in for an unrecognised reviewer, which is never waived", () => {
    // Not waived, so only the substitute can pay for the surface read; without
    // it there is no clean surface and the substitute must not count.
    const { inspection, surfaceReads } = inspect({
      substitutes: atHead,
      rows: [
        {
          name: CODERABBIT,
          state: "SUCCESS",
          bucket: "pass",
          description: UNRECOGNISED,
        },
      ],
    });
    expect(surfaceReads).toBe(1);
    expect(inspection?.verdict.title).toMatch(/^SUBSTITUTED/);
  });

  it("does not stand in for a rate limit when the review surface cannot be read", () => {
    const { inspection } = inspect({
      substitutes: atHead,
      rows: rateLimited,
      activity: { read: false, present: false, objected: false },
    });
    expect(inspection?.verdict.title).not.toMatch(/^SUBSTITUTED/);
  });

  it("never lets a substitute hide an objection a rate-limited reviewer left at this head", () => {
    const { inspection } = inspect({
      substitutes: atHead,
      rows: rateLimited,
      reviews: [
        { state: "CHANGES_REQUESTED", commitSha: HEAD, author: "coderabbitai" },
      ],
    });
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
    );
    expect(inspection?.verdict.title).toMatch(/^OBJECTED/);
  });
  const atHead = (sha: string | undefined): Set<string> =>
    sha === HEAD ? new Set([CODERABBIT]) : new Set();

  it("passes without waiting when a writer stood in for every reviewer", () => {
    const { inspection, sleeps } = inspect({ substitutes: atHead });
    expect(sleeps).toBe(0);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.satisfied
    );
    expect(inspection?.verdict.title).toMatch(/^SUBSTITUTED/);
    const kinds = inspection?.violations.map(violation => violation.kind);
    expect(kinds).not.toContain(mod.VIOLATIONS.reviewUnsatisfied);
    expect(kinds).not.toContain(mod.VIOLATIONS.unproven);
  });

  it("still waits and blocks when nobody stood in", () => {
    const { inspection, sleeps } = inspect({ substitutes: () => new Set() });
    expect(sleeps).toBeGreaterThan(0);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
    );
    expect(inspection?.violations.map(violation => violation.kind)).toContain(
      mod.VIOLATIONS.reviewUnsatisfied
    );
  });

  it("waits for a reviewer already in flight instead of standing in for it", () => {
    const { inspection, sleeps } = inspect({
      substitutes: atHead,
      rows: [{ name: CODERABBIT, state: "PENDING", bucket: "pending" }],
    });
    expect(sleeps).toBeGreaterThan(0);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
    );
    expect(inspection?.verdict.title).not.toMatch(/^SUBSTITUTED/);
  });

  it("still waits when only one of two declared reviewers was stood in for", () => {
    const { inspection, sleeps } = inspect({
      substitutes: atHead,
      declaration: {
        evidence_bearing_checks: { [CODERABBIT]: {}, "Other Reviewer": {} },
      },
    });
    expect(sleeps).toBeGreaterThan(0);
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
    );
  });

  it("sees a substitute posted while the gate was waiting at the same head", () => {
    let reads = 0;
    const { inspection, sleeps } = inspect({
      // Nothing on the early read; the marker lands during the wait.
      substitutes: sha => {
        reads += 1;
        return reads > 1 && sha === HEAD ? new Set([CODERABBIT]) : new Set();
      },
    });
    expect(sleeps).toBeGreaterThan(0);
    expect(reads).toBe(2);
    expect(inspection?.verdict.title).toMatch(/^SUBSTITUTED/);
  });

  it("drops a substitute for a head that was replaced before the settled read", () => {
    // The early read sees OLDER, which carries a substitute; the settled read
    // sees HEAD, which does not. Reusing the early set would green HEAD on a
    // review of a different commit.
    const { inspection } = inspect({
      substitutes: sha => (sha === OLDER ? new Set([CODERABBIT]) : new Set()),
      heads: [OLDER, HEAD],
    });
    expect(inspection?.verdict.conclusion).toBe(
      mod.REVIEW_VERDICT_CONCLUSIONS.unsatisfied
    );
  });
});
