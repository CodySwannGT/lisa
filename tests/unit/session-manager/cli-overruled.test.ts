/**
 * The real CLI for overruled escalations (CodySwannGT/lisa#4657):
 * `overruled-plan` resolves the configured wrongly-escalated label and plans
 * captures, and `mark-plan --cause human-gate --item-label <label>` counts a
 * hold a human has labeled wrong as a planning miss. Both write nothing;
 * every external tool is a stub on a stub-only PATH.
 * @module tests/unit/session-manager/cli-overruled
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  writeJson,
} from "./support/cli-harness.js";
import { runStubOnly as run } from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const REPO = "example-org/demo-repo";
const REF = `${REPO}#12`;
const OTHER = `${REPO}#13`;
const DEFAULT_LABEL = "wrongly-escalated-to-human";
const CUSTOM = "ops:overruled";
const HUMAN_GATE = "human-gate";
const PLAN = "overruled-plan";

/**
 * A GitHub sandbox, optionally naming the wrongly-escalated label.
 * @param label - Configured label, or undefined for the default
 * @returns Sandbox
 */
function sandboxWith(label?: string) {
  return makeSandbox({
    extraConfig: {
      github: {
        org: "example-org",
        repo: "demo-repo",
        labels: {
          build: {
            ready: "status:ready",
            blocked: "status:blocked",
            human_needed: "human-needed",
            ...(label ? { wrongly_escalated: label } : {}),
          },
        },
      },
    },
  });
}

describe(PLAN, () => {
  it("uses the default label when none is configured", () => {
    const sandbox = sandboxWith();
    const input = path.join(sandbox.root, "items.json");
    writeJson(input, {
      items: [{ ref: REF, labels: [DEFAULT_LABEL], body: "", comments: [] }],
    });
    const result = run(sandbox, [PLAN, "--input", input]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      label: DEFAULT_LABEL,
      captures: [{ ref: REF, candidate: { signal: "wrongly-escalated" } }],
    });
    expect(result.calls).toEqual([]);
  });

  it("resolves github.labels.build.wrongly_escalated from config", () => {
    const sandbox = sandboxWith(CUSTOM);
    const result = run(sandbox, [PLAN], {
      input: JSON.stringify({
        items: [
          { ref: REF, labels: [DEFAULT_LABEL] },
          { ref: OTHER, labels: [CUSTOM] },
        ],
      }),
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      label: CUSTOM,
      captures: [{ ref: OTHER }],
    });
  });

  it("caps with --max and refuses a bad value", () => {
    const sandbox = sandboxWith();
    const items = [1, 2].map(n => ({
      ref: `${REPO}#${n}`,
      labels: [DEFAULT_LABEL],
    }));
    const capped = run(sandbox, [PLAN, "--max", "1"], {
      input: JSON.stringify({ items }),
    });
    expect(capped.json).toMatchObject({
      deferred: [`${REPO}#2`],
    });
    const bad = run(sandbox, [PLAN, "--max", "x"], {
      input: JSON.stringify({ items }),
    });
    expect(bad.status).toBe(2);
  });
});

describe("mark-plan with a wrongly-escalated item", () => {
  it("counts a human-gate hold the label overrules, at the filing stage", () => {
    const sandbox = sandboxWith();
    const result = run(
      sandbox,
      [
        "mark-plan",
        REF,
        "--kind",
        "decision",
        "--cause",
        HUMAN_GATE,
        "--item-label",
        "human-needed",
        "--item-label",
        DEFAULT_LABEL,
      ],
      { input: "Which dispatch order should the manager use?" }
    );
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      planningMiss: {
        counts: true,
        stageHint: "filing",
        candidate: { signal: "wrongly-escalated", triggering_issue: REF },
      },
    });
    // The marker it returns is the sweep's marker: once posted, the sweep
    // skips the item instead of capturing the same ruling twice.
    const marker = result.json.planningMiss.overruledMarker;
    expect(marker.comment).toContain(
      `[lisa-escalation-overruled] key=${marker.fingerprint}`
    );
    const sweep = run(sandbox, [PLAN], {
      input: JSON.stringify({
        items: [
          {
            ref: REF,
            labels: [DEFAULT_LABEL],
            comments: [{ body: marker.comment }],
          },
        ],
      }),
    });
    expect(sweep.json).toMatchObject({
      captures: [],
      skipped: [{ ref: REF, reason: "already captured" }],
    });
  });

  it("keeps a human-gate hold excluded without the label", () => {
    const sandbox = sandboxWith();
    const result = run(
      sandbox,
      ["mark-plan", REF, "--kind", "decision", "--cause", HUMAN_GATE],
      { input: "Which dispatch order should the manager use?" }
    );
    expect(result.json).toMatchObject({ planningMiss: { counts: false } });
  });
});
