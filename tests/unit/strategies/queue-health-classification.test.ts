/**
 * Regression coverage for queue-status health classification.
 *
 * Issue #823 adds the shared queue-health classifier that lets queue-status
 * distinguish truly idle queues from healthy backlog, attention-needed stuck
 * work, and misconfigured lifecycle setup without collapsing everything into
 * "empty".
 * @module tests/unit/strategies/queue-health-classification
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  classifyQueueHealth,
  computeOverallQueueVerdict,
} from "../../../plugins/src/base/scripts/queue-health-classification.mjs";

describe("queue health classification (#823)", () => {
  it("treats unresolved queues as misconfigured instead of idle", () => {
    expect(
      classifyQueueHealth({
        queueResolved: false,
        resolutionError:
          "Unable to resolve the PRD queue from config for source=confluence.",
      })
    ).toMatchObject({
      verdict: "MISCONFIGURED",
      reasons: ["queue-unresolved"],
    });
  });

  it("treats missing lifecycle namespaces as misconfigured instead of empty", () => {
    expect(
      classifyQueueHealth({
        queueResolved: true,
        namespaceAdopted: false,
        readyCount: 0,
        activeCount: 0,
        blockedCount: 0,
        stalledCount: 0,
      })
    ).toMatchObject({
      verdict: "MISCONFIGURED",
      reasons: ["lifecycle-namespace-absent"],
    });
  });

  it("flags blocked or stalled work as attention-needed using repair semantics", () => {
    expect(
      classifyQueueHealth({
        queueResolved: true,
        namespaceAdopted: true,
        blockedCount: 1,
        stalledCount: 2,
      })
    ).toMatchObject({
      verdict: "ATTENTION_NEEDED",
      reasons: ["blocked-work-present", "stalled-work-present"],
      counts: {
        attentionNeeded: 3,
      },
    });
  });

  it("treats ready or active non-stuck work as healthy", () => {
    expect(
      classifyQueueHealth({
        queueResolved: true,
        namespaceAdopted: true,
        readyCount: 2,
      })
    ).toMatchObject({
      verdict: "HEALTHY",
      reasons: ["ready-work-present"],
    });

    expect(
      classifyQueueHealth({
        queueResolved: true,
        namespaceAdopted: true,
        activeCount: 1,
      })
    ).toMatchObject({
      verdict: "HEALTHY",
      reasons: ["active-work-in-flight"],
    });
  });

  it("treats quiet adopted queues as idle", () => {
    expect(
      classifyQueueHealth({
        queueResolved: true,
        namespaceAdopted: true,
      })
    ).toMatchObject({
      verdict: "IDLE",
      reasons: ["no-actionable-work"],
    });
  });

  it("uses the documented overall-verdict precedence", () => {
    expect(
      computeOverallQueueVerdict([{ verdict: "IDLE" }, { verdict: "HEALTHY" }])
    ).toBe("HEALTHY");

    expect(
      computeOverallQueueVerdict([
        { verdict: "HEALTHY" },
        { verdict: "ATTENTION_NEEDED" },
      ])
    ).toBe("ATTENTION_NEEDED");

    expect(
      computeOverallQueueVerdict([
        { verdict: "ATTENTION_NEEDED" },
        { verdict: "MISCONFIGURED" },
      ])
    ).toBe("MISCONFIGURED");
  });

  it("keeps the distributed classifier artifact in lockstep with the source script", () => {
    const sourcePath = path.resolve(
      "plugins/src/base/scripts/queue-health-classification.mjs"
    );
    const generatedPath = path.resolve(
      "plugins/lisa/scripts/queue-health-classification.mjs"
    );

    expect(existsSync(generatedPath)).toBe(true);
    expect(readFileSync(generatedPath, "utf8")).toBe(
      readFileSync(sourcePath, "utf8")
    );
  });
});
