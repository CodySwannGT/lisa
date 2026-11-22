/**
 * Structural coverage for the Linear, Confluence, and Notion PRD-intake skills
 * that carry the PRD shipped rollup phase (#584).
 *
 * The rollup phase's guidance prose is not pinned (#4867). This suite only
 * guards that each skill ships in both the source (`plugins/src/base/skills`)
 * and the generated artifact (`plugins/lisa/skills`).
 * @module tests/unit/strategies/prd-intake-rollup-vendors
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const VENDOR_SLUGS = [
  "lisa-linear-prd-intake",
  "lisa-confluence-prd-intake",
  "lisa-notion-prd-intake",
] as const;

describe("PRD shipped rollup propagated to Linear/Confluence/Notion intake (#584)", () => {
  describe.each(VENDOR_SLUGS)("%s", slug => {
    describe.each(SKILL_ROOTS)(`%s/${slug}/SKILL.md`, root => {
      it("exists in this plugin root", () => {
        expect(existsSync(path.resolve(root, slug, "SKILL.md"))).toBe(true);
      });
    });
  });
});
