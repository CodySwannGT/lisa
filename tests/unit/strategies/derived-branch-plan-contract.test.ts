/**
 * Structural coverage for the vendor-neutral `derived-branch-plan` rule.
 *
 * The rule's guidance prose, and the way the tracker writers, validators and
 * lisa-implement word their use of it, are reviewed rather than pinned. What
 * stays pinned is that the reference body is reachable from the eager rule
 * index in every plugin root, including cursor's flat `.mdc` layout.
 * @module tests/unit/strategies/derived-branch-plan-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RULE_ROOTS = [
  "plugins/src/base/rules",
  "plugins/lisa/rules",
  "plugins/lisa-cursor/rules",
  "plugins/lisa-copilot/rules",
] as const;

/** The rule slug. */
const SLUG = "derived-branch-plan";

/**
 * Read the always-on rule index from one plugin root, honoring cursor's flat
 * `.mdc` naming.
 * @param root - Plugin rules root
 * @returns Rule index contents
 */
const readIndex = (root: string): string =>
  root.includes("lisa-cursor")
    ? readFileSync(path.resolve(root, "00-rule-index.mdc"), "utf8")
    : readFileSync(path.resolve(root, "eager", "00-rule-index.md"), "utf8");

describe("derived-branch-plan rule contract", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    it("stays reachable from the eager rule index", () => {
      expect(readIndex(root)).toContain(`reference/${SLUG}.md`);
    });
  });
});
