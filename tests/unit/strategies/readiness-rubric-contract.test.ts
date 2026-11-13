/**
 * Contract coverage for the vendor-neutral readiness-rubric rule pair.
 *
 * The rule's guidance prose is not pinned (#4867). What stays: both halves
 * ship with a non-trivial body, the reference is reachable from the eager rule
 * index, and the reference names the five consequence-ordered finding fields
 * that the doctor readiness checks emit and read (`invariant_violated`,
 * `evidence`, `why_proof_missed`, `root_correction`, `machinery_to_remove`).
 * Both plugin roots are checked.
 * @module tests/unit/strategies/readiness-rubric-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The five fields a consequence-ordered readiness finding carries. */
const FINDING_FIELDS = [
  "invariant_violated",
  "evidence",
  "why_proof_missed",
  "root_correction",
  "machinery_to_remove",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("readiness-rubric rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/readiness-rubric.md");
    const reference = read(root, "rules/reference/readiness-rubric.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/readiness-rubric.md"
      );
    });

    it("names the five fields a consequence-ordered finding carries", () => {
      for (const field of FINDING_FIELDS) {
        expect(reference).toContain(field);
      }
    });
  });
});
