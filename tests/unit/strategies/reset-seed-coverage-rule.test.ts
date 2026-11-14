/**
 * Contract coverage for the vendor-neutral reset-seed-coverage rule.
 *
 * The rule's guidance prose is not pinned (#4867). What stays is structural:
 * the reference body ships with a non-trivial body and is reachable from the
 * eager rule index.
 * @module tests/unit/strategies/reset-seed-coverage-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("reset-seed-coverage rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/reset-seed-coverage.md");

    it("stays reachable from the eager rule index", () => {
      expect(reference.length).toBeGreaterThan(2000);
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/reset-seed-coverage.md"
      );
    });
  });
});
