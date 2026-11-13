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
const SKILL_SLUG = "lisa-usage-accounting";
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

    it("requires callers to use the canonical usage-entry contract", () => {
      expect(content).toMatch(/stable `entry_id`/i);
    });

    it("returns structured surface and totals instead of prose-only output", () => {
      expect(content).toMatch(/entry_ids:/i);
    });

    it("forces the shared utility path instead of caller-specific renderers", () => {
      expect(content).toMatch(/parseLisaUsageSection/i);
      expect(content).toMatch(/mergeLisaUsageEntries/i);
      expect(content).toMatch(/createLisaUsageRollup/i);
      expect(content).toMatch(/upsertLisaUsageSection/i);
    });

    it("verifies writes by read-back and parse, never by the mutation result", () => {
      expect(content).toMatch(/verifyLisaUsageSectionIntegrity/);
    });

    it("refuses to leave a rollup naming entries the surface cannot resolve", () => {
      expect(content).toMatch(
        /never leave a rollup token behind whose `direct_entry_ids` names entries[\s\S]{0,120}cannot be parsed from the same surface/i
      );
    });
  });

  it("keeps the generated OpenAI agent metadata aligned with the skill surface", () => {
    expect(existsSync(OPENAI_AGENT_PATH)).toBe(true);
    const content = readFileSync(OPENAI_AGENT_PATH, "utf8");

    expect(content).toContain('display_name: "Usage Accounting"');
    expect(content).toContain(
      "short_description: \"Record token usage and refresh the canonical '## Lisa Usage' section"
    );
    expect(content).toContain(
      "\"Use $lisa-usage-accounting: Record token usage and refresh the canonical '## Lisa Usage' section"
    );
  });
});
