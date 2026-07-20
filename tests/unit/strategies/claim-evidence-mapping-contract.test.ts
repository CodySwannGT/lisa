/**
 * Contract coverage for the vendor-neutral claim-evidence-mapping rule.
 *
 * The eager head + reference body are the shared spine every evidence surface
 * cites (BCE-2..BCE-7 instantiate it): every claim declares a BOUNDARY, and a
 * claim is established only by evidence of a KIND that reaches that boundary.
 * These assertions pin the closed claim-boundary taxonomy, the core inequality
 * (unit tests never discharge a browser / deploy-health / standards-compat
 * claim), the code-unit bounding of a unit test-run-log, the field names BCE-2's
 * schema reuses (claim_id / boundary / required_evidence_kinds), the breadcrumb
 * the cursor generator rewrites, the cite-don't-restate discipline against the
 * verification / factory-model / empirical-inquiry slugs, the sibling-ticket
 * hedges, and the never-block-always-degrade posture. Both plugin roots are
 * checked so the generated copy can never drift from the source.
 * @module tests/unit/strategies/claim-evidence-mapping-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const BOUNDARIES = [
  "code-unit",
  "browser",
  "http-api",
  "cli",
  "data",
  "deploy-health",
  "performance",
  "standards-compat",
] as const;

const FIELD_NAMES = [
  "claim_id",
  "boundary",
  "required_evidence_kinds",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("claim-evidence-mapping rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/claim-evidence-mapping.md");
    const reference = read(root, "rules/reference/claim-evidence-mapping.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("eager head breadcrumbs to the reference body verbatim", () => {
      expect(eager).toContain(
        "Full contract (claim-boundary taxonomy, core inequality, worked example, field names): [reference/claim-evidence-mapping.md](../reference/claim-evidence-mapping.md)."
      );
    });

    it("names every claim boundary in both halves", () => {
      for (const doc of [eager, reference]) {
        for (const boundary of BOUNDARIES) {
          expect(doc).toContain(boundary);
        }
      }
    });

    it("states the load-bearing rule: a claim declares a boundary and is established only by evidence that reaches it", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/boundary/i);
        expect(doc).toMatch(/reaches (that|the) boundary/i);
      }
    });

    it("binds every boundary to an establishing evidence kind in the reference table", () => {
      // The taxonomy table header — each boundary row names what establishes it
      // and what cannot.
      expect(reference).toMatch(/\| Claim boundary \|/);
      expect(reference).toMatch(/Establishing evidence kind/i);
      expect(reference).toMatch(/Cannot be established by/i);
      // Evidence kinds are drawn verbatim from the verification rule's
      // artifact-type taxonomy — not invented here.
      for (const kind of [
        "test-run-log",
        "screenshot",
        "http-transcript",
        "cli-output",
        "db-query-output",
        "deploy-log",
        "perf-trace",
      ]) {
        expect(reference).toContain(kind);
      }
    });

    it("states the core inequality explicitly", () => {
      // unit tests ≠ browser behavior ≠ healthy deployment ≠ standards compat.
      expect(reference).toMatch(/core inequality/i);
      for (const doc of [eager, reference]) {
        expect(doc).toContain("≠");
      }
    });

    it("bounds a unit test-run-log to the code-unit claim only", () => {
      for (const doc of [eager, reference]) {
        // A unit test is a quality prerequisite reaching only code-unit.
        expect(doc).toMatch(/unit test/i);
        expect(doc).toMatch(/code-unit/);
      }
      // The reference spells out the boundaries a unit log can NEVER discharge.
      for (const cannot of [
        "browser",
        "http-api",
        "deploy-health",
        "standards-compat",
      ]) {
        expect(reference).toContain(cannot);
      }
      expect(reference).toMatch(/never establish|cannot establish|can never/i);
    });

    it("carries a worked example fence", () => {
      const fence = /```text\n([\s\S]*?)```/.exec(reference)?.[1] ?? "";
      expect(fence.length).toBeGreaterThan(0);
      expect(fence).toMatch(/boundary/i);
    });

    it("defines the field names BCE-2's schema reuses", () => {
      for (const field of FIELD_NAMES) {
        expect(reference).toContain(field);
      }
    });

    it("names the review-rejection rule", () => {
      expect(reference).toMatch(/reject/i);
    });

    it("cites sibling rules by bare slug rather than restating them", () => {
      for (const slug of [
        "verification",
        "factory-model",
        "empirical-inquiry",
      ]) {
        expect(reference).toContain(slug);
      }
      // Cite, don't inline the reference path.
      expect(reference).not.toContain("rules/reference/factory-model.md");
    });

    it("names the improve-harness bounded-claim discipline as the philosophical precedent", () => {
      expect(reference).toMatch(/bounded.claim/i);
    });

    it("adds a reciprocal cross-link to the verification rule", () => {
      expect(reference).toContain("verification");
      expect(reference).toMatch(/artifact-type/i);
    });

    it("hedges concepts that ship with sibling tickets", () => {
      // Not-established (BCE-3), artifact identity (BCE-4), security bucket (BCE-5)
      // are NAMED here but defined in their own tickets.
      expect(reference).toMatch(/not established/i);
      expect(reference).toMatch(/artifact identit/i);
      expect(reference).toMatch(/security/i);
      expect(reference).toMatch(
        /ships with that ticket|defined (fully )?in|that ticket/i
      );
      for (const ref of ["#1836", "#1837", "#1838", "#1839"]) {
        expect(reference).toContain(ref);
      }
    });

    it("is operator-readable and degrades rather than blocking", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/factory-model/);
      }
      expect(reference).toMatch(/degrade|never block/i);
    });
  });
});
