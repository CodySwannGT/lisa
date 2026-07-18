/**
 * Regression coverage for build-side queue readers used by `/lisa:queue-status`.
 *
 * Issue #825 adds the first build queue readers for the queue-status surface:
 * GitHub build queue parsing plus vendor-parity snapshots that preserve the
 * same lifecycle counts, actionable highlights, and repair-intake signals
 * across GitHub, Linear, and JIRA inputs.
 * @module tests/unit/strategies/queue-status-build-readers
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createBuildQueueSnapshot,
  readGithubBuildQueueSnapshot,
} from "../../../plugins/src/base/scripts/queue-status-build-readers.mjs";

const FIXTURE_ROOT = path.resolve("tests/fixtures/queue-status-build-readers");
const GITHUB_READY_LABEL = "status:ready";
const GITHUB_CLAIMED_LABEL = "status:in-progress";
const GITHUB_BLOCKED_LABEL = "status:blocked";
const GITHUB_DONE_LABEL = "status:done";
const GITHUB_BUILD_QUEUE_ARGUMENT = "github intake_mode=build";
const GITHUB_DONE_ROLES = {
  dev: "status:on-dev",
  staging: "status:on-stg",
  production: GITHUB_DONE_LABEL,
} as const;

/**
 *
 */
type QueueFixture = {
  readonly tracker: string;
  readonly items: readonly Record<string, unknown>[];
};

const readFixture = (name: string): QueueFixture =>
  JSON.parse(
    readFileSync(path.join(FIXTURE_ROOT, `${name}.json`), "utf8")
  ) as QueueFixture;

describe("queue-status build readers (#825)", () => {
  it("parses GitHub build lifecycle labels into counts, highlights, and repair signals", () => {
    const snapshot = readGithubBuildQueueSnapshot({
      namespaceAdopted: true,
      queueArgument: GITHUB_BUILD_QUEUE_ARGUMENT,
      roles: {
        ready: GITHUB_READY_LABEL,
        claimed: GITHUB_CLAIMED_LABEL,
        blocked: GITHUB_BLOCKED_LABEL,
        done: GITHUB_DONE_ROLES,
      },
      issues: [
        {
          number: 825,
          title: "Ready build item waiting for intake",
          url: "https://github.com/CodySwannGT/lisa/issues/825",
          createdAt: "2026-05-25T10:00:00Z",
          labels: [{ name: GITHUB_READY_LABEL }],
        },
        {
          number: 826,
          title: "Claimed build item still in flight",
          url: "https://github.com/CodySwannGT/lisa/issues/826",
          createdAt: "2026-05-24T10:00:00Z",
          labels: [{ name: GITHUB_CLAIMED_LABEL }],
        },
        {
          number: 827,
          title: "Blocked build item needs clarification",
          url: "https://github.com/CodySwannGT/lisa/issues/827",
          createdAt: "2026-05-23T10:00:00Z",
          labels: [{ name: GITHUB_BLOCKED_LABEL }],
        },
        {
          number: 828,
          title: "Stalled claimed build item",
          url: "https://github.com/CodySwannGT/lisa/issues/828",
          createdAt: "2026-05-22T10:00:00Z",
          labels: [{ name: GITHUB_CLAIMED_LABEL }],
          stalled: true,
        },
        {
          number: 829,
          title: "Done build item on production",
          url: "https://github.com/CodySwannGT/lisa/issues/829",
          createdAt: "2026-05-21T10:00:00Z",
          labels: [{ name: GITHUB_DONE_LABEL }],
        },
      ],
    });

    expect(snapshot.tracker).toBe("github");
    expect(snapshot.counts).toEqual({
      ready: 1,
      claimed: 2,
      review: 0,
      blocked: 1,
      done: 1,
    });
    expect(snapshot.highlights.map(highlight => highlight.role)).toEqual([
      "stalled",
      "blocked",
      "ready",
      "claimed",
    ]);
    expect(snapshot.highlights[0]).toMatchObject({
      ref: "#828",
      summary: "Oldest stalled build item likely actionable for repair-intake",
    });
    expect(snapshot.highlights[1].nextStep).toBe(
      "Run /lisa:repair-intake github intake_mode=build after clearing the blocker."
    );
    expect(snapshot.repairSignals).toMatchObject({
      actionable: true,
      blocked: [{ ref: "#827" }],
      stalled: [{ ref: "#828" }],
      suggestedCommand:
        "Run /lisa:repair-intake github intake_mode=build to inspect the most actionable stuck build work.",
    });
    expect(snapshot.health).toMatchObject({
      verdict: "ATTENTION_NEEDED",
      reasons: ["blocked-work-present", "stalled-work-present"],
    });
  });

  it("treats missing namespace adoption as misconfigured instead of idle", () => {
    const snapshot = createBuildQueueSnapshot({
      tracker: "github",
      namespaceAdopted: false,
      queueArgument: GITHUB_BUILD_QUEUE_ARGUMENT,
      items: [],
    });

    expect(snapshot.health).toMatchObject({
      verdict: "MISCONFIGURED",
      reasons: ["lifecycle-namespace-absent"],
    });
  });

  it("does not infer namespace adoption from normalized fallback roles", () => {
    const snapshot = createBuildQueueSnapshot({
      tracker: "github",
      queueArgument: GITHUB_BUILD_QUEUE_ARGUMENT,
      items: [],
    });

    expect(snapshot.namespaceAdopted).toBe(false);
    expect(snapshot.health).toMatchObject({
      verdict: "MISCONFIGURED",
      reasons: ["lifecycle-namespace-absent"],
    });
  });

  it("applies default GitHub build labels when roles are omitted", () => {
    const snapshot = readGithubBuildQueueSnapshot({
      namespaceAdopted: true,
      issues: [
        {
          number: 875,
          title: "Ready build item using the default label",
          labels: [{ name: GITHUB_READY_LABEL }],
        },
      ],
    });

    expect(snapshot.counts.ready).toBe(1);
  });

  it("scopes umbrella counts to current-repo labels while retaining unlabeled candidates", () => {
    const fixture = readFixture("github-umbrella");
    const snapshot = readGithubBuildQueueSnapshot({
      namespaceAdopted: true,
      currentRepo: "frontend",
      issues: fixture.items,
    });

    expect(snapshot.counts).toMatchObject({
      ready: 1,
      claimed: 1,
      blocked: 0,
    });
    expect(snapshot.highlights.map(highlight => highlight.ref)).toContain(
      "#1617"
    );
    expect(snapshot.highlights.map(highlight => highlight.ref)).not.toContain(
      "#1618"
    );
    expect(snapshot.highlights.map(highlight => highlight.ref)).not.toContain(
      "#1619"
    );
    expect(snapshot.unscopedCount).toBe(1);
    expect(snapshot.unscopedCandidates).toEqual([
      expect.objectContaining({ ref: "#1619", role: "blocked" }),
    ]);
  });

  it("fails loudly when a non-GitHub tracker has no raw reader input", () => {
    const snapshot = createBuildQueueSnapshot({
      tracker: "linear",
      queueArgument: "linear intake_mode=build",
    });

    expect(snapshot).toMatchObject({
      tracker: "linear",
      queueResolved: false,
      resolutionError:
        "vendor reader not implemented for build tracker 'linear'",
    });
    expect(snapshot.health).toMatchObject({
      verdict: "MISCONFIGURED",
      reasons: ["queue-unresolved"],
    });
  });

  it("keeps fixture-backed vendor parity for counts, highlights, and repair signals", () => {
    const fixtureNames = ["github", "linear", "jira"];
    const snapshots = fixtureNames.map(name => {
      const fixture = readFixture(name);
      return createBuildQueueSnapshot({
        tracker: fixture.tracker,
        queueArgument:
          fixture.tracker === "jira"
            ? "LAS"
            : `${fixture.tracker} intake_mode=build`,
        namespaceAdopted: true,
        items: fixture.items,
      });
    });

    for (const snapshot of snapshots) {
      expect(snapshot.counts).toEqual({
        ready: 1,
        claimed: 2,
        review: 1,
        blocked: 1,
        done: 1,
      });
      expect(snapshot.highlights.map(highlight => highlight.role)).toEqual([
        "stalled",
        "blocked",
        "ready",
        "claimed",
        "review",
      ]);
      expect(snapshot.repairSignals.actionable).toBe(true);
      expect(snapshot.repairSignals.blocked[0].title).toBe(
        "Blocked build item needs clarification"
      );
      expect(snapshot.repairSignals.stalled[0].title).toBe(
        "Stalled claimed build item"
      );
      expect(snapshot.health.verdict).toBe("ATTENTION_NEEDED");
    }
  });

  it("keeps the distributed reader artifact in lockstep with the source script", () => {
    const sourcePath = path.resolve(
      "plugins/src/base/scripts/queue-status-build-readers.mjs"
    );
    const generatedPath = path.resolve(
      "plugins/lisa/scripts/queue-status-build-readers.mjs"
    );

    expect(existsSync(generatedPath)).toBe(true);
    expect(readFileSync(generatedPath, "utf8")).toBe(
      readFileSync(sourcePath, "utf8")
    );
  });
});
