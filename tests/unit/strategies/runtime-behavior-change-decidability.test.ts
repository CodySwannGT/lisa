/**
 * Contract coverage for the persistence and derivation of
 * `runtime_behavior_change` — the flag gates S8, S11, S14, and S19 all branch on.
 *
 * The defect these assertions exist to prevent is decidability, not strictness.
 * The flag began life as a caller-asserted validator input that no writer ever
 * persisted, while the live-item path promised to "parse the body sections,
 * derive the spec fields". It could not be derived, so on re-validation the gate
 * believed whatever the caller claimed about the very item it was checking:
 * `lisa-*-verify` could not produce a truthful verdict, and neither could a
 * human auditor reading the item.
 *
 * Absence could not stand in for it, because absence is what both opposite cases
 * look like — an item with no `Target Backend Environment` is either correctly
 * exempt or wrongly missing a required section.
 *
 * So the four properties pinned here are the ones that would quietly restore the
 * old hole:
 *
 *   1. The section is rendered on every leaf, exempt work included — the writers
 *      must never go back to "skip it for doc-only".
 *   2. The exemption is a positive `None —` declaration, not an omission.
 *   3. An absent section derives as UNDERIVABLE, never as `false`. This is the
 *      single assertion that matters most: reading absence as `false` is exactly
 *      the assumption that made the gates unauditable, and it is the most
 *      natural-looking simplification for a later editor to make.
 *   4. On a live item the persisted declaration beats a caller's assertion.
 *
 * Every assertion runs against all six generated skill roots, because the
 * generated artifacts are what agents actually load.
 *
 * **Scope, and where the other half lives.** Every assertion in this file is
 * existential — "some copy of the contract says the right thing" — which pins
 * the wording against silent deletion and nothing more. That is not enough on
 * its own: these documents state the grammar twice, in gate S8 and again in
 * the execution step, so a correct copy can vouch for a broken one. The
 * universal half — "no copy says the wrong thing" — lives in
 * `runtime-behavior-change-consistency.test.ts`, and the shared corpus both
 * files read lives in `runtime-behavior-change-sources.ts`. The three-way
 * split is the 300-line lint ceiling, not a scope boundary; a coverage probe
 * that scores by filename must read all three.
 * @module tests/unit/strategies/runtime-behavior-change-decidability
 */
import { describe, expect, it } from "vitest";

import {
  EXEMPT_PREFIX,
  FLAG,
  RULE_ROOTS,
  SECTION,
  SKILL_ROOTS,
  SLUG,
  VALIDATORS,
  WRITERS,
  readRule,
  readSkill,
} from "./runtime-behavior-change-sources.js";

describe("the rule persists the behavioral flag instead of asserting it", () => {
  describe.each(RULE_ROOTS)("%s", root => {
    it("names the declaration grammar in the reference tier", () => {
      const content = readRule(root, "reference");

      expect(content).toContain(EXEMPT_PREFIX);
      expect(content).toMatch(/no runtime behavior change: ?doc-only/i);
      expect(content).toMatch(/container: state rolls up from children/i);
    });

    it("declares the exemption rather than inferring it from absence", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(/declared, never inferred from (?:an? )?absen/i);
    });

    it("treats an absent section as underivable, never as false", () => {
      // #3992: one copy per root now — the head folded into the body.
      for (const tier of ["reference"] as const) {
        const content = readRule(root, tier);

        expect(content).toMatch(/underivable/i);
        expect(content).toMatch(/never (?:read as |be )?`?false`?/i);
      }
    });

    it("keeps the marker visible prose, for the ADF reason", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(/visible prose rather than an HTML comment/i);
      expect(content).toMatch(/ADF has no comment node/i);
    });

    it("makes the persisted value beat a caller assertion", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(
        /persisted beats asserted|stored declaration is authoritative/i
      );
    });

    it("does not weaken S19 for single-environment projects", () => {
      const content = readRule(root, "reference");

      expect(content).toMatch(/single-environment/i);
      expect(content).toMatch(
        /impossible to \*?audit\*?|never hard to satisfy/i
      );
    });
  });
});

describe("writers persist the flag on every leaf", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(WRITERS)("%s always renders the section", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(SECTION);
      expect(content).toMatch(/ALWAYS render this section/);
      expect(content).toContain(SLUG);
    });

    it.each(WRITERS)("%s renders a declaration for exempt work", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(EXEMPT_PREFIX);
      expect(content).toMatch(/no runtime behavior change:/i);
      expect(content).toMatch(/container: state rolls up from children/i);
    });

    it.each(WRITERS)("%s no longer skips the section for doc-only", slug => {
      const content = readSkill(root, slug);

      expect(content).not.toMatch(
        /Skip only for doc\/config\/type-only (?:issues|tickets|items)\./
      );
    });
  });
});

describe("validators derive the flag from the live item", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it.each(VALIDATORS)("%s derives the flag rather than taking it", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        new RegExp(`${FLAG}[^\\n]*(?:derived|DERIVED|from the)`)
      );
      expect(content).toMatch(
        /authoritative over any caller assertion|stored declaration is authoritative/i
      );
    });

    it.each(VALIDATORS)("%s records the three-state derivation", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(EXEMPT_PREFIX);
      // Assert the WRONG spelling is absent, rather than that the right one is
      // present. Two mutation runs were needed to get this right, and both
      // failures are the same mistake in different clothes: `toContain` passes
      // on any one correct occurrence, and so does a regex for the correct
      // sentence — this file states the grammar twice, in S8 and in the
      // execution step, so the correct S8 copy vouched for a broken execution
      // step both times. A validator whose execution step spells the marker
      // differently from its own grammar reads a correctly-exempt item as
      // underivable, which is precisely the bug this suite exists to prevent.
      expect(content).not.toContain("`None -`");
      expect(content).toMatch(
        /absent section (?:means|→) \*\*underivable\*\*|absent section → \*\*underivable\*\*/i
      );
      expect(content).toMatch(/never `false`/);
    });

    it.each(VALIDATORS)("%s fails a contradicting caller assertion", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        /caller asserting a `runtime_behavior_change` that contradicts it \*\*FAILs\*\*/
      );
      expect(content).toMatch(/rather than silently preferring either/i);
    });

    it.each(VALIDATORS)("%s keeps proposed-vs-legacy asymmetric", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        /A \*\*proposed spec\*\* with no section \*\*FAILs\*\*/
      );
      expect(content).toMatch(
        /live legacy [^\n]*with no section is `N\/A` with a repair note/i
      );
    });

    it.each(VALIDATORS)("%s gives S11 and S14 an underivable arm", slug => {
      const content = readSkill(root, slug);

      expect(content).toMatch(
        /this gate is `N\/A` with the same repair note rather than `PASS`/
      );
      expect(content).toMatch(
        /likewise `N\/A` with a repair note when `runtime_behavior_change` is \*\*underivable\*\*/
      );
    });

    it.each(VALIDATORS)("%s gives S19 an underivable row", slug => {
      const content = readSkill(root, slug);

      expect(content).toContain(
        "| `runtime_behavior_change` **underivable** (live legacy item, no Target Backend Environment declaration) | `N/A` with a repair note — absence is never read as `false` |"
      );
    });
  });
});

describe("lisa-implement reads the persisted declaration at claim time", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    it("derives the flag off the item instead of assuming it", () => {
      const content = readSkill(root, "lisa-implement");

      expect(content).toMatch(
        /Read the flag off the item rather than assuming it/i
      );
      expect(content).toContain(EXEMPT_PREFIX);
      expect(content).toMatch(
        /absent\*?\*? section is \*?underivable\*?, not exempt/i
      );
      expect(content).toMatch(/Never read absence as `false`/);
    });
  });
});
