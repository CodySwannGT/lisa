/**
 * Contract coverage for the vendor-neutral convergent-review rule pair.
 *
 * `convergent-review` is the single findings format every review surface across
 * every supported agent already cites. RRR-2 (#1854) extends it additively with
 * the two fields the readiness rubric needs that no existing field covers —
 * `invariant_violated` (the property at risk) and `machinery_to_remove` (the
 * scaffolding the correction makes deletable) — plus consequence ordering, so
 * the repo never grows a second findings format. These assertions pin the five
 * fields the contract already shipped (they must not regress), the two new
 * fields in both halves, the PRD-field mapping table, the required-for-readiness
 * / recommended-elsewhere compatibility statement, and the consequence-ordering
 * rule together with its explicit carve-out that report *section* order stays
 * stable. Both plugin roots are checked so the generated copy can never drift
 * from the source.
 * @module tests/unit/strategies/convergent-review-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The finding fields the contract shipped before #1854 — never regress these. */
const EXISTING_FIELDS = [
  "Severity",
  "Blocking",
  "Failure scenario",
  "Evidence",
  "Fix",
] as const;

/** The two net-new fields RRR-2 folds into the shared finding shape. */
const NEW_FIELDS = ["invariant_violated", "machinery_to_remove"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * Collapse all whitespace so assertions survive reflowed markdown prose.
 * @param text - the raw markdown document to normalize
 * @returns the same text with every whitespace run collapsed to one space
 */
const squash = (text: string): string => text.replace(/\s+/g, " ");

describe("convergent-review rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/convergent-review.md");
    const reference = read(root, "rules/reference/convergent-review.md");
    const eagerFlat = squash(eager);
    const referenceFlat = squash(reference);

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("keeps the four shipped sections of the contract intact", () => {
      for (const heading of [
        "## Severity Bar",
        "## Required Finding Shape",
        "## Dispositions",
        "## Stopping Rule",
      ]) {
        expect(reference).toContain(heading);
      }
      for (const disposition of ["`fixed`", "`deferred`", "`pushed-back`"]) {
        expect(reference).toContain(disposition);
      }
    });

    it("still requires the five finding fields it shipped with", () => {
      for (const field of EXISTING_FIELDS) {
        expect(reference).toContain(`- ${field}:`);
      }
      expect(eagerFlat).toMatch(
        /severity, blocking yes\/no, a concrete failure scenario, evidence/i
      );
      expect(eagerFlat).toMatch(/smallest actionable fix/i);
      // The malformed-blocking-finding rule is unchanged.
      expect(referenceFlat).toMatch(/malformed by contract/i);
    });

    it("carries the two net-new fields in both halves", () => {
      for (const field of NEW_FIELDS) {
        expect(reference).toContain(field);
        expect(eager).toContain(field);
      }
      // The invariant is the property at risk, distinct from the outcome the
      // existing failure-scenario field already states.
      expect(referenceFlat).toMatch(/property.*system/i);
      expect(referenceFlat).toMatch(/failure scenario is the outcome/i);
      // machinery-to-remove is surfaced, never auto-deleted, and may be "none".
      expect(referenceFlat).toMatch(/`none`/);
      expect(referenceFlat).toMatch(/never auto.deleted|surfaced.*never/i);
      expect(reference).toContain("scaffolding-subtraction");
    });

    it("maps the readiness finding fields onto this contract instead of forking a second format", () => {
      expect(reference).toContain("readiness-rubric");
      expect(referenceFlat).toMatch(/no second findings format|second format/i);
      // The mapping table binds each readiness field to a contract field.
      for (const field of [
        "invariant_violated",
        "evidence",
        "why_proof_missed",
        "root_correction",
        "machinery_to_remove",
      ]) {
        expect(reference).toContain(field);
      }
      // "why existing proof missed it" is served by evidence + a proof-gap
      // clause; the root correction is the existing fix, at the owning boundary.
      expect(referenceFlat).toMatch(/proof.gap/i);
      expect(referenceFlat).toMatch(/owning boundary/i);
    });

    it("orders findings by consequence without licensing section reordering", () => {
      for (const flat of [eagerFlat, referenceFlat]) {
        expect(flat).toMatch(/highest.consequence first/i);
      }
      expect(referenceFlat).toMatch(/severity and blast radius/i);
      expect(referenceFlat).toMatch(/not.*(discovery|file) order/i);
      expect(referenceFlat).toMatch(/section order (stays|is) stable/i);
    });

    it("stays backwards compatible for existing review surfaces", () => {
      expect(referenceFlat).toMatch(
        /required for.*readiness|readiness.*required/i
      );
      expect(referenceFlat).toMatch(/recommended/i);
      expect(referenceFlat).toMatch(
        /well.formed|not.*malformed|never retroactively/i
      );
      // The passes that must not become malformed overnight.
      for (const pass of ["product", "quality", "local", "bot-parity"]) {
        expect(reference).toContain(pass);
      }
    });
  });
});
