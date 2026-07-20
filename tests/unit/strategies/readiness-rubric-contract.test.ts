/**
 * Contract coverage for the vendor-neutral readiness-rubric rule pair.
 *
 * The eager head + reference body are the spine every later ticket of PRD #1739
 * instantiates (RRR-2..RRR-7): repository readiness — "may an agent fleet run
 * here unattended?" — is a different question from installation readiness, and
 * it is answered by eight ownership dimensions plus a closed set of seven ship
 * blockers. These assertions pin the eight dimension names, the seven blockers
 * and their owning dimensions, the closed-set statement, the shipped
 * READY / READY_WITH_WARNINGS / NOT_READY ladder (cited from doctor, never
 * forked), the narrowed-claim field, the consequence-ordering split against
 * doctor's stable section order, the five consequence-ordered finding fields,
 * the never-blank SKIP-with-reason rule, the warn-only posture, the breadcrumb
 * the cursor generator rewrites, the cite-don't-restate discipline, and the
 * sibling-ticket hedges. Both plugin roots are checked so the generated copy can
 * never drift from the source.
 * @module tests/unit/strategies/readiness-rubric-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The eight ownership dimensions, in the order the rubric reports them. */
const DIMENSIONS = [
  "context/routing",
  "capabilities/tools",
  "domain ownership",
  "execution/proof",
  "feedback/guardrails",
  "dependencies/supply chain",
  "delivery/authority",
  "proportionality",
] as const;

/** The closed v1 set of ship blockers. */
const BLOCKERS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7"] as const;

/** The five fields a consequence-ordered readiness finding carries. */
const FINDING_FIELDS = [
  "invariant_violated",
  "evidence",
  "why_proof_missed",
  "root_correction",
  "machinery_to_remove",
] as const;

/** Sibling tickets whose surfaces must be hedged, never assumed present. */
const SIBLING_TICKETS = [
  "#1854",
  "#1855",
  "#1856",
  "#1857",
  "#1858",
  "#1859",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * Collapse all whitespace so assertions survive reflowed markdown prose.
 * @param text - the raw markdown document to normalize
 * @returns the same text with every whitespace run collapsed to one space
 */
const squash = (text: string): string => text.replace(/\s+/g, " ");

describe("readiness-rubric rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/readiness-rubric.md");
    const reference = read(root, "rules/reference/readiness-rubric.md");
    const eagerFlat = squash(eager);
    const referenceFlat = squash(reference);

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("eager head breadcrumbs to the reference body verbatim", () => {
      expect(eager).toContain(
        "Full rubric (eight-dimension table, seven ship blockers, consequence ordering, worked example): [reference/readiness-rubric.md](../reference/readiness-rubric.md)."
      );
    });

    it("distinguishes repository readiness from installation readiness", () => {
      for (const flat of [eagerFlat, referenceFlat]) {
        expect(flat).toMatch(/installation readiness/i);
        expect(flat).toMatch(/repository readiness/i);
      }
      // Doctor's shipped grouped sections are the installation-readiness side.
      expect(referenceFlat).toMatch(/doctor/i);
      expect(referenceFlat).toMatch(
        /different question|orthogonal|not the same question/i
      );
    });

    it("names all eight ownership dimensions in both halves", () => {
      for (const flat of [eagerFlat, referenceFlat]) {
        for (const dimension of DIMENSIONS) {
          expect(flat).toContain(dimension);
        }
      }
      expect(eagerFlat).toMatch(/eight (ownership )?dimensions/i);
    });

    it("gives every dimension a question, a warning sign, and an existing evidence source", () => {
      expect(reference).toMatch(/\| # \| Dimension \|/);
      expect(referenceFlat).toMatch(/Warning signs/i);
      expect(referenceFlat).toMatch(/Evidence source/i);
      // Each row cites an already-shipped rule slug rather than inventing a
      // parallel vocabulary for a concept another rule already owns.
      for (const slug of [
        "integration-access-layer",
        "wiki-knowledge-source",
        "config-resolution",
        "tool-access-gate",
        "verification",
        "empirical-inquiry",
        "claim-evidence-mapping",
        "automation-runbook-contract",
        "observability-audit",
        "security-audit-handling",
        "claim-archaeology",
        "repo-scope-split",
      ]) {
        expect(reference).toContain(slug);
      }
      // Cite by slug, never by reference path.
      expect(reference).not.toContain("rules/reference/tool-access-gate.md");
    });

    it("lists exactly seven ship blockers, each mapped to an owning dimension", () => {
      for (const blocker of BLOCKERS) {
        expect(reference).toContain(`| ${blocker} |`);
      }
      expect(reference).not.toContain("| B8 |");
      expect(reference).toMatch(/\| Owning dimension/);
      for (const flat of [eagerFlat, referenceFlat]) {
        expect(flat).toMatch(/seven ship blockers|seven blockers/i);
      }
      // The seven conditions themselves, in operator language.
      for (const condition of [
        /silent data loss/i,
        /release path (that )?bypass/i,
        /unintended authority/i,
        /no gate and no recovery/i,
        /no confidence model/i,
        /overstates?.*enforced guarantees/i,
        /no way to prove/i,
      ]) {
        expect(referenceFlat).toMatch(condition);
      }
    });

    it("states the blocker set is closed in v1 and extended only by editing this rule", () => {
      expect(referenceFlat).toMatch(/closed (set )?in v1|closed set/i);
      expect(referenceFlat).toMatch(
        /editing this rule|edit(ing)? the rule|rule edit/i
      );
      // No configuration surface — intake decision O4.
      expect(referenceFlat).toMatch(
        /not configurable|no config|never configurable/i
      );
    });

    it("reuses the shipped verdict ladder instead of forking a new enum", () => {
      for (const verdict of ["READY_WITH_WARNINGS", "NOT_READY", "READY"]) {
        expect(reference).toContain(verdict);
      }
      expect(eager).toContain("NOT_READY");
      expect(referenceFlat).toMatch(
        /no new verdict|never a new verdict|no new enum/i
      );
    });

    it("defines the narrowed claim as the net-new field a standing blocker requires", () => {
      for (const flat of [eagerFlat, referenceFlat]) {
        expect(flat).toMatch(/narrowed claim/i);
      }
      expect(referenceFlat).toMatch(/what the repo(sitory)? IS ready for/i);
    });

    it("states the consequence-ordering split against doctor's stable section order", () => {
      for (const flat of [eagerFlat, referenceFlat]) {
        expect(flat).toMatch(/section order (stays|is) stable/i);
        expect(flat).toMatch(/ordered by consequence|order.*by consequence/i);
      }
      expect(referenceFlat).toMatch(/never silently omit/i);
    });

    it("names the five fields a consequence-ordered finding carries", () => {
      for (const field of FINDING_FIELDS) {
        expect(reference).toContain(field);
      }
      // RRR-2 (#1854) extends convergent-review with two of them.
      expect(reference).toContain("convergent-review");
      expect(referenceFlat).toMatch(/invariant.violated/i);
      expect(referenceFlat).toMatch(/machinery.to.remove/i);
    });

    it("requires SKIP to carry a reason and never render blank", () => {
      expect(reference).toContain("SKIP");
      expect(referenceFlat).toMatch(
        /SKIP with a reason|SKIP.*never (a )?blank|never blank/i
      );
    });

    it("keeps ship-blocker vocabulary distinct from the terms other rules own", () => {
      for (const owned of [
        "convergent-review",
        "tool-access-gate",
        "leaf-only-lifecycle",
      ]) {
        expect(reference).toContain(owned);
      }
      expect(referenceFlat).toMatch(/blocking finding/i);
      expect(referenceFlat).toMatch(/break.out/i);
      expect(referenceFlat).toMatch(/safe.block/i);
    });

    it("carries a worked example fence in operator language", () => {
      const fence = /```text\n([\s\S]*?)```/.exec(reference)?.[1] ?? "";
      expect(fence.length).toBeGreaterThan(0);
      expect(squash(fence)).toMatch(/NOT_READY/);
      expect(squash(fence)).toMatch(/narrowed claim/i);
    });

    it("is warn-only: it gates a claim, not a process", () => {
      for (const flat of [eagerFlat, referenceFlat]) {
        expect(flat).toMatch(/warn.only/i);
        expect(flat).toMatch(/gates? a claim, not a process/i);
      }
      expect(referenceFlat).toMatch(/hard.block/i);
    });

    it("reuses the shipped journey machinery rather than adding a second harness", () => {
      expect(reference).toContain("lisa-use-the-product");
      expect(referenceFlat).toMatch(
        /qualification evidence|qualificationEvidence/
      );
      expect(reference).toContain("#1742");
    });

    it("hedges every surface that ships with a sibling ticket", () => {
      for (const ticket of SIBLING_TICKETS) {
        expect(reference).toContain(ticket);
      }
      expect(reference).toContain(".lisa/readiness.json");
      expect(referenceFlat).toMatch(
        /ships with that ticket|not (yet )?(be )?present|do not assume/i
      );
    });

    it("is operator-readable and degrades rather than blocking", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("factory-model");
      }
      expect(referenceFlat).toMatch(/degrade|never block/i);
    });
  });
});
