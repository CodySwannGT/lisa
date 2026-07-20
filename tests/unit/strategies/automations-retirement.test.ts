/**
 * Per-loop retirement conditions and the policy-obsolete self-teardown
 * proposal (RBC-7, #1801).
 *
 * The retirement mechanism itself is frozen in the `automation-runbook-contract`
 * rule (pinned by automation-runbook-contract-rule.test.ts). These pins assert
 * that the scaffold seed and the loop skills CONFORM to it: the three `intake-*`
 * loops declare themselves structural to the factory and never retire, the three
 * quiet-window loops carry the contract's two-part shape, and the gardener keeps
 * its six-week condition. A loop that can retire files exactly one marker-deduped
 * teardown proposal and keeps running until a human answers it; a loop that
 * cannot says so instead of leaving the section blank.
 *
 * Both source and generated plugin roots are asserted.
 * @module tests/unit/strategies/automations-retirement
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

/** The shared teardown-proposal dedupe marker prefix. */
const RETIRE_MARKER = "[lisa-automation-retire] key=";
/** The rule slug every conforming loop cites rather than restating. */
const CONTRACT = "automation-runbook-contract";
/** The run outcome a tripped retirement condition produces. */
const OBSOLETE = "policy-obsolete";
/** The RBC-6 search discipline the retire marker reuses. */
const OPEN_AND_CLOSED = "open AND closed";
/** The full slash-command name a proposal must name for the approve path. */
const TEARDOWN_COMMAND = "/lisa:tear-down-automations";
/** The scaffold skill that seeds each runbook's Retirement condition. */
const SETUP = "lisa-setup-automations";
/** The human-invoked skill that honors an approved proposal. */
const TEARDOWN = "lisa-tear-down-automations";

/** The three named operator responses, pinned wherever the proposal is described. */
const APPROVE = /\*\*approve\*\*/i;
const DECLINE = /\*\*decline\*\*/i;
const RE_CADENCE = /\*\*re-cadence\*\*/i;
/** The contract's two-part retirement test, as seeded prose. */
const BOTH_HOLD = /Propose teardown when BOTH hold/;

/** Loop-ids seeded as structural to the factory — no retirement, ever. */
const STRUCTURAL_LOOP_IDS = [
  "intake-repair",
  "intake-prd",
  "intake-tickets",
] as const;
/** Loop-ids seeded with the contract's two-part quiet-window condition. */
const QUIET_WINDOW_LOOP_IDS = [
  "monitor",
  "exploratory-prds",
  "exploratory-bugs",
] as const;
/** Skills that FILE a teardown proposal, paired with the loop-id keying the marker. */
const RETIRING_LOOP_SKILLS = [
  ["lisa-exploratory-qa", "exploratory-bugs"],
  ["lisa-project-ideation", "exploratory-prds"],
  ["lisa-monitor", "monitor"],
  ["lisa-learnings-audit", "learnings-audit"],
] as const;
/** Skills backing only structural loop-ids — they never file a proposal. */
const STRUCTURAL_LOOP_SKILLS = ["lisa-intake", "lisa-repair-intake"] as const;

/**
 * Reads one skill body from a plugin root.
 * @param root Plugin skills root (source or generated).
 * @param slug Skill directory name.
 * @returns The skill's raw SKILL.md contents.
 */
const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

/**
 * Extracts one loop's row from the per-loop seed table, so the Retirement cell
 * is asserted in place. Scoped past the `### Per-loop seed defaults` heading
 * because the earlier registration table carries identically-prefixed rows.
 * @param content The `lisa-setup-automations` skill body.
 * @param loop The loop-id whose seed row is wanted.
 * @returns The matching table row, or an empty string when absent.
 */
const seedRow = (content: string, loop: string): string => {
  const seedTable = content.slice(
    content.indexOf("### Per-loop seed defaults")
  );
  return (
    seedTable.split("\n").find(line => line.startsWith(`| **${loop}** |`)) ?? ""
  );
};

describe("the runbook seed states a retirement condition per loop (#1801)", () => {
  describe.each(ROOTS)(`%s/${SETUP}`, root => {
    const content = readSkill(root, SETUP);

    it("declares the section mandatory, non-empty, and never an ad-hoc counter", () => {
      expect(content).toMatch(/mandatory and non-empty/i);
      expect(content).toMatch(/never an ad-hoc counter/i);
      expect(content).toMatch(/stateless/i);
      // Valid substrates only: the tracker, or RBC-3's bounded run history.
      expect(content).toContain(".lisa/automations/runs/<loop-id>.jsonl");
      expect(content).toContain(CONTRACT);
    });

    it.each(STRUCTURAL_LOOP_IDS)(
      "seeds %s as structural — it says plainly that it does not retire",
      loop => {
        const row = seedRow(content, loop);
        expect(row).toMatch(/Structural to the factory/);
        expect(row).toMatch(/does not retire/);
        expect(row).not.toMatch(BOTH_HOLD);
      }
    );

    it.each(QUIET_WINDOW_LOOP_IDS)(
      "seeds %s with the contract's two-part quiet-window shape",
      loop => {
        const row = seedRow(content, loop);
        expect(row).toMatch(BOTH_HOLD);
        expect(row).toMatch(/date-filtered/);
        expect(row).toMatch(/trailing 30-day window/);
        expect(row).toMatch(/AND this run (found|proposed) nothing/);
      }
    );

    it("keeps the gardener's six-week condition in the shared template", () => {
      const row = seedRow(content, "learnings-audit");
      expect(row).toMatch(BOTH_HOLD);
      expect(row).toMatch(/trailing six-week window/);
      expect(row).toMatch(/AND this run proposed nothing/);
    });
  });
});

describe("loops conform to the policy-obsolete teardown-proposal flow (#1801)", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(RETIRING_LOOP_SKILLS)("%s files one proposal", (slug, id) => {
      const content = readSkill(root, slug);

      it("reaches the outcome by evaluating the runbook's Retirement condition", () => {
        expect(content).toContain(OBSOLETE);
        expect(content).toMatch(/Retirement condition/);
        expect(content).toContain(CONTRACT);
      });

      it("files exactly ONE proposal deduped on the shared retire marker", () => {
        expect(content).toContain(`<!-- ${RETIRE_MARKER}${id} -->`);
        expect(content).toMatch(/\*\*exactly ONE\*\*/);
        expect(content).toContain("lisa-tracker-write");
      });

      it("remembers a declined proposal via the open-and-closed marker search", () => {
        expect(content).toContain(OPEN_AND_CLOSED);
        expect(content).toContain("rejection-detection");
        expect(content).toContain("Proposal rejection memory");
      });

      it("carries the decision-ready packet and its labels", () => {
        expect(content).toContain("status:blocked");
        expect(content).toContain("human-needed");
        expect(content).toMatch(/decision-ready packet/i);
      });

      it("names the three operator responses with the full teardown command", () => {
        expect(content).toContain(TEARDOWN_COMMAND);
        expect(content).toMatch(APPROVE);
        expect(content).toMatch(DECLINE);
        expect(content).toMatch(RE_CADENCE);
        // The RBC-6 close-reason semantic: a decline is closed as Not planned.
        expect(content).toMatch(/\*\*Not planned\*\*/);
      });

      it("keeps running at cadence and never removes its own registration", () => {
        expect(content).toMatch(/keeps running at its normal\s+cadence/i);
        expect(content).toMatch(/never deletes its own\s+registration/i);
      });
    });

    describe.each(STRUCTURAL_LOOP_SKILLS)("%s never retires", slug => {
      const content = readSkill(root, slug);

      it("states the structural-no-retire fact instead of a filing path", () => {
        expect(content).toMatch(/structural to the\s+factory/i);
        expect(content).toMatch(/do(es)? not retire/i);
        expect(content).toContain(OBSOLETE);
      });

      it("files no teardown proposal at all", () => {
        expect(content).not.toContain(RETIRE_MARKER);
      });
    });

    describe(`${TEARDOWN} cross-references the proposal`, () => {
      const content = readSkill(root, TEARDOWN);

      it("names itself the approve answer to a policy-obsolete proposal", () => {
        expect(content).toContain(OBSOLETE);
        expect(content).toMatch(APPROVE);
        expect(content).toMatch(DECLINE);
        expect(content).toMatch(RE_CADENCE);
      });

      it("stays human-invoked — never triggered by a loop", () => {
        expect(content).toMatch(/always human-invoked/i);
        expect(content).toMatch(/never\s+triggered by a loop/i);
        expect(content).toMatch(/never removes its own registration/i);
      });
    });
  });
});
