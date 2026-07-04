/**
 * Regression coverage for intake-explain ownership and repair readiness.
 *
 * Issue #847 requires the read-only diagnosis surface to distinguish
 * product-owned states, Lisa-owned states, and repair readiness using the same
 * intake/repair contracts operators already rely on.
 * @module tests/unit/strategies/intake-explain-ownership-and-repair
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain ownership and repair readiness (#847)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("classifies product-owned roles separately from Lisa-owned roles", () => {
      const skill = read(root, "skills/lisa-intake-explain/SKILL.md");

      expect(skill).toContain("## Ownership and repair readiness");
      expect(skill).toMatch(/Product-owned roles are roles/i);
      expect(skill).toMatch(/PRD `draft`/);
      expect(skill).toMatch(/PRD `shipped`/);
      expect(skill).toMatch(/PRD `verified`/);
      expect(skill).toMatch(/Lisa-owned roles are roles/i);
      expect(skill).toMatch(/PRD `ready`/);
      expect(skill).toMatch(/Build `ready`/);
      expect(skill).toMatch(/Build `blocked`/);
    });

    it("documents repair readiness gates for staleness, blockers, and backoff", () => {
      const skill = read(root, "skills/lisa-intake-explain/SKILL.md");

      expect(skill).toMatch(/Report repair readiness in this order/i);
      expect(skill).toMatch(/configured staleness threshold/i);
      expect(skill).toMatch(/WAITING_ON_STALENESS/);
      expect(skill).toMatch(/ELIGIBLE_FOR_REPAIR/);
      expect(skill).toMatch(/\[lisa-repair-intake\]/);
      expect(skill).toMatch(/fingerprint\/backoff window/i);
      expect(skill).toMatch(/repo-scope, leaf-only, and dependency checks/i);
    });
  });
});
