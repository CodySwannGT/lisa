/**
 * Regression coverage for issue #668: project-ideation must route host-code,
 * public comparison, and UI-facing recommendations through Lisa's existing
 * research and product-walkthrough practices before presenting build-ready
 * ideas.
 *
 * @module tests/unit/codex/project-ideation-research-walkthrough
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SKILL_FILES = [
  "plugins/src/base/skills/project-ideation/SKILL.md",
  "plugins/lisa/skills/project-ideation/SKILL.md",
] as const;

/**
 * Read a committed project-ideation skill file from the source or generated
 * plugin tree.
 * @param relativePath Repository-relative skill file path.
 * @returns Skill markdown contents.
 */
function readSkill(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), "utf8");
}

describe("codex/project-ideation-research-walkthrough (#668)", () => {
  it.each(SKILL_FILES)(
    "%s routes build-ready ideas through established research practices",
    skillFile => {
      const content = readSkill(skillFile);

      expect(content).toContain("Host-code inspection");
      expect(content).toContain("/lisa:codebase-research");
      expect(content).toContain("trace data flow");
      expect(content).toContain("Public, no-login comparison");
      expect(content).toContain("web/browser research");
      expect(content).toContain("preserve source URLs");
      expect(content).toContain("UI-facing recommendations");
      expect(content).toContain("/lisa:product-walkthrough");
      expect(content).toContain("only then list a UI idea as build-ready");
    }
  );
});
