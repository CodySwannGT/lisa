/**
 * Fixture-backed smoke coverage plus exact queue-status read-only assertions.
 *
 * Issue #826 extends the earlier queue-status scaffold and reader coverage with
 * committed build-queue fixtures plus strict proof that the distributed command,
 * skill, and helper scripts stay aligned with the base plugin source and keep
 * the v1 surface explicitly read-only.
 * @module tests/unit/strategies/queue-status-fixture-smoke-and-read-only
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createBuildQueueSnapshot } from "../../../plugins/src/base/scripts/queue-status-build-readers.mjs";

/**
 *
 */
type QueueFixture = {
  readonly tracker: string;
  readonly items: readonly Record<string, unknown>[];
};

const BASE_PLUGIN_ROOT = path.resolve("plugins/src/base");
const GENERATED_PLUGIN_ROOT = path.resolve("plugins/lisa");
const QUEUE_STATUS_FIXTURES = path.resolve(
  "tests/fixtures/queue-status-build-readers"
);

const readUtf8 = (filePath: string): string => readFileSync(filePath, "utf8");

const readFixture = (name: string): QueueFixture =>
  JSON.parse(
    readUtf8(path.join(QUEUE_STATUS_FIXTURES, `${name}.json`))
  ) as QueueFixture;

describe("queue-status fixture smoke coverage (#826)", () => {
  it("renders build-queue fixtures into consistent actionable health snapshots", () => {
    const snapshots = ["github", "linear", "jira"].map(name => {
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
      expect(snapshot.health).toMatchObject({
        verdict: "ATTENTION_NEEDED",
        reasons: ["blocked-work-present", "stalled-work-present"],
      });
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
      expect(snapshot.highlights[0]).toMatchObject({
        ref:
          snapshot.tracker === "github"
            ? "#828"
            : snapshot.tracker === "linear"
              ? "L-828"
              : "LAS-828",
        summary:
          "Oldest stalled build item likely actionable for repair-intake",
      });
      expect(snapshot.highlights[1].nextStep).toContain("/lisa:repair-intake");
      expect(snapshot.highlights[2].nextStep).toContain("/lisa:intake");
      expect(snapshot.repairSignals).toMatchObject({
        actionable: true,
        suggestedCommand:
          snapshot.tracker === "jira"
            ? "Run /lisa:repair-intake LAS to inspect the most actionable stuck build work."
            : `Run /lisa:repair-intake ${snapshot.tracker} intake_mode=build to inspect the most actionable stuck build work.`,
      });
    }
  });

  it("treats an empty adopted build queue as idle instead of misconfigured", () => {
    const snapshot = createBuildQueueSnapshot({
      tracker: "github",
      queueArgument: "github intake_mode=build",
      namespaceAdopted: true,
      items: [],
    });

    expect(snapshot.counts).toEqual({
      ready: 0,
      claimed: 0,
      review: 0,
      blocked: 0,
      done: 0,
    });
    expect(snapshot.highlights).toEqual([]);
    expect(snapshot.repairSignals).toMatchObject({
      actionable: false,
      blocked: [],
      stalled: [],
    });
    expect(snapshot.health).toMatchObject({
      verdict: "IDLE",
      reasons: ["no-actionable-work"],
    });
  });
});

describe("queue-status source/generated parity and read-only contract (#826)", () => {
  it("keeps the distributed queue-status command in lockstep with the source asset", () => {
    const sourceCommand = readUtf8(
      path.join(BASE_PLUGIN_ROOT, "commands", "lisa", "queue-status.md")
    );

    expect(
      readUtf8(
        path.join(GENERATED_PLUGIN_ROOT, "commands", "lisa", "queue-status.md")
      )
    ).toBe(sourceCommand);
    expect(sourceCommand).toMatch(/read-only in v1/i);
    expect(sourceCommand).toMatch(
      /without mutating work|without mutating queue items/i
    );
  });

  it("keeps the distributed queue-status skill in lockstep with the source asset", () => {
    const sourceSkill = readUtf8(
      path.join(BASE_PLUGIN_ROOT, "skills", "lisa-queue-status", "SKILL.md")
    );

    expect(
      readUtf8(
        path.join(
          GENERATED_PLUGIN_ROOT,
          "skills",
          "lisa-queue-status",
          "SKILL.md"
        )
      )
    ).toBe(sourceSkill);
    expect(sourceSkill).toMatch(/read-only/i);
    expect(sourceSkill).toMatch(
      /It does not create, claim, relabel, repair, transition, comment on, or otherwise mutate queue items\./
    );
    expect(sourceSkill).toMatch(
      /Never create, update, claim, relabel, repair, transition, or comment on queue items from this skill\./
    );
  });

  it("keeps the distributed queue-status scripts in lockstep with the source assets", () => {
    const scriptNames = [
      "queue-contract-resolution.mjs",
      "queue-health-classification.mjs",
      "queue-status-build-readers.mjs",
    ];

    for (const scriptName of scriptNames) {
      expect(
        readUtf8(path.join(GENERATED_PLUGIN_ROOT, "scripts", scriptName))
      ).toBe(readUtf8(path.join(BASE_PLUGIN_ROOT, "scripts", scriptName)));
    }
  });
});
