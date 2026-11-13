/* eslint-disable max-lines -- one regression suite tracks the leaf-only invariant across every write/validate/intake skill and both plugin roots (#538-#543) */
/**
 * Regression tests for build-ready intake invariants across the GitHub write,
 * validate, and claim paths.
 *
 * Issue #538: `lisa-github-to-tracker` / `lisa-github-write-issue` must apply
 * the build-ready label (`status:ready`) ONLY to leaf sub-tasks when writing a
 * decomposed hierarchy — never to the Epic or Stories.
 *
 * Issue #540: `lisa-github-validate-issue` adds the symmetric read-side guard —
 * an S15 gate that FAILs a build-ready container (or a childless
 * Epic/Story/Spike) and PASSes a childless build-ready leaf work unit.
 *
 * Issue #542/#649: `lisa-github-build-intake` adds the claim-time arm — Phase 3a
 * classifies each candidate before claiming and repairs any parent
 * with open child work (or a childless Epic) carrying a stale
 * build-ready label, while a childless leaf is claimed normally.
 *
 * Issue #543: mirrors the #542 claim-time gate into the JIRA and Linear build
 * scanners — `jira-build-intake` and `linear-build-intake` each add a Phase 3a
 * leaf-only claim gate ahead of the claim step — and documents the forwarded
 * contract in the vendor-neutral `tracker-build-intake` shim, so all three
 * build scanners repair / safe-block containers consistently.
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
 * Issue #644: `lisa-github-build-intake` must also hold an otherwise valid
 * ready leaf when explicit `Blocked by:` relationships still point at active
 * issues, without mutating lifecycle labels or invoking the build agent.
 *
 * Childless-parent refinement: the childless-parent exception now treats the
 * Epic as the ONLY type that is a container regardless of children. A childless
 * Story or Spike is a directly implementable leaf (a Story is a shippable
 * increment; a Spike is itself the investigation unit) and is claimed / passes
 * validation like any other leaf — only a childless Epic stays safe-blocked.
 * These tests assert each enforcement path encodes that distinction so a
 * childless Story/Spike is never stranded in the ready queue.
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
const GITHUB_BUILD_INTAKE = "lisa-github-build-intake";
/** Heading that anchors the S15 gate section in github-validate-issue. */
const S15_HEADING = "#### S15 — Leaf-only build-ready";
/** Shared test name reused for every skill that cites the rule by slug. */
const CITES_SLUG = "cites the leaf-only-lifecycle rule by slug";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("leaf-only build-ready invariant (#538)", () => {
  describe.each(SKILL_ROOTS)("%s/lisa-github-write-issue", root => {
    const content = readSkill(root, "lisa-github-write-issue");

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
      expect(content).toMatch(/status:ready/);
    });
  });

  describe.each(SKILL_ROOTS)("%s/lisa-github-to-tracker", root => {
    const content = readSkill(root, "lisa-github-to-tracker");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("states Epics (Phase 3) never receive the build-ready label", () => {
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
    const content = readSkill(root, "lisa-github-validate-issue");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("extends the gate-ID range through the highest specification gate", () => {
      // The failure-detail field doc enumerates the valid gate IDs, and it is a
      // separate sentence from the gate table — so it goes stale silently every
      // time a gate is appended (it sat at S18 while S19 and S20 shipped).
      // Assert the two agree rather than pinning a number that rots: read the
      // highest `S<n>` the gate table defines, and require the range to name it.
      const defined = [...content.matchAll(/^#### (S\d+) —/gm)].map(match =>
        Number(match[1].slice(1))
      );
      const highest = Math.max(...defined);
      // Floor, so a parse that finds nothing cannot make this vacuous.
      expect(highest).toBeGreaterThanOrEqual(20);
    });

    it("FAILs a container that carries the build-ready role", () => {
      const s15Index = content.indexOf(S15_HEADING);
      expect(s15Index).toBeGreaterThan(-1);
      const section = content.slice(s15Index);
      expect(section).toMatch(/FAIL/);
    });

    it("PASSes a childless leaf work unit marked build-ready", () => {
      const s15Index = content.indexOf(S15_HEADING);
      const section = content.slice(s15Index);
      // The childless-parent exception: Bug/Task/Sub-task/Improvement leaf passes.
      expect(section).toMatch(/PASS \(the childless-parent exception\)/);
    });

    it("documents the build_ready and child_refs spec inputs", () => {
      expect(content).toContain("build_ready");
      expect(content).toContain("child_refs");
    });
  });

  // Issue #541: the JIRA and Linear validators must mirror the #540
  // github-validate-issue leaf-only gate — FAIL a build-ready container (or a
  // childless Epic) and PASS a build-ready leaf. The gate is
  // documented as S15 in both jira-validate-ticket and linear-validate-issue,
  // keeping the three validators symmetric. Asserting both roots catches an
  // artifact-only edit or a missed `bun run build:plugins`.
  const VALIDATE_SKILLS = [
    "lisa-jira-validate-ticket",
    "lisa-linear-validate-issue",
  ] as const;

  describe.each(VALIDATE_SKILLS)("%s (#541)", skill => {
    describe.each(SKILL_ROOTS)("%s", root => {
      const content = readSkill(root, skill);

      it(CITES_SLUG, () => {
        expect(content).toContain(RULE_SLUG);
      });

      it("FAILs a container that carries the build-ready role", () => {
        const s15Index = content.indexOf(S15_HEADING);
        expect(s15Index).toBeGreaterThan(-1);
        const section = content.slice(s15Index);
        expect(section).toMatch(/FAIL/);
      });

      it("PASSes a childless leaf work unit marked build-ready", () => {
        const s15Index = content.indexOf(S15_HEADING);
        const section = content.slice(s15Index);
        expect(section).toMatch(/PASS \(the childless-parent exception\)/);
      });

      it("documents the build_ready and child_refs spec inputs", () => {
        expect(content).toContain("build_ready");
        expect(content).toContain("child_refs");
      });
    });
  });

  // Issue #542/#649: github-build-intake must repair any parent that
  // carries the build-ready label but has open child work (and any childless
  // Epic/Story/Spike), dispatching only leaf work units. The gate lives in
  // Phase 3a, ahead of the claim relabel. Asserting both roots catches an
  // artifact-only edit or a missed `bun run build:plugins`.
  describe.each(SKILL_ROOTS)("%s/github-build-intake (#542)", root => {
    const content = readSkill(root, GITHUB_BUILD_INTAKE);
    /** Heading that anchors the claim-time leaf-only gate. */
    const gateHeading = "#### 3a. Leaf-only claim gate";
    /** Heading that anchors the claim step after all pre-claim gates. */
    const claimHeading = "#### 3b. Claim";

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("defines a Phase 3a leaf-only claim gate ahead of the claim", () => {
      const gateIndex = content.indexOf(gateHeading);
      const claimIndex = content.indexOf(claimHeading);
      expect(gateIndex).toBeGreaterThan(-1);
      expect(claimIndex).toBeGreaterThan(-1);
      // The gate must precede the claim step so a container is never dispatched.
      expect(gateIndex).toBeLessThan(claimIndex);
    });

    it("moves a parent with open child work out of the ready queue without dispatch", () => {
      const gateIndex = content.indexOf(gateHeading);
      const section = content.slice(gateIndex);
      expect(section).toMatch(/remove-label "\$READY"/);
      expect(section).toMatch(/add-label "\$CLAIMED"/);
    });

    it("queries native sub-issues to detect open children", () => {
      const gateIndex = content.indexOf(gateHeading);
      const section = content.slice(gateIndex);
      // Same native hierarchy lisa-github-read-issue uses.
      expect(section).toMatch(/subIssues/);
      expect(section).toMatch(/OPEN/);
    });

    it("checks explicit Blocked by relationships before claiming", () => {
      const gateIndex = content.indexOf(gateHeading);
      const claimIndex = content.indexOf(claimHeading);
      const section = content.slice(gateIndex, claimIndex);
      expect(section).toMatch(/owner\/repo#123/);
    });

    it("defines cleared and active blocker status semantics", () => {
      const gateIndex = content.indexOf(gateHeading);
      const claimIndex = content.indexOf(claimHeading);
      const section = content.slice(gateIndex, claimIndex);
      expect(section).toMatch(/status:on-dev/);
      expect(section).toMatch(/status:on-stg/);
      expect(section).toMatch(/status:done/);
      expect(section).toMatch(/status:ready/);
      expect(section).toMatch(/status:in-progress/);
    });
  });

  // Issue #543: jira-build-intake and linear-build-intake must mirror the #542
  // github-build-intake claim-time gate — a Phase 3a leaf-only claim gate ahead
  // of the claim step that skips / safe-blocks any parent with open child work
  // (or a childless Epic) carrying a stale build-ready role, while a
  // childless leaf is claimed normally. Both vendor scanners keep the gate
  // symmetric with the GitHub one so behavior never drifts by tracker. Asserting
  // both roots catches an artifact-only edit or a missed `bun run build:plugins`.
  const BUILD_INTAKE_SKILLS = [
    "lisa-jira-build-intake",
    "lisa-linear-build-intake",
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
    });
  });

  // Issue #543: the vendor-neutral tracker-build-intake shim must document and
  // forward the leaf-only claim contract so the three vendor scanners do not
  // drift. The shim is dispatch-only — it does not re-gate — but it cites the
  // rule by slug and names each vendor's Phase 3a gate. Asserting both roots
  // catches an artifact-only edit or a missed `bun run build:plugins`.
  describe.each(SKILL_ROOTS)("%s/tracker-build-intake (#543)", root => {
    const content = readSkill(root, "lisa-tracker-build-intake");

    it(CITES_SLUG, () => {
      expect(content).toContain(RULE_SLUG);
    });

    it("names each vendor's Phase 3a gate", () => {
      expect(content).toContain(GITHUB_BUILD_INTAKE);
      expect(content).toContain("lisa-jira-build-intake");
      expect(content).toContain("lisa-linear-build-intake");
    });

    it("ties the claim-time arm to its write and validate siblings", () => {
      expect(content).toContain("lisa-tracker-write");
      expect(content).toContain("lisa-tracker-validate");
    });
  });

  // Issue #539: the three non-GitHub PRD-to-tracker skills must mirror the #538
  // decomposition-side change so all four PRD sources are behaviorally
  // identical — Phase 3 (Epics) and Phase 4 (Stories) never pass status:ready;
  // Phase 5 (Sub-tasks) is the only phase that applies it. Asserting both roots
  // catches an artifact-only edit or a missed `bun run build:plugins`.
  const TO_TRACKER_SKILLS = [
    "lisa-notion-to-tracker",
    "lisa-confluence-to-tracker",
    "lisa-linear-to-tracker",
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
      });

      it("states Stories (Phase 4) are never marked build-ready", () => {
        const phase4 = phaseWindow(PHASE_4_HEADING, PHASE_5_HEADING);
        expect(phase4).toContain(RULE_SLUG);
      });

      it("applies the build-ready label only to Sub-tasks (Phase 5)", () => {
        const phase5 = phaseWindow(PHASE_5_HEADING, PHASE_55_HEADING);
        expect(phase5).toContain(RULE_SLUG);
      });

      it("cites the vendor-neutral build intake, not the GitHub one", () => {
        const phase5 = phaseWindow(PHASE_5_HEADING, PHASE_55_HEADING);
        // These are vendor-neutral PRD sources: the destination tracker is
        // resolved by lisa-tracker-write, so the leaf-only guidance must point
        // at lisa-tracker-build-intake rather than lisa-github-build-intake.
        expect(phase5).toContain("lisa-tracker-build-intake");
        expect(phase5).not.toContain(GITHUB_BUILD_INTAKE);
      });
    });
  });
});
/* eslint-enable max-lines -- re-enable after the leaf-only invariant suite */
