/**
 * Structural coverage for the prd-backlink skill that carries native
 * PRD→top-level-work linking (#580, #581).
 *
 * The linking guidance prose is not pinned (#4867). This suite only guards
 * that the skill ships in both the source (`plugins/src/base/skills`) and the
 * generated artifact (`plugins/lisa/skills`).
 * @module tests/unit/strategies/prd-backlink-native-linking
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The skill's directory / slug. */
const SKILL_SLUG = "lisa-prd-backlink";

describe("prd-backlink native linking (#580, #581)", () => {
  describe.each(SKILL_ROOTS)("%s/prd-backlink/SKILL.md", root => {
    it("exists in this plugin root", () => {
      expect(existsSync(path.resolve(root, SKILL_SLUG, "SKILL.md"))).toBe(true);
    });
  });
});
