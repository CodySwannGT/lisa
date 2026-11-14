/**
 * Contract coverage for the vendor-neutral `design-value-binding` rule — the
 * eager-rule rung of the design-handoff policy.
 *
 * The rule's guidance prose is reviewed, not pinned. Two checks stay. The rule
 * must remain reachable from the eager rule index. And the rule must name no
 * person anywhere, which is asserted rather than trusted: this repository is
 * public and its build output ships to a package registry, so an escalation
 * target written as a name instead of a config key is published twice over.
 * Rewording the rule cannot fail either check.
 * @module tests/unit/strategies/design-value-binding-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("design-value-binding rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const body = read(root, "rules/reference/design-value-binding.md");

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/design-value-binding.md"
      );
    });

    it("names no person anywhere — the escalation target is a config key", () => {
      // An `@handle`, or an assignee written as a literal value rather than
      // as the config key that supplies one.
      expect(body).not.toMatch(/@[a-z0-9][a-z0-9-]{2,}\b/iu);
      expect(body).not.toMatch(/assignee\s*[:=]\s*["'][^"']+["']/iu);
    });
  });
});
