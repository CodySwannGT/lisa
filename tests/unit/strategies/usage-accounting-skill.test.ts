/**
 * Regression tests for the shared usage-accounting skill surface.
 *
 * Issue #729 adds the vendor-neutral `usage-accounting` skill contract that
 * lifecycle flows and artifact writers must delegate through. The skill owns
 * the three supported operations, the body-first with comment-fallback write
 * policy, and the structured response contract so later integrations do not
 * invent ad hoc usage-write behavior.
 * @module tests/unit/strategies/usage-accounting-skill
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const SKILL_SLUG = "usage-accounting";
const OPENAI_AGENT_PATH = path.resolve(
  "plugins/lisa/skills",
  SKILL_SLUG,
  "agents",
  "openai.yaml"
);

const readSkill = (root: string): string =>
  readFileSync(path.resolve(root, SKILL_SLUG, "SKILL.md"), "utf8");

describe("usage-accounting skill contract", () => {
  describe.each(ROOTS)("%s/%s", root => {
    const skillPath = path.resolve(root, SKILL_SLUG, "SKILL.md");

    it("exists in this plugin root", () => {
      expect(existsSync(skillPath)).toBe(true);
    });

    const content = readSkill(root);

    it("defines the required record, rollup, and record_and_rollup operations", () => {
      expect(content).toMatch(/operation:\s*record\b/i);
      expect(content).toMatch(/operation:\s*rollup\b/i);
      expect(content).toMatch(/operation:\s*record_and_rollup\b/i);
      expect(content).toMatch(/upsert exactly one direct usage entry/i);
      expect(content).toMatch(/recompute the rollup token/i);
    });

    it("requires callers to use the canonical usage-entry contract", () => {
      expect(content).toMatch(/stable `entry_id`/i);
      expect(content).toMatch(/source: unavailable/i);
      expect(content).toMatch(/nullable token\/cost\s+fields/i);
      expect(content).toMatch(/usage-accounting` rule/i);
    });

    it("documents the body-first with managed-comment fallback policy", () => {
      expect(content).toMatch(/body first/i);
      expect(content).toMatch(/fall back to a \*\*single managed comment\*\*/i);
      expect(content).toMatch(/comment-only/i);
      expect(content).toMatch(/comment-fallback/i);
    });

    it("returns structured surface and totals instead of prose-only output", () => {
      expect(content).toMatch(/surface:/i);
      expect(content).toMatch(/entry_ids:/i);
      expect(content).toMatch(/rollup:/i);
      expect(content).toMatch(
        /outcome:\s*updated \| comment-fallback \| no-op \| blocked/i
      );
    });

    it("forces the shared utility path instead of caller-specific renderers", () => {
      expect(content).toMatch(/parseLisaUsageSection/i);
      expect(content).toMatch(/mergeLisaUsageEntries/i);
      expect(content).toMatch(/createLisaUsageRollup/i);
      expect(content).toMatch(/upsertLisaUsageSection/i);
    });
  });

  it("keeps the generated OpenAI agent metadata aligned with the skill surface", () => {
    expect(existsSync(OPENAI_AGENT_PATH)).toBe(true);
    const content = readFileSync(OPENAI_AGENT_PATH, "utf8");

    expect(content).toContain('display_name: "Usage Accounting"');
    expect(content).toContain(
      'short_description: "Shared usage-ledger utility for Lisa lifecycle flows and artifact writers"'
    );
    expect(content).toContain(
      '"Use $usage-accounting: Shared usage-ledger utility for Lisa lifecycle flows and artifact writers."'
    );
  });
});
