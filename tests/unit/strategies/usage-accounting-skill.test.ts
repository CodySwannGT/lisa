/**
 * Regression tests for the shared usage-accounting skill surface.
 *
 * Issue #729 adds the vendor-neutral `usage-accounting` skill contract that
 * lifecycle flows and artifact writers must delegate through. The skill's
 * guidance prose is reviewed, not pinned; this suite proves the skill ships in
 * both plugin roots and that its generated OpenAI agent metadata stays aligned.
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

describe("usage-accounting skill contract", () => {
  describe.each(ROOTS)("%s/%s", root => {
    const skillPath = path.resolve(root, SKILL_SLUG, "SKILL.md");

    it("exists in this plugin root", () => {
      expect(existsSync(skillPath)).toBe(true);
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
