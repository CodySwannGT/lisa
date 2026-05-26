/**
 * Regression coverage for intake-explain operator guidance.
 *
 * Issue #844 hardens the human-readable diagnosis contract on top of the
 * scaffold: verdict semantics, rule explanations, and next-action guidance must
 * stay stable in both plugin roots as runtime implementation work lands later.
 * @module tests/unit/strategies/intake-explain-operator-docs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain operator docs (#844)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("documents read-only operator entrypoints in the command surface", () => {
      const command = read(root, "commands/intake-explain.md");

      expect(command).toContain("/lisa:intake-explain");
      expect(command).toMatch(/read-only/i);
      expect(command).toContain("/lisa:intake");
      expect(command).toContain("/lisa:repair-intake");
      expect(command).toContain("/lisa:queue-status");
    });

    it("documents verdict semantics, rule explanations, and next actions in the skill", () => {
      const skill = read(root, "skills/intake-explain/SKILL.md");

      expect(skill).toContain("## Operator usage");
      expect(skill).toContain("## Verdicts and next actions");
      expect(skill).toContain("## Rule explanation expectations");
      expect(skill).toContain("ELIGIBLE_FOR_INTAKE");
      expect(skill).toContain("ELIGIBLE_FOR_REPAIR");
      expect(skill).toContain("WAITING_ON_STALENESS");
      expect(skill).toContain("HELD_BY_BLOCKERS");
      expect(skill).toContain("NON_LEAF_CONTAINER");
      expect(skill).toContain("PRODUCT_OWNED_STATE");
      expect(skill).toContain("MISCONFIGURED");
      expect(skill).toMatch(/leaf-only/i);
      expect(skill).toMatch(/repo-scope/i);
      expect(skill).toMatch(/staleness|freshness/i);
      expect(skill).toMatch(/manual product clarification/i);
      expect(skill).toContain("/lisa:intake");
      expect(skill).toContain("/lisa:repair-intake");
    });

    it("shows a stable diagnosis rendering pattern with signals", () => {
      const skill = read(root, "skills/intake-explain/SKILL.md");

      expect(skill).toMatch(/One acceptable rendering pattern/i);
      expect(skill).toMatch(/Item: CodySwannGT\/lisa#123/);
      expect(skill).toMatch(/Lifecycle: BUILD/);
      expect(skill).toMatch(/Role: status:blocked/);
      expect(skill).toMatch(/Verdict: ELIGIBLE_FOR_REPAIR/);
      expect(skill).toMatch(/Why:/);
      expect(skill).toMatch(/Next action: \/lisa:repair-intake github/);
      expect(skill).toMatch(/Signals:/);
    });
  });
});
