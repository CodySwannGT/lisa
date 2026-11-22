/**
 * Structural coverage for the GitHub PRD-intake skill that carries the PRD
 * shipped rollup phase (#583).
 *
 * The rollup phase's guidance prose is not pinned (#4867). This suite only
 * guards that the skill ships in both the source (`plugins/src/base/skills`)
 * and the generated artifact (`plugins/lisa/skills`).
 * @module tests/unit/strategies/github-prd-intake-rollup
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The skill's directory / slug. */
const SKILL_SLUG = "lisa-github-prd-intake";

describe("github-prd-intake PRD shipped rollup phase (#583)", () => {
  describe.each(SKILL_ROOTS)("%s/github-prd-intake/SKILL.md", root => {
    it("exists in this plugin root", () => {
      expect(existsSync(path.resolve(root, SKILL_SLUG, "SKILL.md"))).toBe(true);
    });
  });
});
