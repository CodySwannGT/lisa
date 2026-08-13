/**
 * Regression tests for issues #1397 and #1578: every plugin artifact fanout
 * generator and every learnings-budget input must trigger the Plugins Sync
 * workflow.
 *
 * Both issues were originally fixed by enumerating those inputs in a `paths:`
 * filter, and these tests asserted each enumerated line. #2485 removed the
 * filter entirely, which is a STRICTLY STRONGER guarantee — the workflow now
 * runs on every pull request, so no input can fail to trigger it and no future
 * generator can be forgotten from a list. The filter had to go because
 * `🧩 Plugin artifacts match source` became a required status check, and a
 * workflow filtered out by `paths` never reports its context at all, leaving
 * the pull request waiting on a status that never arrives.
 *
 * These tests are therefore rewritten, not deleted: they now pin the absence of
 * the filter, which is what makes the original guarantee hold.
 * @module tests/unit/scripts/plugin-sync-workflow
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = path.join(".github", "workflows", "plugins-sync.yml");

/** Inputs #1397 required to trigger the fanout parity check. */
const FANOUT_TRIGGER_PATHS = [
  "plugins/**",
  ".claude-plugin/marketplace.json",
  "scripts/build-plugins.sh",
  "scripts/generate-agy-plugin-artifacts.mjs",
  "scripts/generate-codex-plugin-artifacts.mjs",
  "scripts/generate-copilot-plugin-artifacts.mjs",
  "scripts/generate-cursor-plugin-artifacts.mjs",
  "scripts/lib/**",
  "scripts/internal-*-skill-policy.json",
  "scripts/internal-copilot-runtime-probe.json",
  "scripts/check-plugins-sync.sh",
  "scripts/check-rules-pairing.sh",
  ".github/workflows/plugins-sync.yml",
] as const;

/** Inputs #1578 required to trigger the learnings-budget gate. */
const LEARNINGS_BUDGET_TRIGGER_PATHS = [
  "scripts/check-learnings-budget.ts",
  "all/create-only/.lisa/PROJECT_LEARNINGS.md",
  "src/core/**",
  "scripts/clean-dist.mjs",
  "tsconfig.json",
  "tsconfig.local.json",
  "tsconfig/**",
  "bun.lock",
  "package.json",
] as const;

describe("Plugins Sync workflow triggers (#1397, #1578, #2485)", () => {
  it("carries no pull_request path filter, so every input triggers it", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toMatch(
      /^on:\n {2}pull_request:\n {2}workflow_dispatch:$/mu
    );
    for (const triggerPath of [
      ...FANOUT_TRIGGER_PATHS,
      ...LEARNINGS_BUDGET_TRIGGER_PATHS,
    ]) {
      expect(workflow).not.toContain(`      - '${triggerPath}'`);
    }
  });

  it("explains why the filter must not come back", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("DO NOT ADD A `paths:` FILTER");
  });

  it("invokes the required learnings-budget package command", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("run: bun run check:learnings-budget");
  });

  it("invokes the fanout parity and rules-pairing checks", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("run: bun run check:plugins");
    expect(workflow).toContain("run: bun run check:rules-pairing");
  });
});
