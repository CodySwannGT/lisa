/**
 * Regression tests for the PRD verification dispatch (Phase 3g) that closes the
 * PRD loop: each of the four PRD-intake scanners, in addition to the closure
 * rollup (Phase 3f, `ticketed → shipped`), dispatches `/lisa:verify-prd` for one
 * shipped PRD per cycle so a shipped PRD does not sit unverified. The scanner
 * only DISPATCHES — `/lisa:verify-prd` (not the scanner) performs the
 * `shipped → verified` / `shipped → ticketed` transition, preserving the
 * "intake never sets verified" invariant.
 *
 * The dispatch is documented as the single source of truth in the
 * `prd-lifecycle-rollup` rule ("Closing the loop") and surfaced in the vendor-
 * neutral `intake` skill. Both source and generated plugin roots are asserted so
 * an artifact-only edit or a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/prd-intake-verify-dispatch
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
/** The acceptance-gate skill every scanner dispatches. */
const VERIFY = "lisa:verify-prd";
/** The Phase 3g heading text. */
const PHASE_3G = "3g. PRD verification dispatch";
/** The rule the dispatch cites as its single source of truth. */
const RULE_SLUG = "prd-lifecycle-rollup";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("PRD verification dispatch — Phase 3g closes the shipped loop", () => {
  const VENDORS = [
    "notion-prd-intake",
    "github-prd-intake",
    "linear-prd-intake",
    "confluence-prd-intake",
  ] as const;

  describe.each(VENDORS)("%s", vendor => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, vendor);

      it("defines a Phase 3g PRD verification dispatch", () => {
        expect(content).toContain(PHASE_3G);
      });

      it("dispatches lisa:verify-prd for shipped PRDs", () => {
        expect(content).toContain(VERIFY);
        expect(content).toMatch(/shipped/i);
      });

      it("dispatches but never performs the transition itself", () => {
        const idx = content.indexOf(PHASE_3G);
        expect(idx).toBeGreaterThan(-1);
        const section = content.slice(idx);
        expect(section).toMatch(/never performs the verification transition/i);
        expect(section).toMatch(/not this skill, sets/i);
      });

      it("verifies one shipped PRD per cycle (bounded like the ready claim)", () => {
        const section = content.slice(content.indexOf(PHASE_3G));
        expect(section).toMatch(/one shipped PRD per cycle/i);
      });

      it("on fail re-opens to ticketed with build-ready fix tickets — never blocked", () => {
        const section = content.slice(content.indexOf(PHASE_3G));
        expect(section).toMatch(/ticketed/);
        expect(section).toMatch(/never[^]*blocked/i);
        expect(section).toMatch(/build-ready/i);
      });

      it("cites the prd-lifecycle-rollup rule and stays aligned across all four", () => {
        const section = content.slice(content.indexOf(PHASE_3G));
        expect(section).toContain(RULE_SLUG);
        expect(section).toMatch(/behaviorally identical across all four/i);
      });
    });
  });
});

describe("prd-lifecycle-rollup documents the loop-closing dispatch", () => {
  const content = readFileSync(
    path.resolve("plugins/src/base/rules/reference/prd-lifecycle-rollup.md"),
    "utf8"
  );
  it("has a Closing the loop section dispatching verify-prd, one per cycle", () => {
    expect(content).toMatch(/Closing the loop/i);
    expect(content).toContain(VERIFY);
    expect(content).toMatch(/one shipped PRD per cycle/i);
    // Dispatch, not transition — the invariant is preserved at the rule level.
    expect(content).toMatch(/dispatch, not a transition|never \*?sets\*?/i);
  });

  it("documents the self-healing FAIL loop: re-open to ticketed, never blocked", () => {
    expect(content).toMatch(/self-healing/i);
    expect(content).toMatch(/shipped → ticketed/);
    expect(content).toMatch(/never[^]*blocked/i);
  });
});

describe("intake surfaces the PRD loop closure", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "intake");
    it("documents dispatching verify-prd for shipped PRDs in the cycle", () => {
      expect(content).toContain(VERIFY);
      expect(content).toMatch(/closing the (prd )?loop|close the loop/i);
      expect(content).toMatch(/shipped/i);
    });
  });
});
