/**
 * Contract coverage for the vendor-neutral blocker-containment rule.
 *
 * The eager head + reference body are the executable contract for deciding
 * whether an `is blocked by` dependency is satisfied. These assertions pin the
 * predicate (branch containment, not a lifecycle status name), the fail-closed
 * reason keys, the narrow no-code carve-out, and the derived-branch-plan
 * constraint that the rendered Branch Plan is never read as input — and confirm
 * all three consuming surfaces cite the ONE shared slug rather than each
 * growing its own status-name list again.
 *
 * The two directional guards are the point of the suite: a blocker merged only
 * to a non-containing branch must still block (the defect this rule fixes), and
 * a blocker merged into the branch the dependent builds from must clear without
 * waiting for production (the regression guard for the stranding bug the old
 * env-staged wording was itself introduced to fix).
 * @module tests/unit/strategies/blocker-containment-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const CONSUMERS = [
  "lisa-repair-intake",
  "lisa-intake-explain",
  "lisa-ticket-triage",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * Strip markdown emphasis so a phrase assertion tests the prose, not where the
 * author happened to put bold markers. Without this, adding `**` around two
 * words silently breaks an assertion that still holds semantically.
 * @param doc - Raw markdown
 * @returns The same text with `*` and backtick emphasis removed
 */
const plain = (doc: string): string => doc.replace(/[*`]/g, "");

describe("blocker-containment rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/blocker-containment.md");
    const reference = read(root, "rules/reference/blocker-containment.md");

    it("eager head breadcrumbs to the reference body", () => {
      expect(eager).toContain(
        "[reference/blocker-containment.md](../reference/blocker-containment.md)"
      );
    });

    it("states the predicate as branch containment, not a status name", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(
          /present on the branch the dependent will be built from|ancestor of the resolved base branch|ancestor of the branch/i
        );
        expect(doc).toMatch(/merge-base --is-ancestor|ancestry/i);
      }
    });

    it("names the status labels that are explicitly NOT the test", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(
          /never that fact|is the wrong test|never the test/i
        );
        for (const label of ["on-stg", "on-dev", "code-review", "done"]) {
          expect(doc).toContain(label);
        }
      }
    });

    it("derives the base branch from the environment, never from a rendered Branch Plan", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("deploy.branches");
        expect(doc).toContain("derived-branch-plan");
        expect(doc).toMatch(
          /Never read the rendered `Branch Plan` section as input/i
        );
      }
    });

    it("fails closed, and says so in both directions", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(
          /Never fail open on an unresolvable ancestry check/i
        );
        expect(doc).toMatch(/still blocking/i);
      }
    });

    it("enumerates the fail-closed reason keys in the reference body", () => {
      for (const key of [
        "no-pr",
        "pr-not-merged",
        "blocker-inaccessible",
        "base-branch-underivable",
        "base-branch-missing",
        "containment-not-computable",
        "not-contained",
      ]) {
        expect(reference).toContain(key);
      }
    });

    it("keeps the no-code carve-out narrow and positive, never an absence", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(/no runtime behavior change/);
        expect(plain(doc)).toMatch(/positive determination, never an absence/i);
      }
      // The carve-out must not be satisfiable by a failed lookup.
      expect(plain(reference)).toMatch(
        /I could not find a PR" is no-pr|is no-pr in the fail-closed table/i
      );
    });

    it("allows exactly one escape hatch, and forbids automation from forging it", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/human override/i);
        expect(doc).toMatch(
          /may never synthesize one on its own behalf|it is the only one/i
        );
      }
    });

    it("states the risk asymmetry that justifies failing closed", () => {
      expect(reference).toMatch(
        /false positive[\s\S]{0,200}invisible|invisible[\s\S]{0,200}looks exactly like a repair that worked/i
      );
    });

    describe("directional guards", () => {
      it("a blocker merged only to a leading promotion branch still blocks", () => {
        // The defect: `main` is the TRAILING branch under dev -> staging -> main,
        // so a blocker at On Stg is on `staging` and absent from `main`.
        for (const doc of [eager, reference]) {
          expect(doc).toMatch(/trailing/i);
          expect(doc).toMatch(/`?staging`?/);
        }
        expect(reference).toMatch(
          /absent from `main`|on `staging` and absent/i
        );
      });

      it("a blocker contained in the dependent's base branch clears without waiting for production", () => {
        // Regression guard for the stranding bug the old env-staged wording fixed.
        // Tightening the predicate must not re-introduce a production-terminal check.
        expect(reference).toMatch(
          /strand(ing|s|ed)? (every )?dependents? behind (a blocker|work) already merged/i
        );
        expect(reference).toMatch(
          /Correcting either one alone by moving its threshold re-opens the other's bug/i
        );
      });
    });

    it("scopes itself: it decides satisfaction only, not edge dissolution or reversal memory", () => {
      expect(reference).toMatch(/What this rule does not do/i);
      expect(reference).toMatch(/dissolve an edge/i);
      expect(reference).toMatch(/carries no memory of its own prior verdicts/i);
    });

    describe.each(CONSUMERS)("%s cites the shared slug", consumer => {
      it("cites blocker-containment rather than reimplementing the test", () => {
        const skill = read(root, `skills/${consumer}/SKILL.md`);
        expect(skill).toContain("blocker-containment");
        expect(skill).toMatch(/never the test|is never the test|not the test/i);
      });

      it("no longer clears a dependency on a bare env-staged status name", () => {
        const skill = read(root, `skills/${consumer}/SKILL.md`);
        expect(skill).not.toMatch(/shipped to any environment/i);
        // Plain substring, not a regex: the old wording hard-wrapped mid-phrase,
        // and a pattern spanning that break needs ambiguous whitespace
        // alternation that is itself a backtracking hazard (sonarjs/slow-regex).
        expect(skill).not.toContain("env-staged `done` role");
      });
    });
  });
});
