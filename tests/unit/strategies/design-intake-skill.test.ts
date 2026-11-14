/**
 * Contract coverage for `lisa-design-intake` and its `/lisa:design:intake`
 * command — the judgment rung of the design-handoff policy.
 *
 * The executable half is pinned by `design-intake-gate.test.ts`. The skill's
 * guidance prose is not pinned here (#4867); what remains is structural: the
 * frontmatter, the command's argument pass-through, and a guard that no
 * person's name or handle appears. This repository is public and its build
 * output ships to a package registry, so an escalation target written as a
 * person instead of a config key is published twice over.
 * @module tests/unit/strategies/design-intake-skill
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("lisa-design-intake skill contract", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root, "skills/lisa-design-intake/SKILL.md");
    const command = read(root, "commands/design/intake.md");

    it("ships with a substantial body and a description", () => {
      expect(skill.length).toBeGreaterThan(2000);
      expect(skill).toMatch(/^---\nname: lisa-design-intake\n/u);
      expect(skill).toContain("description:");
    });

    it("surfaces as /lisa:design:intake with an argument hint", () => {
      expect(command).toContain("argument-hint:");
      expect(command).toContain("$ARGUMENTS");
    });

    it("names no person or handle in either artifact", () => {
      for (const body of [skill, command]) {
        expect(body).not.toMatch(/@[a-z0-9][a-z0-9-]{2,}\b/iu);
        expect(body).not.toMatch(/assignee\s*[:=]\s*["'][a-z][^"']*["']/iu);
      }
    });
  });
});
