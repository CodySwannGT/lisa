/**
 * How long an orphan may go without a tracker update before the sweep takes
 * it (CodySwannGT/lisa#4901). An in-progress item should never go two hours
 * without an update, so `sessionManager.stall.orphanHours` defaults to 2; a
 * project can set its own, and an explicit `--stale-hours` still wins.
 * @module tests/unit/session-manager/cli-orphans-stale-hours
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  writeJson,
} from "./support/cli-harness.js";
import { runStubOnly as run } from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const REF = "example-org/demo-repo#7";
const HOUR_MS = 3_600_000;

/**
 * A claimed orphan with no worker and no pull request, last updated three
 * hours ago.
 * @returns The envelope `orphan-plan` reads
 */
function quietForThreeHours() {
  return {
    complete: true,
    items: [
      {
        ref: REF,
        role: "claimed",
        labels: ["status:in-progress"],
        body: "",
        comments: [],
        assignees: [],
        updatedAt: new Date(Date.now() - 3 * HOUR_MS).toISOString(),
        pr: null,
      },
    ],
    holds: [],
  };
}

/**
 * A sandbox, optionally with `sessionManager.stall.orphanHours` set.
 * @param orphanHours - Threshold to configure, or none
 * @returns Sandbox
 */
function sandbox(orphanHours?: number) {
  const box = makeSandbox({
    extraConfig: { github: { org: "example-org", repo: "demo-repo" } },
  });
  if (orphanHours !== undefined) {
    const file = path.join(box.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.sessionManager.stall = { orphanHours };
    writeJson(file, config);
  }
  return box;
}

/**
 * Run `orphan-plan` on the three-hour orphan.
 * @param box - Sandbox
 * @param args - Extra flags
 * @returns Run result
 */
function plan(box: ReturnType<typeof makeSandbox>, args: string[] = []) {
  return run(box, ["orphan-plan", ...args], {
    input: JSON.stringify(quietForThreeHours()),
  });
}

describe("orphan-plan's stale threshold", () => {
  it("sweeps an item quiet for 3 hours under the 2-hour default", () => {
    const result = plan(sandbox());
    expect(result.status).toBe(0);
    expect(result.json.return).toEqual([expect.objectContaining({ ref: REF })]);
  });

  it("leaves it alone when the project sets stall.orphanHours to 4", () => {
    const result = plan(sandbox(4));
    expect(result.status).toBe(0);
    expect(result.json.return).toEqual([]);
    expect(result.json.skipped).toContainEqual({ ref: REF, reason: "fresh" });
  });

  it("lets an explicit --stale-hours win over the config", () => {
    const result = plan(sandbox(4), ["--stale-hours", "1"]);
    expect(result.json.return).toEqual([expect.objectContaining({ ref: REF })]);
  });
});
