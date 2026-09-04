/**
 * Contract coverage for the vendor-neutral deployed-state-readback rule.
 *
 * The eager head + reference body are the executable contract for grounding a
 * build ticket in observed deployed state before it asserts something is
 * missing. These assertions pin the wrong-axis diagnosis (the 2b waiver was
 * scoped to the observation method, not to whether to observe), the routing
 * that replaces the blanket waiver, the non-acceptance of ancestry as
 * deployment evidence, and the unanswerable-probe rule — and confirm all four
 * `*-to-tracker` skills cite the ONE shared slug rather than keeping four
 * divergent forks of Phase 2.
 *
 * The bidirectional cross-reference with `blocker-containment` is pinned
 * deliberately. That rule REQUIRES the ancestry test this one rejects, and the
 * two are only reconcilable if each states which question it answers. A future
 * edit that drops either direction leaves two rules in the tree that read as
 * contradictory.
 * @module tests/unit/strategies/deployed-state-readback-rule
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const CONSUMERS = [
  "lisa-notion-to-tracker",
  "lisa-github-to-tracker",
  "lisa-linear-to-tracker",
  "lisa-confluence-to-tracker",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * Strip markdown emphasis so a phrase assertion tests the prose rather than
 * where the author put bold markers.
 * @param doc - Raw markdown
 * @returns The same text without `*` and backtick emphasis
 */
const plain = (doc: string): string => doc.replace(/[*`]/g, "");

describe("deployed-state-readback rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/eager/deployed-state-readback.md");
    const reference = read(root, "rules/reference/deployed-state-readback.md");

    it("eager head breadcrumbs to the reference body", () => {
      expect(eager).toContain(
        "[reference/deployed-state-readback.md](../reference/deployed-state-readback.md)"
      );
    });

    it("requires the assertion to come from the running system, not the source", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(
          /must come from reading the running system|read the deployed thing back/i
        );
      }
    });

    it("names the wrong-axis diagnosis rather than only asserting the fix", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(/observation method/i);
        expect(plain(doc)).toMatch(/should we observe live state at all/i);
      }
      expect(plain(reference)).toMatch(/scoped to the wrong axis/i);
    });

    it("replaces the blanket waiver with a different probe, never no probe", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(/a different probe/i);
      }
      expect(plain(reference)).toMatch(/never no probe/i);
    });

    it("routes each work kind to a probe that reads deployed state", () => {
      for (const lane of [
        "Infrastructure / IaC",
        "CI / workflow config",
        "Dependency / package pin",
      ]) {
        expect(reference).toContain(lane);
      }
      expect(plain(reference)).toMatch(/describe the deployed resource/i);
      expect(plain(reference)).toMatch(
        /installed. artifact|installed artifact/i
      );
    });

    it("rejects ancestry, merge checks and synth as deployment evidence", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(
          /are not deployment evidence|never deployment evidence/i
        );
        expect(doc).toContain("SUPERSEDED");
        expect(plain(doc)).toMatch(/cdk synth/);
      }
    });

    it("treats an unanswerable probe as unanswered, never as absent", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(/unanswerable probe is not a/i);
        expect(plain(doc)).toMatch(
          /Absence of evidence is not evidence of absence/i
        );
      }
    });

    it("requires the readback to be recorded on the ticket", () => {
      for (const doc of [eager, reference]) {
        expect(plain(doc)).toMatch(/record/i);
      }
      expect(plain(reference)).toMatch(/claim-time triage inherits evidence/i);
    });

    it("cites the existing doctrine it applies rather than inventing new doctrine", () => {
      for (const slug of [
        "empirical-inquiry",
        "verification",
        "stale-state-claims",
      ]) {
        expect(reference).toContain(slug);
      }
      expect(plain(reference)).toMatch(/is not new doctrine/i);
    });

    describe("reconciliation with blocker-containment", () => {
      const bcEager = read(root, "rules/eager/blocker-containment.md");
      const bcReference = read(root, "rules/reference/blocker-containment.md");

      it("this rule explains why it does not conflict", () => {
        for (const doc of [eager, reference]) {
          expect(doc).toContain("blocker-containment");
          expect(plain(doc)).toMatch(/development/i);
          expect(plain(doc)).toMatch(/deployment/i);
        }
      });

      it("blocker-containment carries the reverse cross-reference", () => {
        for (const doc of [bcEager, bcReference]) {
          expect(doc).toContain("deployed-state-readback");
          expect(plain(doc)).toMatch(
            /never .{0,30}for a deployment question|not a deployment one/i
          );
        }
      });

      it("both sides forbid using one test to answer the other's question", () => {
        for (const doc of [reference, bcReference]) {
          expect(plain(doc)).toMatch(
            /Neither test may be used to answer the other's question/i
          );
        }
      });
    });

    describe.each(CONSUMERS)("%s", consumer => {
      const skill = read(root, `skills/${consumer}/SKILL.md`);

      it("cites the shared slug instead of restating the routing", () => {
        expect(skill).toContain("deployed-state-readback");
        expect(plain(skill)).toMatch(/do not restate its routing/i);
      });

      it("no longer waives live-state grounding wholesale", () => {
        // The old waiver said the quiet part: skip 2b and author from source.
        expect(skill).not.toContain(
          "Skip 2b only when the work is purely backend"
        );
        expect(plain(skill)).toMatch(
          /Skipping 2b never means authoring the ticket with no live-state grounding/i
        );
      });

      it("carries the readback step with its ancestry and unanswerable guards", () => {
        expect(plain(skill)).toMatch(/Deployed-state readback/i);
        expect(plain(skill)).toMatch(/absent from the deployed environment/i);
        expect(skill).toContain("cdk synth");
        expect(plain(skill)).toMatch(/unanswerable probe is not a/i);
      });
    });
  });
});
