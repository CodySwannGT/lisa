/**
 * Regression coverage for Atlassian acli profile matching.
 *
 * The skill is an executable operator contract, so this test guards the
 * switch-then-reverify behavior that prevents a wrong active acli profile from
 * silently skipping tier 1 or writing against the wrong tenant.
 * @module tests/unit/strategies/atlassian-access-acli-profile
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string): string =>
  readFileSync(
    path.resolve(root, "skills/lisa-atlassian-access/SKILL.md"),
    "utf8"
  );

describe("atlassian-access acli profile matching", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(root);

    it("switches a mismatched acli profile and re-verifies before use", () => {
      expect(skill).toMatch(
        /switchable to a profile matching the configured site/i
      );
      expect(skill).toMatch(
        /skipped only after switch plus re-verification fails/i
      );
      expect(skill).toMatch(
        /switched to the configured profile when one exists/i
      );
      expect(skill).toMatch(/current_site=\$\(acli auth status/);
      expect(skill).toMatch(/acli auth switch --site "\$SITE"/);
      expect(skill).toMatch(/current_site=\$\(acli auth status 2>\/dev\/null/);
      expect(skill).toMatch(/Do not trust the switch exit[\s\S]*status alone/i);
      expect(skill).toMatch(/Error: acli active site is/);
      expect(skill).not.toMatch(
        /substrates authenticated as a different Atlassian account are skipped, not used/
      );
    });
  });
});
