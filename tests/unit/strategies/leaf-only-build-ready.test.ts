/* eslint-disable max-lines -- one regression suite tracks the leaf-only invariant across every write/validate/intake skill and both plugin roots (#538-#543) */
/**
 * Regression tests for the leaf-only build-ready invariant across the GitHub
 * write and validate paths.
 *
 * Issue #538: `lisa:github-to-tracker` / `lisa:github-write-issue` must apply
 * the build-ready label (`status:ready`) ONLY to leaf sub-tasks when writing a
 * decomposed hierarchy — never to the Epic or Stories.
 *
 * Issue #540: `lisa:github-validate-issue` adds the symmetric read-side guard —
 * an S15 gate that FAILs a build-ready container (or a childless
 * Epic/Story/Spike) and PASSes a childless build-ready leaf work unit.
 *
 * Issue #542: `lisa:github-build-intake` adds the claim-time arm — Phase 3a
 * classifies each candidate before claiming and skips / safe-blocks any parent
 * with open child work (or a childless Epic/Story/Spike) carrying a stale
 * build-ready label, while a childless leaf is claimed normally.
 *
 * Issue #543: mirrors the #542 claim-time gate into the JIRA and Linear build
 * scanners — `jira-build-intake` and `linear-build-intake` each add a Phase 3a
 * leaf-only claim gate ahead of the claim step — and documents the forwarded
 * contract in the vendor-neutral `tracker-build-intake` shim, so all three
 * build scanners skip / safe-block containers identically.
 *
 * Issue #539: mirrors the #538 decomposition-side change into the other three
 * PRD-to-tracker skills — `notion-to-tracker`, `confluence-to-tracker`,
 * `linear-to-tracker` — so all four PRD sources are behaviorally identical:
 * Phase 3 (Epics) and Phase 4 (Stories) never pass `status:ready`; Phase 5
 * (Sub-tasks) is the only phase that applies it.
 *
 * Issue #541: mirrors the #540 read-side gate into the JIRA and Linear
 * validators — `jira-validate-ticket` and `linear-validate-issue` each add an
 * S15 gate with the equivalent leaf-only remediation, keeping the three
 * validators symmetric so PRD-intake comment formatting stays shared.
 *
 * The invariant itself is the vendor-neutral `leaf-only-lifecycle` rule (merged
 * in #537); these tests assert that the writer, decomposition, validator, and
 * build-intake skills encode it so the label is never hard-applied to — nor
 * accepted on, nor claimed from — a container.
 *
 * Both the source (`plugins/src/base/skills`) and the generated artifact
 * (`plugins/lisa/skills`) are asserted, so an artifact-only edit or a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/leaf-only-build-ready
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** Vendor-neutral rule slug every leaf-only enforcement path cites. */
const RULE_SLUG = "leaf-only-lifecycle";
/** Heading that anchors the S15 gate section in github-validate-issue. */
const S15_HEADING = "#### S15 — Leaf-only build-ready";
/** Shared test name reused for every skill that cites the rule by slug. */
const CITES_SLUG = "cites the leaf-only-lifecycle rule by slug";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("leaf-only build-ready invariant (#538)", () => {
  describe.each(SKILL_ROOTS)("%s/github-write-issue", root => {
    const content = readSkill(root, "github-write-issue");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("documents a container create path that omits status:ready", () => {
      // The previous skill applied `--label "status:ready"` on the single
      // CREATE example regardless of type. After the fix there must be a
      // container path whose create command omits the build-ready label.
      expect(content).toMatch(/WITHOUT --label "status:ready"/);
    });

    it("makes the build-ready label conditional on a leaf work unit", () => {
      // The skill must describe the conditional: only Bug/Task/Sub-task/
      // Improvement leaves receive status:ready; containers do not.
      expect(content).toMatch(/leaf work unit/i);
      expect(content).toMatch(/status:ready/);
      expect(content).toMatch(/only.*leaf work unit/i);
    });

    it("names the container types that never receive build-ready", () => {
      expect(content).toMatch(/Epic/);
      expect(content).toMatch(/Story/);
    });
  });

  describe.each(SKILL_ROOTS)("%s/github-to-tracker", root => {
    const content = readSkill(root, "github-to-tracker");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("states Epics (Phase 3) never receive the build-ready label", () => {
      // Phase 3 creates Epics; it must not mark them build-ready.
      expect(content).toMatch(/leaf/i);
      expect(content).toMatch(/status:ready/);
    });

    it("states only Sub-tasks (Phase 5) receive the build-ready label", () => {
      // Phase 5 creates the leaf Sub-tasks — the only items that may be ready.
      const phase5Index = content.indexOf("### Phase 5: Create Sub-tasks");
      expect(phase5Index).toBeGreaterThan(-1);
      const phase5Onward = content.slice(phase5Index);
      expect(phase5Onward).toMatch(/status:ready/);
    });
  });

  // Issue #540: the GitHub validator must FAIL a build-ready container and a
  // childless build-ready Epic/Story/Spike, while PASSing a build-ready leaf.
  // The gate is documented as S15 in github-validate-issue/SKILL.md. Asserting
  // both roots catches an artifact-only edit or a missed `bun run build:plugins`.
  describe.each(SKILL_ROOTS)("%s/github-validate-issue (#540)", root => {
    const content = readSkill(root, "github-validate-issue");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("registers the S15 Leaf-only build-ready gate in the gate table", () => {
      // Fixed category `structural`, product_relevant false per the ticket.
      expect(content).toMatch(
        /\|\s*S15 Leaf-only build-ready\s*\|\s*`structural`\s*\|\s*false\s*\|/
      );
    });

    it("defines an S15 gate section", () => {
      expect(content).toContain(S15_HEADING);
    });

    it("lists S15 in the output report template", () => {
      expect(content).toMatch(/S15 Leaf-only build-ready — <one-line reason>/);
    });

    it("extends the gate-ID range to include S15", () => {
      // The failure-detail field doc enumerates the valid gate IDs.
      expect(content).toMatch(/S1.*S15.*F1.*F4/);
    });

    it("FAILs a container that carries the build-ready role", () => {
      const s15Index = content.indexOf(S15_HEADING);
      expect(s15Index).toBeGreaterThan(-1);
      const section = content.slice(s15Index);
      // Container with child work + build-ready => FAIL.
      expect(section).toMatch(/Container with child work \+ build-ready/);
      expect(section).toMatch(/FAIL/);
    });

    it("FAILs a childless Epic/Story/Spike marked build-ready", () => {
      const s15Index = content.indexOf(S15_HEADING);
      const section = content.slice(s15Index);
      expect(section).toMatch(/Childless container-type \+ build-ready/);
      // The childless-parent exception must NOT promote these types.
      expect(section).toMatch(/does \*\*not\*\* promote an Epic\/Story\/Spike/);
    });

    it("PASSes a childless leaf work unit marked build-ready", () => {
      const s15Index = content.indexOf(S15_HEADING);
      const section = content.slice(s15Index);
      // The childless-parent exception: Bug/Task/Sub-task/Improvement leaf passes.
      expect(section).toMatch(/PASS \(the childless-parent exception\)/);
      expect(section).toMatch(
        /Bug, Task, Sub-task, Improvement|Bug \/ Task \/ Sub-task \/ Improvement/
      );
    });

    it("treats a non-build-ready issue as N/A for S15", () => {
      const s15Index = content.indexOf(S15_HEADING);
      const section = content.slice(s15Index);
      expect(section).toMatch(/N\/A.*not build-ready|not build-ready.*N\/A/i);
    });

    it("documents the build_ready and child_refs spec inputs", () => {
      expect(content).toContain("build_ready");
      expect(content).toContain("child_refs");
    });
  });

  // Issue #541: the JIRA and Linear validators must mirror the #540
  // github-validate-issue leaf-only gate — FAIL a build-ready container (or a
  // childless Epic/Story/Spike) and PASS a build-ready leaf. The gate is
  // documented as S15 in both jira-validate-ticket and linear-validate-issue,
  // keeping the three validators symmetric. Asserting both roots catches an
  // artifact-only edit or a missed `bun run build:plugins`.
  const VALIDATE_SKILLS = [
    "jira-validate-ticket",
    "linear-validate-issue",
  ] as const;

  describe.each(VALIDATE_SKILLS)("%s (#541)", skill => {
    describe.each(SKILL_ROOTS)("%s", root => {
      const content = readSkill(root, skill);

      it(CITES_SLUG, () => {
        expect(content).toContain(RULE_SLUG);
      });

      it("registers the S15 Leaf-only build-ready gate in the gate table", () => {
        // Fixed category `structural`, product_relevant false — the same fixed
        // taxonomy github-validate-issue uses so PRD-intake formatting is shared.
        expect(content).toMatch(
          /\|\s*S15 Leaf-only build-ready\s*\|\s*`structural`\s*\|\s*false\s*\|/
        );
      });

      it("defines an S15 gate section", () => {
        expect(content).toContain(S15_HEADING);
      });

      it("lists S15 in the output report template", () => {
        expect(content).toMatch(
          /S15 Leaf-only build-ready — <one-line reason>/
        );
      });

      it("FAILs a container that carries the build-ready role", () => {
        const s15Index = content.indexOf(S15_HEADING);
        expect(s15Index).toBeGreaterThan(-1);
        const section = content.slice(s15Index);
        expect(section).toMatch(/Container with child work \+ build-ready/);
        expect(section).toMatch(/FAIL/);
      });

      it("FAILs a childless Epic/Story/Spike marked build-ready", () => {
        const s15Index = content.indexOf(S15_HEADING);
        const section = content.slice(s15Index);
        expect(section).toMatch(/Childless container-type \+ build-ready/);
        // The childless-parent exception must NOT promote these types.
        expect(section).toMatch(
          /does \*\*not\*\* promote an Epic\/Story\/Spike/
        );
      });

      it("PASSes a childless leaf work unit marked build-ready", () => {
        const s15Index = content.indexOf(S15_HEADING);
        const section = content.slice(s15Index);
        expect(section).toMatch(/PASS \(the childless-parent exception\)/);
        expect(section).toMatch(
          /Bug, Task, Sub-task, Improvement|Bug \/ Task \/ Sub-task \/ Improvement/
        );
      });

      it("treats a non-build-ready item as N/A for S15", () => {
        const s15Index = content.indexOf(S15_HEADING);
        const section = content.slice(s15Index);
        expect(section).toMatch(/N\/A.*not build-ready|not build-ready.*N\/A/i);
      });

      it("documents the build_ready and child_refs spec inputs", () => {
        expect(content).toContain("build_ready");
        expect(content).toContain("child_refs");
      });

      it("uses the same leaf-only remediation as github-validate-issue", () => {
        const s15Index = content.indexOf(S15_HEADING);
        const section = content.slice(s15Index);
        // The shared remediation wording keeps PRD-intake comment formatting
        // identical across the three validators (the #541 acceptance criterion:
        // "equivalent leaf-only remediation").
        expect(section).toContain(
          "Build-ready (status:ready) is leaf-only per leaf-only-lifecycle."
        );
        expect(section).toMatch(
          /a parent's lifecycle state rolls up from its children and is never set to ready directly/
        );
      });
    });
  });

  // Issue #542: github-build-intake must skip / safe-block any parent that
  // carries the build-ready label but has open child work (and any childless
  // Epic/Story/Spike), claiming only leaf work units. The gate lives in
  // Phase 3a, ahead of the claim relabel. Asserting both roots catches an
  // artifact-only edit or a missed `bun run build:plugins`.
  describe.each(SKILL_ROOTS)("%s/github-build-intake (#542)", root => {
    const content = readSkill(root, "github-build-intake");
    /** Heading that anchors the claim-time leaf-only gate. */
    const gateHeading = "#### 3a. Leaf-only claim gate";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("defines a Phase 3a leaf-only claim gate ahead of the claim", () => {
      const gateIndex = content.indexOf(gateHeading);
      const claimIndex = content.indexOf("#### 3b. Claim");
      expect(gateIndex).toBeGreaterThan(-1);
      expect(claimIndex).toBeGreaterThan(-1);
      // The gate must precede the claim step so a container is never claimed.
      expect(gateIndex).toBeLessThan(claimIndex);
    });

    it("skips / safe-blocks a parent with open child work", () => {
      const gateIndex = content.indexOf(gateHeading);
      const section = content.slice(gateIndex);
      // Structural container detection via open sub-issues.
      expect(section).toMatch(/open child work/i);
      expect(section).toMatch(/do NOT claim|never claimed|not claimed/i);
      expect(section).toMatch(/skip|safe-block/i);
    });

    it("queries native sub-issues to detect open children", () => {
      const gateIndex = content.indexOf(gateHeading);
      const section = content.slice(gateIndex);
      // Same native hierarchy lisa:github-read-issue uses.
      expect(section).toMatch(/subIssues/);
      expect(section).toMatch(/graphql/i);
      expect(section).toMatch(/OPEN/);
    });

    it("does not claim a childless Epic/Story/Spike", () => {
      const gateIndex = content.indexOf(gateHeading);
      const section = content.slice(gateIndex);
      expect(section).toMatch(
        /childless container-type|childless Epic\/Story\/Spike/i
      );
      expect(section).toMatch(/Epic/);
      expect(section).toMatch(/Story/);
      expect(section).toMatch(/Spike/);
    });

    it("claims a childless leaf work unit", () => {
      const gateIndex = content.indexOf(gateHeading);
      const section = content.slice(gateIndex);
      // The childless-parent exception: flat Bug/Task/Sub-task/Improvement
      // with no open children falls through to the claim.
      expect(section).toMatch(/leaf work unit/i);
      expect(section).toMatch(
        /Bug, Task, Sub-task, Improvement|Bug \/ Task \/ Sub-task \/ Improvement/
      );
      expect(section).toMatch(/[Pp]roceed.*claim|claim/);
    });

    it("posts a lifecycle-repair comment when safe-blocking a container", () => {
      const gateIndex = content.indexOf(gateHeading);
      const section = content.slice(gateIndex);
      expect(section).toMatch(/lifecycle-repair/i);
      // The repair guidance points the label off the parent onto its leaves.
      expect(section).toMatch(
        /onto its leaf children|move .* off this parent/i
      );
    });

    it("lists a Skipped (container) bucket in the summary report", () => {
      expect(content).toMatch(/Skipped \(container/);
    });
  });

  // Issue #543: jira-build-intake and linear-build-intake must mirror the #542
  // github-build-intake claim-time gate — a Phase 3a leaf-only claim gate ahead
  // of the claim step that skips / safe-blocks any parent with open child work
  // (or a childless Epic/Story/Spike) carrying a stale build-ready role, while a
  // childless leaf is claimed normally. Both vendor scanners keep the gate
  // symmetric with the GitHub one so behavior never drifts by tracker. Asserting
  // both roots catches an artifact-only edit or a missed `bun run build:plugins`.
  const BUILD_INTAKE_SKILLS = [
    "jira-build-intake",
    "linear-build-intake",
  ] as const;

  describe.each(BUILD_INTAKE_SKILLS)("%s (#543)", skill => {
    describe.each(SKILL_ROOTS)("%s", root => {
      const content = readSkill(root, skill);
      /** Heading that anchors the claim-time leaf-only gate. */
      const gateHeading = "#### 3a. Leaf-only claim gate";

      it(CITES_SLUG, () => {
        expect(content).toContain(RULE_SLUG);
      });

      it("defines a Phase 3a leaf-only claim gate ahead of the claim", () => {
        const gateIndex = content.indexOf(gateHeading);
        const claimIndex = content.indexOf("#### 3b. Claim");
        expect(gateIndex).toBeGreaterThan(-1);
        expect(claimIndex).toBeGreaterThan(-1);
        // The gate must precede the claim step so a container is never claimed.
        expect(gateIndex).toBeLessThan(claimIndex);
      });

      it("skips / safe-blocks a parent with open child work", () => {
        const gateIndex = content.indexOf(gateHeading);
        const section = content.slice(gateIndex);
        expect(section).toMatch(/open child work/i);
        expect(section).toMatch(/do NOT claim|never claimed|not claimed/i);
        expect(section).toMatch(/skip|safe-block/i);
      });

      it("counts only open children, excluding terminal ones", () => {
        const gateIndex = content.indexOf(gateHeading);
        const section = content.slice(gateIndex);
        // Same OPEN_CHILDREN structural detection the GitHub gate uses, mapped
        // to each vendor's terminal state vocabulary.
        expect(section).toMatch(/OPEN_CHILDREN/);
        expect(section).toMatch(/still open|not.*(Done|terminal|completed)/i);
      });

      it("resolves children via the vendor's native hierarchy", () => {
        const gateIndex = content.indexOf(gateHeading);
        const section = content.slice(gateIndex);
        // The gate must reuse the same hierarchy the vendor read skill uses and
        // explicitly exclude dependency links (blocks / is blocked by) from
        // parentage, per leaf-only-lifecycle.
        expect(section).toMatch(/read-(ticket|issue)/);
        expect(section).toMatch(/not parentage|not.*children/i);
      });

      it("does not claim a childless Epic/Story/Spike", () => {
        const gateIndex = content.indexOf(gateHeading);
        const section = content.slice(gateIndex);
        expect(section).toMatch(
          /childless container-type|childless Epic\/Story\/Spike/i
        );
        expect(section).toMatch(/Epic/);
        expect(section).toMatch(/Story/);
        expect(section).toMatch(/Spike/);
      });

      it("claims a childless leaf work unit", () => {
        const gateIndex = content.indexOf(gateHeading);
        const section = content.slice(gateIndex);
        // The childless-parent exception: flat Bug/Task/Sub-task/Improvement
        // with no open children falls through to the claim.
        expect(section).toMatch(/leaf work unit/i);
        expect(section).toMatch(
          /Bug, Task, Sub-task, Improvement|Bug \/ Task \/ Sub-task \/ Improvement/
        );
        expect(section).toMatch(/[Pp]roceed.*claim|claim/);
      });

      it("posts a lifecycle-repair comment when safe-blocking a container", () => {
        const gateIndex = content.indexOf(gateHeading);
        const section = content.slice(gateIndex);
        expect(section).toMatch(/lifecycle-repair/i);
        // The repair guidance points the role off the parent onto its leaves.
        expect(section).toMatch(
          /onto its leaf children|move .* off this parent/i
        );
      });

      it("uses the same leaf-only repair wording as the other arms", () => {
        const gateIndex = content.indexOf(gateHeading);
        const section = content.slice(gateIndex);
        // Shared wording keeps the lifecycle-repair message consistent with the
        // validators' S15 remediation (the #543 cross-vendor symmetry goal).
        expect(section).toContain(
          "Build-ready (status:ready) is leaf-only per leaf-only-lifecycle"
        );
        // Case-insensitive: the safe-block comment mirrors github-build-intake's
        // capitalized sentence ("A parent's …"); the validators use it lowercase
        // mid-sentence. Both encode the same rollup invariant.
        expect(section).toMatch(
          /a parent's lifecycle state rolls up from its children and is never set to ready directly/i
        );
      });

      it("lists a Skipped (container) bucket in the summary report", () => {
        expect(content).toMatch(/Skipped \(container/);
      });
    });
  });

  // Issue #543: the vendor-neutral tracker-build-intake shim must document and
  // forward the leaf-only claim contract so the three vendor scanners do not
  // drift. The shim is dispatch-only — it does not re-gate — but it cites the
  // rule by slug and names each vendor's Phase 3a gate. Asserting both roots
  // catches an artifact-only edit or a missed `bun run build:plugins`.
  describe.each(SKILL_ROOTS)("%s/tracker-build-intake (#543)", root => {
    const content = readSkill(root, "tracker-build-intake");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("documents the forwarded leaf-only claim contract", () => {
      expect(content).toMatch(/claims only.*leaf work units/i);
      expect(content).toMatch(/skip|safe-block/i);
      expect(content).toMatch(/open child work/i);
    });

    it("names each vendor's Phase 3a gate", () => {
      expect(content).toContain("lisa:github-build-intake");
      expect(content).toContain("lisa:jira-build-intake");
      expect(content).toContain("lisa:linear-build-intake");
      expect(content).toMatch(/Phase 3a/);
    });

    it("states the shim forwards rather than re-gates", () => {
      // The shim must not claim to re-implement the gate — it relies on the
      // resolved vendor scanner's Phase 3a.
      expect(content).toMatch(
        /forward|dispatch only|does not re-?(implement|gate)/i
      );
    });

    it("ties the claim-time arm to its write and validate siblings", () => {
      expect(content).toContain("lisa:tracker-write");
      expect(content).toContain("lisa:tracker-validate");
    });
  });

  // Issue #539: the three non-GitHub PRD-to-tracker skills must mirror the #538
  // decomposition-side change so all four PRD sources are behaviorally
  // identical — Phase 3 (Epics) and Phase 4 (Stories) never pass status:ready;
  // Phase 5 (Sub-tasks) is the only phase that applies it. Asserting both roots
  // catches an artifact-only edit or a missed `bun run build:plugins`.
  const TO_TRACKER_SKILLS = [
    "notion-to-tracker",
    "confluence-to-tracker",
    "linear-to-tracker",
  ] as const;
  /** Phase headings used to slice each to-tracker skill into phase windows. */
  const PHASE_3_HEADING = "### Phase 3: Create Epics";
  const PHASE_4_HEADING = "### Phase 4: Create Stories";
  const PHASE_5_HEADING = "### Phase 5: Create Sub-tasks";
  const PHASE_55_HEADING = "### Phase 5.5: Artifact Preservation Gate";

  describe.each(TO_TRACKER_SKILLS)("%s (#539)", skill => {
    describe.each(SKILL_ROOTS)("%s", root => {
      const content = readSkill(root, skill);
      /**
       * Slice the skill content to the window for a single phase.
       * @param from heading that opens the phase window (inclusive)
       * @param to heading that opens the next phase (exclusive bound)
       * @returns the content between the two headings
       */
      const phaseWindow = (from: string, to: string): string => {
        const fromIndex = content.indexOf(from);
        const toIndex = content.indexOf(to);
        expect(fromIndex).toBeGreaterThan(-1);
        expect(toIndex).toBeGreaterThan(fromIndex);
        return content.slice(fromIndex, toIndex);
      };

      it(CITES_SLUG, () => {
        expect(content).toContain(RULE_SLUG);
      });

      it("states Epics (Phase 3) are never marked build-ready", () => {
        const phase3 = phaseWindow(PHASE_3_HEADING, PHASE_4_HEADING);
        // The Epic block must carry the leaf-only guidance and forbid the label.
        expect(phase3).toContain(RULE_SLUG);
        expect(phase3).toMatch(/container, not a leaf work unit/);
        expect(phase3).toMatch(/status:ready/);
      });

      it("states Stories (Phase 4) are never marked build-ready", () => {
        const phase4 = phaseWindow(PHASE_4_HEADING, PHASE_5_HEADING);
        expect(phase4).toContain(RULE_SLUG);
        expect(phase4).toMatch(/a Story is a container/);
        expect(phase4).toMatch(/status:ready/);
      });

      it("applies the build-ready label only to Sub-tasks (Phase 5)", () => {
        const phase5 = phaseWindow(PHASE_5_HEADING, PHASE_55_HEADING);
        expect(phase5).toContain(RULE_SLUG);
        expect(phase5).toMatch(/leaf work units/);
        // Sub-tasks are the ONLY items that receive the label.
        expect(phase5).toMatch(/the ONLY items in the hierarchy/);
        expect(phase5).toMatch(/status:ready/);
      });

      it("cites the vendor-neutral build intake, not the GitHub one", () => {
        const phase5 = phaseWindow(PHASE_5_HEADING, PHASE_55_HEADING);
        // These are vendor-neutral PRD sources: the destination tracker is
        // resolved by lisa:tracker-write, so the leaf-only guidance must point
        // at lisa:tracker-build-intake rather than lisa:github-build-intake.
        expect(phase5).toContain("lisa:tracker-build-intake");
        expect(phase5).not.toContain("lisa:github-build-intake");
      });
    });
  });
});
/* eslint-enable max-lines -- re-enable after the leaf-only invariant suite */
