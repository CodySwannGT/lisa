/**
 * Regression tests for issue #1397: every plugin artifact fanout generator and
 * its shared inputs must trigger the Plugins Sync workflow.
 * @module tests/unit/scripts/plugin-sync-workflow
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW_PATH = path.join(".github", "workflows", "plugins-sync.yml");

const REQUIRED_TRIGGER_PATHS = [
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

const LEARNINGS_BUDGET_TRIGGER_PATHS = [
  "scripts/check-learnings-budget.ts",
  "all/create-only/.claude/rules/PROJECT_LEARNINGS.md",
  "src/core/**",
  "scripts/clean-dist.mjs",
  "tsconfig.json",
  "tsconfig.local.json",
  "tsconfig/**",
  "bun.lock",
  "package.json",
] as const;

describe("Plugins Sync workflow triggers (#1397)", () => {
  it("runs when any plugin fanout generator or shared input changes", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    for (const triggerPath of REQUIRED_TRIGGER_PATHS) {
      expect(workflow).toContain(`      - '${triggerPath}'`);
    }
  });
});

describe("Plugins Sync learnings-budget gate (#1578)", () => {
  it("runs when any checker source, build input, or canonical seed changes", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    for (const triggerPath of LEARNINGS_BUDGET_TRIGGER_PATHS) {
      expect(workflow).toContain(`      - '${triggerPath}'`);
    }
  });

  it("invokes the required learnings-budget package command", () => {
    const workflow = fs.readFileSync(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("run: bun run check:learnings-budget");
  });
});
