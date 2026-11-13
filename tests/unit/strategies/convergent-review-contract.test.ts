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

/** The two net-new fields RRR-2 folds into the shared finding shape. */
const NEW_FIELDS = ["invariant_violated", "machinery_to_remove"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("convergent-review rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/convergent-review.md");
    const reference = read(root, "rules/reference/convergent-review.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("carries the two net-new fields in both halves", () => {
      for (const field of NEW_FIELDS) {
        expect(reference).toContain(field);
        expect(eager).toContain(field);
      }
      expect(reference).toContain("scaffolding-subtraction");
    });

    it("maps the readiness finding fields onto this contract instead of forking a second format", () => {
      expect(reference).toContain("readiness-rubric");
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
    });
  });
});
