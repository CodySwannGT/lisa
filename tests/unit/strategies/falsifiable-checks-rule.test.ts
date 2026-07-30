/**
 * Contract coverage for the falsifiable-checks rule.
 *
 * The rule exists because a check that cannot fail reports the defect as absent
 * and terminates the search — a strictly worse outcome than having no check. It
 * was written after a single sweep produced four false-passing guards and zero
 * false fixes: every code change was correct and every verification instrument
 * was broken.
 *
 * These assertions pin the parts an agent must not lose: the closed four-mode
 * vocabulary (each mode is a distinct mechanism, so dropping one leaves a live
 * blind spot), the "unvalidated, not passing" reporting requirement, the
 * breadcrumb the cursor generator rewrites, and — most importantly — the removal
 * of the `codify-verification` loophole that previously let "mentally reverting"
 * satisfy the fail-first step. That loophole is the exact mechanism by which a
 * non-functional guard ships, so its absence is asserted directly rather than
 * inferred from the presence of the replacement prose.
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

/**
 * The four observed ways a check passes while asserting nothing. Each is a
 * distinct mechanism with a distinct countermeasure — this is a closed set, and
 * losing an entry re-opens that blind spot.
 */
const FAILURE_MODES = [
  "Self-matching guard",
  "Fixture-validated assertion",
  "Stale-artifact pass",
  "Wrong-baseline sweep",
] as const;

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

    it("eager head breadcrumbs to the reference body verbatim", () => {
      expect(eager).toContain(
        "Full prose, worked examples, and the reporting template: [reference/falsifiable-checks.md](../reference/falsifiable-checks.md)."
      );
    });

    it("states the core rule: a check that cannot fail is not evidence", () => {
      expect(eager).toMatch(/cannot fail is not evidence/i);
      // The load-bearing instruction, not just the observation.
      expect(eager).toMatch(/prove it fails on known-bad input/i);
    });

    it("enumerates all four failure modes in the eager head", () => {
      for (const mode of FAILURE_MODES) {
        expect(eager).toContain(mode);
      }
    });

    it("expands every failure mode in the reference body", () => {
      for (const mode of FAILURE_MODES) {
        expect(reference).toContain(mode);
      }
      // Each mode needs its observed instance, or it reads as hypothetical and
      // gets skipped.
      expect(reference).toMatch(/Observed:/);
    });

    it("requires an unfalsified gate to be reported as unvalidated", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/unvalidated/i);
      }
      expect(eager).toMatch(/not.{0,20}as passing/i);
    });

    it("rejects mental reversion as satisfaction", () => {
      expect(eager).toMatch(/[Mm]entally reverting.{0,40}does not count/);
    });

    it("requires the failure to localize", () => {
      // A failure that does not name the location is weak evidence the check
      // measures the intended thing.
      expect(eager).toMatch(/names? the (right )?location/i);
      expect(reference).toMatch(/names? the right file\/line/i);
    });

    it("scopes negative results to what the check can perceive", () => {
      expect(eager).toMatch(/blind spot|scoped to what the check can see/i);
      // The three scoping axes that produced real misses.
      expect(reference).toMatch(/[Pp]resence vs\. value/);
      expect(reference).toMatch(/[Rr]eachability/);
      expect(reference).toMatch(/[Cc]lass completeness/);
    });

    it("prefers structural checks over text matching", () => {
      expect(eager).toMatch(/structural|AST/i);
    });
  });

  describe.each(ROOTS)("%s codify-verification integration", root => {
    const skill = read(root, "skills/lisa-codify-verification/SKILL.md");

    it("no longer permits mental reversion to satisfy the fail-first step", () => {
      // The pre-fix wording. Its presence means the loophole is back.
      expect(skill).not.toContain("sanity check by mentally reverting");
      expect(skill).not.toContain("pre-fix commit if cheap");
    });

    it("requires the failure to be observed, not reasoned about", () => {
      expect(skill).toMatch(/ACTUALLY FAILS without the change/);
      expect(skill).toMatch(/observed, not reasoned about/);
      expect(skill).toMatch(/mandatory for every codified test/i);
    });

    it("offers the synthetic-input escape for generated or cached inputs", () => {
      // Revert-to-verify silently fails when a generator errors and leaves the
      // previous artifact behind, so this alternative must stay available.
      expect(skill).toMatch(
        /[Uu]nit-test the checker against synthetic bad input/
      );
      expect(skill).toMatch(/generated, schema-validated, or cached/);
    });

    it("requires the Falsified by column in the codification report", () => {
      expect(skill).toContain("| Falsified by |");
      expect(skill).toMatch(/`Falsified by` column is required/);
      expect(skill).toContain("UNVALIDATED");
    });

    it("forbids a fixture-satisfiable assertion", () => {
      expect(skill).toMatch(/satisfiable by the test's own fixture/);
    });
  });

  describe.each(ROOTS)("%s verification rule cross-reference", root => {
    it("the verification eager rule points at falsifiable-checks", () => {
      const verification = read(root, "rules/eager/verification.md");
      expect(verification).toMatch(/falsifiable-checks/);
      expect(verification).toMatch(/cannot fail is not evidence/i);
    });
  });
});
