/**
 * Contract coverage for BCE-5 (#1839): security-review findings split into two
 * buckets behind an impact-or-exploitability bar, with a conservative
 * unproven default.
 *
 * A security-shaped pattern match with no reproducer inflates severity and
 * buries the one finding that is real. This suite pins the prose layer that
 * makes severity earned: a finding claims **Security (proven)** only with a
 * reproducer evidence ref (of a kind that reaches the claim's boundary, per
 * BCE-1) *and* a bounded impact/exploitability statement. Missing either, it
 * stays in the security section labeled **unproven** with its reason — it is
 * never auto-demoted to maintenance. The bucket label is a single configurable
 * policy point (`security.review.unprovenBucket`) so an owner who prefers true
 * demotion flips one value. Both plugin roots are checked so the generated
 * copies cannot drift.
 * @module tests/unit/strategies/security-two-bucket-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The single configurable policy point for the unproven bucket label. */
const POLICY_POINT = "security.review.unprovenBucket";
/** Its conservative default — still inside the security section. */
const DEFAULT_BUCKET = "security-unproven";
/** The contract that defines what counts as a reaching reproducer. */
const MAPPING_SLUG = "claim-evidence-mapping";
/** The dependency-CVE ladder this ticket cites but never forks. */
const CVE_LADDER_SLUG = "security-audit-handling";

/** The two bucket headings every finding surface renders. */
const PROVEN = "Security (proven)";
const UNPROVEN = "Security (unproven)";

/** Every surface that renders a security finding must carry the same buckets. */
const FINDING_SURFACES = [
  "skills/lisa-security-review/SKILL.md",
  "agents/security-specialist.md",
] as const;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("Security two-bucket contract (BCE-5)", () => {
  describe.each(ROOTS)("%s", root => {
    const review = read(root, "skills/lisa-security-review/SKILL.md");
    const zap = read(root, "skills/lisa-security-zap-scan/SKILL.md");
    const reference = read(root, "rules/reference/claim-evidence-mapping.md");
    const eager = read(root, "rules/eager/claim-evidence-mapping.md");

    describe("the security-review skill owns the bar", () => {
      it("renders two named buckets instead of a flat vulnerability list", () => {
        expect(review).toContain(PROVEN);
        expect(review).toContain(UNPROVEN);
      });

      it("states the bar as reproducer AND bounded impact", () => {
        expect(review).toMatch(/reproducer/i);
        expect(review).toMatch(/impact|exploitability/i);
        expect(review).toMatch(/both|and a bounded|missing either/i);
        expect(review).toMatch(/missing either/i);
      });

      it("carries the per-finding fields that make the classifier mechanical", () => {
        for (const field of ["reproducer", "impact", "reason"]) {
          expect(review).toContain(field);
        }
        expect(review).toMatch(/none/i);
        expect(review).toMatch(/unproven/);
      });

      it("cites the mapping contract for what counts as a reaching reproducer", () => {
        expect(review).toContain(MAPPING_SLUG);
        expect(review).toContain("http-transcript");
      });

      it("names the BCE-1 evidence contract and its ticket at that citation", () => {
        expect(review).toContain("BCE-1");
        expect(review).toContain("#1835");
      });

      it("preserves each field independently when only one half is missing", () => {
        // A bounded impact with no reproducer keeps its impact text — the
        // placeholder belongs only to the half that is actually absent.
        expect(review).toMatch(/each field stands on its own|independently/i);
        expect(review).toMatch(/never overwrite|do not overwrite/i);
        expect(review).toMatch(/which half|names? what is missing/i);
      });

      it("keeps the unproven finding in the security section by default", () => {
        expect(review).toMatch(/not (auto-)?demote|never (auto-)?demote/i);
        expect(review).toMatch(/maintenance/i);
        expect(review).toMatch(/stays? in the security section|not removed/i);
      });

      it("names the single configurable policy point and its default", () => {
        expect(review).toContain(POLICY_POINT);
        expect(review).toContain(DEFAULT_BUCKET);
        expect(review).toMatch(
          /no other classification|only the label|nothing else changes/i
        );
      });

      it("requires operator-readable finding text", () => {
        expect(review).toContain("factory-model");
      });

      it("cites the dependency-CVE ladder rather than forking it", () => {
        expect(review).toContain(CVE_LADDER_SLUG);
      });

      it("stays advisory-consistent with the shipped ratchet flag", () => {
        expect(review).toContain("verification.gate.enforceBoundaries");
        expect(review).toMatch(/advisory/i);
      });
    });

    describe("the ZAP scan applies the same bar", () => {
      it("buckets alerts proven/unproven with a reason", () => {
        expect(zap).toContain(PROVEN);
        expect(zap).toContain(UNPROVEN);
        expect(zap).toMatch(/reason/i);
      });

      it("treats a reproducer-less alert as unproven, not dropped", () => {
        expect(zap).toMatch(/reproducer/i);
        expect(zap).toMatch(/not (dropped|removed|demoted)/i);
      });

      it("cites the review skill for the bar instead of restating it", () => {
        expect(zap).toContain("lisa-security-review");
      });

      it("honors the same policy point", () => {
        expect(zap).toContain(POLICY_POINT);
      });

      it("requires a proven alert's reproducer to reach the claim's boundary", () => {
        expect(zap).toContain(MAPPING_SLUG);
        expect(zap).toMatch(/boundary/i);
      });

      it("classifies every alert instead of summarizing Medium+ only", () => {
        expect(zap).toMatch(/every alert|all alerts/i);
        expect(zap).toMatch(
          /before classification|unclassified|nothing is dropped/i
        );
      });
    });

    describe.each(FINDING_SURFACES)("%s", rel => {
      it("renders both buckets so the agent and skill cannot drift", () => {
        const doc = read(root, rel);
        expect(doc).toContain(PROVEN);
        expect(doc).toContain(UNPROVEN);
        expect(doc).toMatch(/reproducer/i);
      });
    });

    describe("the mapping contract carries the definition, not a hedge", () => {
      it("replaces the BCE-5 hedge with the two-bucket definition", () => {
        expect(reference).toMatch(/^#+ .*security bucket/im);
        expect(reference).not.toMatch(
          /is set in \*\*BCE-5 \(#1839\)\*\*[\s\S]{0,120}ships with that ticket/
        );
        expect(reference).not.toMatch(
          /conservative default bucket[\s\S]{0,200}not defined by this contract/i
        );
      });

      it("states the bar and the conservative default compactly", () => {
        expect(reference).toContain(DEFAULT_BUCKET);
        expect(reference).toContain(POLICY_POINT);
        expect(reference).toMatch(/reproducer/i);
        expect(reference).toMatch(/never (auto-)?demote|not (auto-)?demoted/i);
      });

      it("defers the full procedure to the security skill by slug", () => {
        expect(reference).toContain("lisa-security-review");
      });

      it("keeps the ticket provenance the sibling pins rely on", () => {
        expect(reference).toContain("#1839");
      });

      it("names the buckets in the eager head so they load", () => {
        expect(eager).toMatch(/unproven/i);
        expect(eager).toContain(POLICY_POINT);
      });
    });
  });
});
