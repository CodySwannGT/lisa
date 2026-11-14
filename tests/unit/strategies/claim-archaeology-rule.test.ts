/**
 * Structural coverage for the vendor-neutral claim-archaeology rule.
 *
 * The rule's guidance prose is not pinned (#4867). What stays: the rule body
 * is reachable from the eager rule index, and the sync registry seeds the
 * archaeology budget default as code.
 * @module tests/unit/strategies/claim-archaeology-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SYNC_REGISTRY } from "../../../src/sync/registry.js";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("claim-archaeology rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/claim-archaeology.md"
      );
    });

    it("sync registry seeds the budget default the rule pair documents", () => {
      const entry = SYNC_REGISTRY.find(
        setting => setting.key === "archaeology"
      );
      expect(entry?.defaultValue).toEqual({ maxSteps: 8 });
    });
  });
});
