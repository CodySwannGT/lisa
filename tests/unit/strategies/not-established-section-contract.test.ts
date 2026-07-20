/**
 * Contract coverage for BCE-3 (#1837): the required, never-omitted
 * "Not established" section and the S14 claim<->boundary upgrade.
 *
 * Evidence surfaces historically recorded only what passed, so a journey that
 * skipped an edge state read identically to one that covered it. This suite
 * pins the generalization of `lisa-improve-harness`'s required, never-empty
 * `Known limits` field to every evidence surface: the claim-evidence-mapping
 * reference rule defines the section (replacing BCE-1's hedge), the
 * `verification` rule's Per-Work-Unit Evidence Contract carries it into the
 * committed `evidence/<ticket>/verdict.json` shape, and `lisa-tracker-evidence`
 * refuses a post whose comment omits the heading, whose verdict omits
 * `not_established_reviewed`, or whose typed `[EVIDENCE: ...]` marker cites an
 * artifact type that does not reach the boundary of the claim it is offered
 * for. Both plugin roots are checked so the generated copies cannot drift.
 * @module tests/unit/strategies/not-established-section-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const EMPTY_RENDERING = "None outstanding — reviewed";
const SECTION_HEADING = "Not established";

const VENDOR_EVIDENCE_SKILLS = [
  "skills/lisa-github-evidence/SKILL.md",
  "skills/lisa-jira-evidence/SKILL.md",
  "skills/lisa-linear-evidence/SKILL.md",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("Not-established section contract (BCE-3)", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/claim-evidence-mapping.md");
    const eager = read(root, "rules/eager/claim-evidence-mapping.md");
    const verification = read(root, "rules/reference/verification.md");
    const trackerEvidence = read(root, "skills/lisa-tracker-evidence/SKILL.md");

    describe("the mapping contract defines the section", () => {
      it("carries a dedicated Not established section instead of BCE-1's hedge", () => {
        expect(reference).toMatch(/^#+ .*Not established/im);
        // BCE-1 explicitly deferred the definition; BCE-3 ships it, so the
        // "do not assume that section is present" hedge must be gone.
        expect(reference).not.toMatch(
          /Not established[\s\S]{0,200}do not\s+assume that section is present/i
        );
      });

      it("makes the section required and never omitted, even when empty", () => {
        expect(reference).toMatch(/never[- ]omitted/i);
        expect(reference).toContain(EMPTY_RENDERING);
        expect(reference).toMatch(/never (rendered )?blank|never blank/i);
      });

      it("names the machine-readable fields, aligned with the shipped v2 verdict schema", () => {
        expect(reference).toContain("not_established_reviewed");
        expect(reference).toContain("not_established");
        // The flag, not the list, is what may never be omitted (#1836's
        // shipped semantics: the list may be empty).
        expect(reference).toMatch(
          /list may be empty[\s\S]{0,200}flag[\s\S]{0,80}never be omitted|flag[\s\S]{0,120}never be omitted/i
        );
      });

      it("keeps the shipped compatibility posture rather than contradicting it", () => {
        expect(reference).toMatch(/enforceBoundaries/);
        expect(reference).toMatch(/advisory/i);
      });

      it("cites improve-harness's Known limits as the shipped ancestor", () => {
        expect(reference).toMatch(/lisa-improve-harness|improve-harness/);
        expect(reference).toContain("Known limits");
        expect(reference).toContain(
          "A record with nothing in it is invalid on its face"
        );
      });

      it("gives operator-voice exemplars of unproved behavior", () => {
        expect(reference).toMatch(/boundaries not exercised/i);
        expect(reference).toMatch(/environments not tested/i);
        expect(reference).toMatch(/out of scope/i);
        // Written for a non-engineer reading at the gate.
        expect(reference).toMatch(/factory-model/);
      });

      it("still hedges the sibling tickets it does not own", () => {
        expect(reference).toMatch(/artifact identit/i);
        expect(reference).toContain("#1838");
        expect(reference).toContain("#1839");
      });

      it("names the section in the eager head so the discipline loads", () => {
        expect(eager).toMatch(/Not established/i);
      });
    });

    describe("the verification rule carries it into the evidence contract", () => {
      it("documents both new sections in the committed verdict.json shape", () => {
        expect(verification).toContain("not_established");
        expect(verification).toContain("not_established_reviewed");
        expect(verification).toMatch(/artifact identity/i);
      });

      it("requires the heading in the operator-facing evidence comment", () => {
        expect(verification).toContain(SECTION_HEADING);
        expect(verification).toContain(EMPTY_RENDERING);
      });
    });

    describe("the S14 evidence-manifest gate", () => {
      it("refuses a post whose comment omits the Not-established heading", () => {
        expect(trackerEvidence).toContain(SECTION_HEADING);
        expect(trackerEvidence).toContain(EMPTY_RENDERING);
        expect(trackerEvidence).toMatch(
          /refuse|stop and report|may not (post|advance)/i
        );
      });

      it("refuses a post whose verdict omits not_established_reviewed", () => {
        expect(trackerEvidence).toContain("not_established_reviewed");
      });

      it("binds each typed marker to the boundary of the claim it is cited for", () => {
        expect(trackerEvidence).toMatch(
          /claim.{0,3}(↔|<->|to ).{0,3}boundary/i
        );
        expect(trackerEvidence).toContain("claim-evidence-mapping");
        expect(trackerEvidence).toMatch(/reach(es)? (that|the) boundary/i);
        // The named failure mode from the acceptance criteria: a unit log
        // offered for a browser claim.
        expect(trackerEvidence).toMatch(/test-run-log/);
        expect(trackerEvidence).toContain("browser");
      });

      it("reports the offending marker by name and the required boundary kinds", () => {
        expect(trackerEvidence).toMatch(
          /by name[\s\S]{0,400}required[\s\S]{0,60}kind|marker.{0,80}name/i
        );
        expect(trackerEvidence).toMatch(
          /required evidence kinds|required kinds/i
        );
      });

      it("is advisory-first behind the same ratchet flag as the Stop-hook gate", () => {
        expect(trackerEvidence).toContain(
          "verification.gate.enforceBoundaries"
        );
        expect(trackerEvidence).toMatch(/advisory/i);
      });

      it("leaves the EVIDENCE-REF exemption untouched", () => {
        expect(trackerEvidence).toContain("[EVIDENCE-REF:");
        expect(trackerEvidence).toMatch(
          /satisf(y|ies) nothing|cannot satisfy/i
        );
      });
    });

    describe("the vendor evidence skills", () => {
      it.each(VENDOR_EVIDENCE_SKILLS)(
        "%s requires the Not-established section before posting",
        rel => {
          const skill = read(root, rel);
          expect(skill).toContain(SECTION_HEADING);
          expect(skill).toMatch(/refuse|do not post|stop and report/i);
        }
      );
    });
  });
});
