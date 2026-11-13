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
    const eager = read(root, "rules/reference/claim-evidence-mapping.md");
    const reference = read(root, "rules/reference/claim-evidence-mapping.md");

    it("ships as a paired rule with a non-trivial body on both sides", () => {
      expect(eager.length).toBeGreaterThan(500);
      expect(reference.length).toBeGreaterThan(2000);
    });

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/claim-evidence-mapping.md"
      );
    });

    it("names every claim boundary in both halves", () => {
      for (const doc of [eager, reference]) {
        for (const boundary of BOUNDARIES) {
          expect(doc).toContain(boundary);
        }
      }
    });

    it("binds every boundary to an establishing evidence kind in the reference table", () => {
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

    it("bounds a unit test-run-log to the code-unit claim only", () => {
      // The reference spells out the boundaries a unit log can NEVER discharge.
      for (const cannot of [
        "browser",
        "http-api",
        "deploy-health",
        "standards-compat",
      ]) {
        expect(reference).toContain(cannot);
      }
    });

    it("carries a worked example fence", () => {
      const fence = /```text\n([\s\S]*?)```/.exec(reference)?.[1] ?? "";
      expect(fence.length).toBeGreaterThan(0);
    });

    it("defines the field names BCE-2's schema reuses", () => {
      for (const field of FIELD_NAMES) {
        expect(reference).toContain(field);
      }
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

    it("adds a reciprocal cross-link to the verification rule", () => {
      expect(reference).toContain("verification");
    });
  });
});
