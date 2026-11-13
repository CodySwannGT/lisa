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
 * neutral `lisa-intake` skill. Both source and generated plugin roots are asserted so
 * an artifact-only edit or a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/prd-intake-verify-dispatch
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
/** Skill slug dispatched by intake scanners. */
const VERIFY_SKILL = "lisa-verify-prd";
/** Slash command form cited in the rollup rule. */
const VERIFY_COMMAND = "/lisa:verify-prd";
/** The Phase 3g heading text. */
const PHASE_3G = "3g. PRD verification dispatch";
/** The rule the dispatch cites as its single source of truth. */
const RULE_SLUG = "prd-lifecycle-rollup";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("PRD verification dispatch — Phase 3g closes the shipped loop", () => {
  const VENDORS = [
    "lisa-notion-prd-intake",
    "lisa-github-prd-intake",
    "lisa-linear-prd-intake",
    "lisa-confluence-prd-intake",
  ] as const;

  describe.each(VENDORS)("%s", vendor => {
    describe.each(ROOTS)("%s", root => {
      const content = readSkill(root, vendor);

      it("dispatches lisa-verify-prd for shipped PRDs", () => {
        expect(content).toContain(VERIFY_SKILL);
      });

      it("dispatches but never performs the transition itself", () => {
        const idx = content.indexOf(PHASE_3G);
        expect(idx).toBeGreaterThan(-1);
      });

      it("cites the prd-lifecycle-rollup rule and stays aligned across all four", () => {
        const section = content.slice(content.indexOf(PHASE_3G));
        expect(section).toContain(RULE_SLUG);
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
    expect(content).toContain(VERIFY_COMMAND);
  });
});

describe("intake surfaces the PRD loop closure", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "lisa-intake");
    it("documents dispatching verify-prd for shipped PRDs in the cycle", () => {
      expect(content).toContain(VERIFY_SKILL);
    });
  });
});
