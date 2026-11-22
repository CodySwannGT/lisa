/**
 * Regression test for the vendor-neutral PRD lifecycle rollup rule.
 *
 * Issue #579 added `plugins/src/base/rules/reference/prd-lifecycle-rollup.md`,
 * the single source of truth for how a PRD rolls up to `shipped` from its
 * generated top-level work. Sibling skills cite it by slug, so the rule file
 * must exist in both the source tree and the generated Claude plugin. Its prose
 * is guidance and is reviewed, not pinned (#4867).
 * @module tests/unit/strategies/prd-lifecycle-rollup
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const RULE_ROOTS = [
  "plugins/src/base/rules/reference",
  "plugins/lisa/rules/reference",
] as const;

/** The rule's slug / filename stem. */
const RULE_SLUG = "prd-lifecycle-rollup";

describe("prd-lifecycle-rollup rule (#579)", () => {
  describe.each(RULE_ROOTS)("%s/prd-lifecycle-rollup", root => {
    it("exists in this plugin root", () => {
      expect(existsSync(path.resolve(root, `${RULE_SLUG}.md`))).toBe(true);
    });
  });
});
