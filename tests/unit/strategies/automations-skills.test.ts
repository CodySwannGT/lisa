/**
 * Structural coverage for /setup-automations.
 *
 * The skill's guidance prose is reviewed, not pinned. What stays pinned is its
 * `allowed-tools` frontmatter: registration scaffolds one checked-in runbook
 * per registered loop (#1796), so the skill must be allowed to write files.
 *
 * Both source and generated plugin roots are asserted.
 * @module tests/unit/strategies/automations-skills
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("setup-automations frontmatter", () => {
  describe.each(ROOTS)("%s/lisa-setup-automations", root => {
    const content = readSkill(root, "lisa-setup-automations");

    it("can author files (Write/Edit) so it can scaffold runbooks", () => {
      expect(content).toMatch(/allowed-tools:.*"Write"/);
      expect(content).toMatch(/allowed-tools:.*"Edit"/);
    });
  });
});
