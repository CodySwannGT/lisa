/**
 * Structural coverage for the vendor-neutral automation-runbook-contract rule.
 *
 * The rule's wording is guidance prose and is reviewed, not pinned. What stays
 * pinned is that the reference body is reachable from the eager rule index,
 * the line `check-rules-pairing.sh` reads.
 * @module tests/unit/strategies/automation-runbook-contract-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("automation-runbook-contract rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/automation-runbook-contract.md"
      );
    });
  });
});
