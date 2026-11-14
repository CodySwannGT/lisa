/**
 * Contract coverage for the vendor-neutral claim-evidence-mapping rule.
 *
 * The rule's guidance prose is not pinned (#4867). The rule ships as a
 * reference body only; its eager side is the link in `00-rule-index.md`, and
 * that link is the only way the eager side is checked. What stays: the
 * reference ships with a non-trivial body, it is reachable from the eager rule
 * index, and the reference names the claim fields that shipped code parses
 * (`claim_id`, `boundary`, `required_evidence_kinds`, read by
 * `enforce-verification-gate.sh` and the doctor readiness checks). Both plugin
 * roots are checked.
 * @module tests/unit/strategies/claim-evidence-mapping-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const FIELD_NAMES = [
  "claim_id",
  "boundary",
  "required_evidence_kinds",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("claim-evidence-mapping rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/claim-evidence-mapping.md");

    it("ships a non-trivial reference body", () => {
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/claim-evidence-mapping.md"
      );
    });

    it("defines the field names BCE-2's schema reuses", () => {
      for (const field of FIELD_NAMES) {
        expect(reference).toContain(field);
      }
    });
  });
});
