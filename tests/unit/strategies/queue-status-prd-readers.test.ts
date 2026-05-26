/**
 * Regression coverage for PRD-side queue readers used by `/lisa:queue-status`.
 *
 * Issue #824 adds the first runtime queue readers for the queue-status surface:
 * GitHub PRD queue parsing plus vendor-parity snapshots that preserve the same
 * lifecycle counts and actionable highlights across GitHub, Linear, Notion, and
 * Confluence inputs.
 * @module tests/unit/strategies/queue-status-prd-readers
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createPrdQueueSnapshot,
  readGithubPrdQueueSnapshot,
} from "../../../plugins/src/base/scripts/queue-status-prd-readers.mjs";

const FIXTURE_ROOT = path.resolve("tests/fixtures/queue-status-prd-readers");

/**
 * Canonical label names used by the GitHub PRD lifecycle namespace in tests.
 * Centralised here so each string literal appears exactly once, satisfying the
 * sonarjs/no-duplicate-string rule while keeping tests readable.
 */
const GITHUB_PRD_ROLES = {
  draft: "prd-draft",
  ready: "prd-ready",
  in_review: "prd-in-review",
  blocked: "prd-blocked",
  ticketed: "prd-ticketed",
  shipped: "prd-shipped",
  verified: "prd-verified",
} as const;

/**
 *
 */
type QueueFixture = {
  readonly source: string;
  readonly items: readonly Record<string, unknown>[];
};

const readFixture = (name: string): QueueFixture =>
  JSON.parse(
    readFileSync(path.join(FIXTURE_ROOT, `${name}.json`), "utf8")
  ) as QueueFixture;

describe("queue-status PRD readers (#824)", () => {
  it("parses GitHub PRD lifecycle labels into counts and actionable highlights", () => {
    const snapshot = readGithubPrdQueueSnapshot({
      namespaceAdopted: true,
      queueArgument: "github intake_mode=prd",
      roles: GITHUB_PRD_ROLES,
      issues: [
        {
          number: 824,
          title: "Ready PRD waiting for intake",
          url: "https://github.com/CodySwannGT/lisa/issues/824",
          createdAt: "2026-05-25T10:00:00Z",
          labels: [{ name: GITHUB_PRD_ROLES.ready }],
        },
        {
          number: 825,
          title: "PRD still in review",
          url: "https://github.com/CodySwannGT/lisa/issues/825",
          createdAt: "2026-05-24T10:00:00Z",
          labels: [{ name: GITHUB_PRD_ROLES.in_review }],
        },
        {
          number: 826,
          title: "Blocked PRD needs clarification",
          url: "https://github.com/CodySwannGT/lisa/issues/826",
          createdAt: "2026-05-23T10:00:00Z",
          labels: [{ name: GITHUB_PRD_ROLES.blocked }],
        },
        {
          number: 827,
          title: "Ticketed PRD waiting on build work",
          url: "https://github.com/CodySwannGT/lisa/issues/827",
          createdAt: "2026-05-22T10:00:00Z",
          labels: [{ name: GITHUB_PRD_ROLES.ticketed }],
        },
        {
          number: 828,
          title: "Shipped PRD awaiting verify-prd",
          url: "https://github.com/CodySwannGT/lisa/issues/828",
          createdAt: "2026-05-21T10:00:00Z",
          labels: [{ name: GITHUB_PRD_ROLES.shipped }],
        },
        {
          number: 829,
          title: "Verified PRD",
          url: "https://github.com/CodySwannGT/lisa/issues/829",
          createdAt: "2026-05-20T10:00:00Z",
          labels: [{ name: GITHUB_PRD_ROLES.verified }],
        },
      ],
    });

    expect(snapshot.source).toBe("github");
    expect(snapshot.counts).toEqual({
      draft: 0,
      ready: 1,
      in_review: 1,
      blocked: 1,
      ticketed: 1,
      shipped: 1,
      verified: 1,
    });
    expect(snapshot.highlights.map(highlight => highlight.role)).toEqual([
      "blocked",
      "in_review",
      "shipped",
      "ready",
      "ticketed",
    ]);
    expect(snapshot.highlights[0]).toMatchObject({
      ref: "#826",
      summary: "Oldest blocked PRD",
    });
    expect(snapshot.highlights[0].nextStep).toBe(
      "Run /lisa:repair-intake github intake_mode=prd after clarifying the blocker."
    );
    expect(snapshot.highlights[2].nextStep).toBe(
      "Run /lisa:verify-prd https://github.com/CodySwannGT/lisa/issues/828 to close the shipped loop."
    );
    expect(snapshot.health).toMatchObject({
      verdict: "ATTENTION_NEEDED",
      reasons: ["blocked-work-present", "stalled-work-present"],
    });
  });

  it("treats missing namespace adoption as misconfigured instead of idle", () => {
    const snapshot = createPrdQueueSnapshot({
      source: "github",
      namespaceAdopted: false,
      queueArgument: "github intake_mode=prd",
      items: [],
    });

    expect(snapshot.health).toMatchObject({
      verdict: "MISCONFIGURED",
      reasons: ["lifecycle-namespace-absent"],
    });
  });

  it("infers namespaceAdopted=false when no roles are configured and no items have roles", () => {
    // When neither namespaceAdopted nor roles is supplied, the inference must
    // detect that the lifecycle namespace is absent and return false — not true,
    // which would be the (buggy) result of comparing already-normalized roles
    // against a "non-empty string" check.
    const snapshot = createPrdQueueSnapshot({
      source: "github",
      items: [],
    });

    expect(snapshot.namespaceAdopted).toBe(false);
    expect(snapshot.health).toMatchObject({
      verdict: "MISCONFIGURED",
      reasons: ["lifecycle-namespace-absent"],
    });
  });

  it("infers namespaceAdopted=true when roles are explicitly configured", () => {
    const snapshot = createPrdQueueSnapshot({
      source: "github",
      roles: {
        ready: GITHUB_PRD_ROLES.ready,
        in_review: GITHUB_PRD_ROLES.in_review,
      },
      items: [],
    });

    expect(snapshot.namespaceAdopted).toBe(true);
  });

  it("keeps fixture-backed vendor parity for counts, highlights, and verdicts", () => {
    const fixtureNames = ["github", "linear", "notion", "confluence"];
    const snapshots = fixtureNames.map(name => {
      const fixture = readFixture(name);
      return createPrdQueueSnapshot({
        source: fixture.source,
        queueArgument: `${fixture.source} intake_mode=prd`,
        namespaceAdopted: true,
        items: fixture.items,
      });
    });

    for (const snapshot of snapshots) {
      expect(snapshot.counts).toEqual({
        draft: 0,
        ready: 1,
        in_review: 1,
        blocked: 1,
        ticketed: 1,
        shipped: 1,
        verified: 1,
      });
      expect(snapshot.highlights.map(highlight => highlight.role)).toEqual([
        "blocked",
        "in_review",
        "shipped",
        "ready",
        "ticketed",
      ]);
      expect(snapshot.highlights[0].title).toBe(
        "Blocked PRD needs clarification"
      );
      expect(snapshot.health.verdict).toBe("ATTENTION_NEEDED");
    }
  });

  it("keeps the distributed reader artifact in lockstep with the source script", () => {
    const sourcePath = path.resolve(
      "plugins/src/base/scripts/queue-status-prd-readers.mjs"
    );
    const generatedPath = path.resolve(
      "plugins/lisa/scripts/queue-status-prd-readers.mjs"
    );

    expect(existsSync(generatedPath)).toBe(true);
    expect(readFileSync(generatedPath, "utf8")).toBe(
      readFileSync(sourcePath, "utf8")
    );
  });
});
