/**
 * `mark-plan --cause` and the planning-miss verdict on the CLI
 * (CodySwannGT/lisa#4569).
 *
 * The manager reads `planningMiss` from `mark-plan` to decide whether to
 * route a planning-miss candidate through `lisa-persist-learning`. Run as a
 * real process against the stub harness with a stub-only PATH, so no real
 * `gh`, `bws` or `claude` can be reached.
 * @module tests/unit/session-manager/cli-human-planning-miss
 */
import { afterEach, describe, expect, it } from "vitest";

import { removeSandboxes } from "./support/cli-harness.js";
import {
  githubSandbox,
  QUESTION,
  REF,
  runStubOnly,
  WORKER_QUESTION,
} from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const MARK_PLAN = "mark-plan";
const KIND = "--kind";
const CAUSE = "--cause";

describe("mark-plan planningMiss", () => {
  it("counts a worker's question and hands back the candidate skeleton", () => {
    const result = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, WORKER_QUESTION],
      { input: QUESTION }
    );
    expect(result.status).toBe(0);
    expect(result.json.planningMiss).toMatchObject({
      counts: true,
      stageHint: "ready-gate",
      candidate: {
        signal: "planning-miss",
        triggering_issue: REF,
        missing: QUESTION,
      },
    });
  });

  it("does not count an exhausted item", () => {
    const result = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, "exhausted"],
      { input: "Three attempts stalled with no output." }
    );
    expect(result.status).toBe(0);
    expect(result.json.planningMiss.counts).toBe(false);
  });

  it.each(["environment", "human-gate"])(
    "does not count a stop whose --cause is %s",
    cause => {
      const result = runStubOnly(
        githubSandbox(),
        [MARK_PLAN, REF, KIND, "decision", CAUSE, cause],
        { input: QUESTION }
      );
      expect(result.status).toBe(0);
      expect(result.json.planningMiss.counts).toBe(false);
      expect(result.json.planningMiss).not.toHaveProperty("candidate");
    }
  );

  it("exits 2 for an unknown cause and writes nothing", () => {
    const result = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, WORKER_QUESTION, CAUSE, "outage"],
      { input: QUESTION }
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--cause must be one of");
  });
});
