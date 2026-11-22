/**
 * Contract coverage for the vendor-neutral design-source-of-truth rule (WU-F,
 * issue #2430).
 *
 * The rule's guidance prose is reviewed, not pinned. What stays pinned is the
 * machine-read part: the exact marker spelling, which
 * `scripts/design-source-gate.mjs` parses (a drifted marker silently disarms
 * the gate), the annotation form the same script reads, and the rule's
 * reachability from the eager rule index.
 * @module tests/unit/strategies/design-source-of-truth-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The exact marker. Hardcoded, never imported — drift is the thing under test. */
const MARKER = "DESIGN-SOURCE: none — not in Figma";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("design-source-of-truth rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/design-source-of-truth.md");

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/design-source-of-truth.md"
      );
    });

    it("carries the exact marker spelling the gate script parses", () => {
      expect(reference).toContain(MARKER);
    });

    it("names the positive annotation form the gate script parses", () => {
      expect(reference).toContain("DESIGN-SOURCE: <figma-url>");
    });
  });

  describe.each(ROOTS)("%s consumers", root => {
    it("the implement path carries the exact marker spelling", () => {
      expect(read(root, "skills/lisa-implement/SKILL.md")).toContain(MARKER);
    });

    it("ships the gate script in the plugin so every agent can run it", () => {
      expect(read(root, "scripts/design-source-gate.mjs")).toContain(MARKER);
    });
  });
});
