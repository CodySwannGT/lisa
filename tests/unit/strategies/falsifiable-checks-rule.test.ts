/**
 * Contract coverage for the falsifiable-checks rule.
 *
 * The rule exists because a check that cannot fail reports the defect as absent
 * and terminates the search — a strictly worse outcome than having no check. It
 * was written after a single sweep produced four false-passing guards and zero
 * false fixes: every code change was correct and every verification instrument
 * was broken.
 *
 * The rule's guidance prose is not pinned (#4867). What stays is structural:
 * both halves of the pair ship with a non-trivial body, and the eager head
 * carries the breadcrumb link the cursor generator rewrites.
 *
 * Both roots are checked because `plugins/lisa` is generated from
 * `plugins/src/base`: asserting one side only would let source-or-artifact drift
 * through, which is the failure `check-plugins-sync` exists to catch.
 * @module tests/unit/strategies/falsifiable-checks-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("falsifiable-checks rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/falsifiable-checks.md");
    const reference = read(root, "rules/reference/falsifiable-checks.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("eager head breadcrumbs to the reference body", () => {
      // The cursor generator rewrites this link.
      expect(eager).toContain(
        "[reference/falsifiable-checks.md](../reference/falsifiable-checks.md)"
      );
    });
  });
});
