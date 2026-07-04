/**
 * Smoke coverage for intake-explain verdict fixtures and read-only guarantees.
 *
 * Issue #852 requires representative PRD and build lifecycle fixtures so the
 * operator diagnosis contract keeps lifecycle, dependency, staleness, and
 * repair-backoff verdicts aligned with the write-side intake flows.
 * @module tests/unit/strategies/intake-explain-smoke-fixtures
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const SKILL_REL = "skills/lisa-intake-explain/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain smoke fixtures (#852)", () => {
  it("keeps source and generated intake-explain skill docs in lockstep", () => {
    const source = read("plugins/src/base", SKILL_REL);
    const generated = read("plugins/lisa", SKILL_REL);
    expect(generated).toBe(source);
  });

  describe.each(PLUGIN_ROOTS)("%s", root => {
    it("defines representative PRD fixtures for lifecycle, staleness, and backoff verdicts", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("## Smoke fixtures and read-only assertions");
      expect(skill).toContain("Minimum PRD smoke fixtures");
      expect(skill).toContain("prd-draft-product-owned");
      expect(skill).toContain("prd-ready-actionable");
      expect(skill).toContain("prd-in-review-fresh");
      expect(skill).toContain("prd-blocked-backoff");
      expect(skill).toContain("prd-blocked-new-signal");
      expect(skill).toMatch(/PRODUCT_OWNED_STATE/);
      expect(skill).toMatch(/ELIGIBLE_FOR_INTAKE/);
      expect(skill).toMatch(/WAITING_ON_STALENESS/);
      expect(skill).toMatch(/ELIGIBLE_FOR_REPAIR/);
      expect(skill).toMatch(/\[lisa-repair-intake\]/);
      expect(skill).toMatch(/backoff window/i);
    });

    it("defines representative build fixtures for dependency, leaf, staleness, and repair verdicts", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toContain("Minimum build smoke fixtures");
      expect(skill).toContain("build-ready-leaf");
      expect(skill).toContain("build-active-dependency");
      expect(skill).toContain("build-cleared-dependency");
      expect(skill).toContain("build-open-children");
      expect(skill).toContain("build-claimed-fresh");
      expect(skill).toContain("build-blocked-backoff");
      expect(skill).toContain("build-blocked-cleared");
      expect(skill).toMatch(/HELD_BY_BLOCKERS/);
      expect(skill).toMatch(/NON_LEAF_CONTAINER/);
      expect(skill).toMatch(/Blocked by:/);
      expect(skill).toMatch(/stale_after/);
      expect(skill).toMatch(/fingerprint changed/i);
    });

    it("requires smoke fixtures to prove diagnosis remains read-only", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(
        /Every smoke fixture must assert read-only behavior/i
      );
      expect(skill).toMatch(/must not call write APIs/i);
      expect(skill).toMatch(/gh issue edit/);
      expect(skill).toMatch(/gh issue comment/);
      expect(skill).toMatch(/label creation/);
      expect(skill).toMatch(/issue creation/);
      expect(skill).toMatch(/transition endpoints/);
      expect(skill).toMatch(/PR mutation/);
      expect(skill).toMatch(/tracker comment\/update calls/);
      expect(skill).toMatch(/only reports that action as the next step/i);
    });
  });
});
