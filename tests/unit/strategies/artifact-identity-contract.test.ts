/**
 * Contract coverage for BCE-4 (#1838): evidence pinned to an artifact identity,
 * reconciled with the shipped merge-race ancestry definition.
 *
 * Evidence that does not name the commit it was collected against can be
 * "verified" for one artifact and shipped as another — the auto-merge race is a
 * shipped bug class here. This suite pins the prose/skill layer that matches the
 * identity legs already shipped in the Stop-hook gate (#1836): the
 * `claim-evidence-mapping` reference defines Artifact identity in full (replacing
 * BCE-1's hedge while keeping the BCE-5 one), the `verification` rule's
 * Per-Work-Unit Evidence Contract concretizes the value slots BCE-3 added, the
 * evidence skills require those values (not placeholders) before posting, and the
 * merge-race reconciliation CITES `lisa-drive-pr-to-merge`'s ancestry +
 * deploy-run definition rather than re-implementing a second one. Both plugin
 * roots are checked so the generated copies cannot drift.
 * @module tests/unit/strategies/artifact-identity-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const IDENTITY_FIELDS = [
  "repository",
  "head_sha",
  "artifact_head_sha",
  "sha256",
  "captured_at",
  "environment",
] as const;

/** The shipped skill that owns the one definition of "the artifact that shipped". */
const SHIPPED_ARTIFACT_OWNER = "lisa-drive-pr-to-merge";
/** Its ancestry command — cited by slug everywhere else, never restated. */
const ANCESTRY_COMMAND = "git merge-base --is-ancestor";

const VENDOR_EVIDENCE_SKILLS = [
  "skills/lisa-github-evidence/SKILL.md",
  "skills/lisa-jira-evidence/SKILL.md",
  "skills/lisa-linear-evidence/SKILL.md",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("Artifact identity contract (BCE-4)", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/claim-evidence-mapping.md");
    const eager = read(root, "rules/eager/claim-evidence-mapping.md");
    const verification = read(root, "rules/reference/verification.md");
    const trackerEvidence = read(root, "skills/lisa-tracker-evidence/SKILL.md");

    describe("the mapping contract defines artifact identity", () => {
      it("carries a dedicated Artifact identity section instead of BCE-1's hedge", () => {
        expect(reference).toMatch(/^#+ .*Artifact identity/im);
        // BCE-1 deferred the definition to this ticket; BCE-4 ships it.
        expect(reference).not.toMatch(
          /[Aa]rtifact identity[^.]{0,160}is defined in \*\*BCE-4/
        );
        expect(reference).not.toMatch(
          /artifact identity[\s\S]{0,200}do not assume that surface is present/i
        );
      });

      it("names every identity field the shipped v2 verdict carries", () => {
        for (const field of IDENTITY_FIELDS) {
          expect(reference).toContain(field);
        }
      });

      it("pins evidence to the SHA and the build it was collected against", () => {
        expect(reference).toMatch(
          /collected against|captured against|observed at/i
        );
        expect(reference).toMatch(/head_sha[\s\S]{0,400}sha256/);
      });

      it("defines tamper detection as a loud, evidence-id-naming failure", () => {
        expect(reference).toContain("evidence_digest_mismatch");
        expect(reference).toMatch(/recompute/i);
        expect(reference).toMatch(/names? the evidence id/i);
        expect(reference).toMatch(/blocks? completion|completion is blocked/i);
      });

      it("fails a stale artifact SHA loudly, naming both SHAs", () => {
        expect(reference).toContain("artifact_mismatch");
        expect(reference).toMatch(/both SHAs/i);
      });

      it("reconciles the merge race by citing drive-pr-to-merge, not re-implementing it", () => {
        expect(reference).toContain(SHIPPED_ARTIFACT_OWNER);
        expect(reference).toMatch(/ancestry/i);
        expect(reference).toMatch(/deploy.run/i);
        // One definition, two guards — the command itself is never restated.
        expect(reference).not.toContain(ANCESTRY_COMMAND);
      });

      it("states when pre-merge evidence still counts for the merge commit", () => {
        expect(reference).toMatch(
          /parent of the merge|ancestor of the merged head/i
        );
        expect(reference).toMatch(/re-?run|re-?verif/i);
        expect(reference).toMatch(/never (report|declare) (shipped|complete)/i);
      });

      it("stays advisory-first behind the shipped ratchet flag", () => {
        expect(reference).toContain("verification.gate.enforceBoundaries");
        expect(reference).toMatch(/advisory/i);
      });

      it("keeps the BCE-5 security hedge it does not own", () => {
        expect(reference).toContain("#1839");
        expect(reference).toMatch(/security/i);
      });

      it("names the discipline in the eager head so it loads", () => {
        expect(eager).toMatch(/artifact identit/i);
        expect(eager).toContain("head_sha");
      });
    });

    describe("the verification rule concretizes the identity value slots", () => {
      it("no longer defers the values to BCE-4", () => {
        expect(verification).not.toMatch(/Populated by BCE-4/);
      });

      it("documents the identity fields in the committed verdict shape", () => {
        for (const field of ["head_sha", "sha256", "captured_at"]) {
          expect(verification).toContain(field);
        }
        expect(verification).toContain("artifact_head_sha");
      });

      it("carries the merge-race reconciliation by citation", () => {
        expect(verification).toContain(SHIPPED_ARTIFACT_OWNER);
        expect(verification).toMatch(/merged head|merge race/i);
        expect(verification).not.toContain(ANCESTRY_COMMAND);
      });
    });

    describe("the S14 evidence gate enforces identity", () => {
      it("requires the Artifact identity heading to carry values, not placeholders", () => {
        expect(trackerEvidence).toContain("## Artifact identity");
        expect(trackerEvidence).toMatch(/values, not placeholders/i);
        for (const field of ["head_sha", "sha256", "captured_at"]) {
          expect(trackerEvidence).toContain(field);
        }
      });

      it("refuses an artifact whose recorded head_sha mismatches the verdict's, naming both SHAs", () => {
        expect(trackerEvidence).toContain("artifact_mismatch");
        expect(trackerEvidence).toMatch(/both SHAs/i);
        expect(trackerEvidence).toMatch(/refuse|stop and report/i);
      });

      it("refuses a tampered evidence file by evidence id", () => {
        expect(trackerEvidence).toContain("evidence_digest_mismatch");
        expect(trackerEvidence).toMatch(/recompute/i);
      });

      it("cites the shared shipped-artifact definition for the merge race", () => {
        expect(trackerEvidence).toContain(SHIPPED_ARTIFACT_OWNER);
        expect(trackerEvidence).not.toContain(ANCESTRY_COMMAND);
      });

      it("keeps identity checks advisory-first behind the same ratchet flag", () => {
        expect(trackerEvidence).toContain(
          "verification.gate.enforceBoundaries"
        );
        expect(trackerEvidence).toMatch(/advisory/i);
      });
    });

    describe("the vendor evidence skills", () => {
      it.each(VENDOR_EVIDENCE_SKILLS)(
        "%s requires the Artifact identity section before posting",
        rel => {
          const skill = read(root, rel);
          expect(skill).toContain("## Artifact identity");
          expect(skill).toContain("head_sha");
          expect(skill).toMatch(/refuse|do not post|stop and report/i);
        }
      );
    });
  });
});
