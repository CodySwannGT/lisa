/**
 * Regression coverage for intake-explain PRD role and repair diagnosis.
 *
 * Issue #850 requires the read-only diagnosis surface to evaluate PRD items
 * with the same role ownership, staleness, generated-work rollup, and
 * repair-backoff semantics used by PRD intake and repair-intake.
 * @module tests/unit/strategies/intake-explain-prd-gates
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const SKILL_REL = "skills/lisa-intake-explain/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain PRD role and repair diagnosis (#850)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("documents PRD reader signals for roles, freshness, answers, and rollup", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("## PRD item role and repair diagnosis");
      expect(skill).toMatch(/github\.labels\.prd\.\*/);
      expect(skill).toMatch(/linear\.labels\.prd\.\*/);
      expect(skill).toMatch(/notion\.values\.\*/);
      expect(skill).toMatch(/confluence\.parents\.\*/);
      expect(skill).toMatch(/provider-native timestamps/i);
      expect(skill).toMatch(/latest PRD comments/i);
      expect(skill).toMatch(/\[lisa-repair-intake\]/);
      expect(skill).toMatch(/state fingerprint/i);
      expect(skill).toMatch(/generated top-level work/i);
      expect(skill).toMatch(/clarifying-answer signals/i);
    });

    it("maps PRD lifecycle roles to intake, repair, and product-owned verdicts", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/PRD in `draft` returns `PRODUCT_OWNED_STATE`/);
      expect(skill).toMatch(/PRD in `shipped` returns `PRODUCT_OWNED_STATE`/);
      expect(skill).toMatch(/PRD in `verified` returns `PRODUCT_OWNED_STATE`/);
      expect(skill).toMatch(
        /PRD in the configured `ready` role returns `ELIGIBLE_FOR_INTAKE`/
      );
      expect(skill).toMatch(/PRD in `in_review` is already Lisa-owned/);
      expect(skill).toMatch(/stale_after/);
      expect(skill).toMatch(/then the 2h default/);
      expect(skill).toMatch(/stale_after=2h/);
      expect(skill).not.toMatch(/then the 24h default/);
      expect(skill).not.toMatch(/stale_after=24h/);
      expect(skill).toMatch(/WAITING_ON_STALENESS/);
      expect(skill).toMatch(/ELIGIBLE_FOR_REPAIR/);
      expect(skill).toMatch(/PRD in `blocked` is Lisa-owned/);
      expect(skill).toMatch(/HELD_BY_BLOCKERS/);
      expect(skill).toMatch(/PRD in `ticketed` is not ready for first intake/);
    });

    it("explains repair backoff suppression without mutating PRDs", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/read-only explanation/i);
      expect(skill).toMatch(/does not mutate the PRD/i);
      expect(skill).toMatch(
        /should not imply automatic recovery from unknown freshness/i
      );
      expect(skill).toMatch(/repair-intake would suppress an unchanged retry/i);
      expect(skill).toMatch(/backoff window has not expired/i);
      expect(skill).toMatch(/fingerprint changed/i);
      expect(skill).toMatch(/force=true/);
      expect(skill).toMatch(/backoff until 2026-05-27T12:00:00Z/);
    });
  });
});
