/**
 * Contract coverage for the vendor-neutral deployed-state-readback rule.
 *
 * The rule's guidance prose is not pinned (#4867). What stays is structural:
 * the rule body is reachable from the eager rule index.
 * @module tests/unit/strategies/deployed-state-readback-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("deployed-state-readback rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/deployed-state-readback.md"
      );
    });
  });
});
