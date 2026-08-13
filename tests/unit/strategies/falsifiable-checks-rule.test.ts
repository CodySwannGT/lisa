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

    it("states the mutation probe as production-code, whole-suite, read-names", () => {
      // The yardstick was decided in wiki/decisions/2026-08-12-ratchet-policy.md
      // and lived only there (#2489), so the rule told an author to run the
      // break without telling them how to read the result. Each of the three
      // steps is pinned because dropping any one restores a known false
      // reading: neutering a test instead of production code proves only that
      // the file loads; a single-file run under-counts; a bare count cannot
      // separate one regression's failures from collateral.
      expect(eager).toContain("in production code");
      expect(eager).toContain("whole suite");
      expect(eager).toContain("read their names");
      expect(reference).toContain("Neuter the protection in production code");
      expect(reference).toContain("Run the whole suite");
      expect(reference).toContain("Count the failures and read their names");
      // Measurement validity under contention, which decides which numbers
      // have to be re-measured on a quiet box. Load turns green into red and
      // never the reverse, so a zero survives a busy machine while a positive
      // count is inflated by flakes and must not be read as "over-broad".
      expect(eager).toContain("zero is robust to contention");
      expect(reference).toContain(
        "Load can only add failures, never remove them"
      );
    });

    it("reads many-but-all-named-alike as load-bearing, not over-broad", () => {
      // Naive arithmetic is the defect this correction shipped against:
      // removing the two-token `--config-env` check failed 3 tests and pinning
      // an index failed 5, every name describing the removed behaviour. Both
      // guards were correctly scoped.
      expect(eager).toContain("Zero");
      expect(eager).toContain("Many, unrelated");
      expect(eager).toContain("Exactly one, or several all named for the same");
      expect(reference).toContain(
        "Exactly one failure, or several all named for the same regression"
      );
      // Asserted as an absence, not a presence: a presence check for the
      // corrected wording passes trivially once the file says it twice, while
      // the superseded wording has nowhere to hide.
      expect(eager).not.toContain("many means it is over-broad");
      expect(reference).not.toContain("**More than one failure**");
    });

    it("forbids scoping the cardinality probe by filename or grep", () => {
      // The false negative that forced the correction: a probe scoped to
      // block-direct-issue-create.test.ts read cardinality 0 on a live
      // end-of-options security fix whose tests had moved to a sibling file at
      // the 300-effective-line lint ceiling. A whole-suite re-measure showed 4
      // failures, each named for the protection.
      expect(eager).toContain("Never scope the probe by filename");
      expect(eager).toContain("never infer absent coverage from a grep");
      expect(reference).toContain("Follow the protection, not the path");
      expect(reference).toMatch(/re-measured/);
    });

    it("requires universal-negative assertions over existential ones", () => {
      // An existential assertion ("some copy says the right thing") over a
      // corpus with duplicates is satisfied by the correct copy, so the broken
      // copy is undetectable. Rewriting one suite to universal negatives took
      // the same mutation from 0 to 18 failures — same code, same corpus, only
      // the quantifier changed. This is the second innocent cause of a zero,
      // distinct from a filename-scoped probe.
      expect(eager).toContain(
        "Assert that no copy is wrong, not that some copy is right"
      );
      expect(reference).toContain("Universal negative");
      expect(reference).toContain("0 to 18");
      expect(reference).toContain("Wrong quantifier");
      expect(reference).toContain("Wrong probe scope");
    });

    it("requires enumerating the property, not the known-bad instance", () => {
      // A universal negative against one hard-coded wrong spelling still only
      // sees that spelling; asserting every marker uses an em-dash also catches
      // the en-dash and the missing dash.
      expect(eager).toContain("Enumerate the property");
      expect(reference).toContain(
        "Enumerate the property, not the known-bad instance"
      );
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
