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
/** The full slash-command name a proposal must name for the approve path. */
const TEARDOWN_COMMAND = "/lisa:tear-down-automations";
/** The scaffold skill that seeds each runbook's Retirement condition. */
const SETUP = "lisa-setup-automations";
/** The human-invoked skill that honors an approved proposal. */
const TEARDOWN = "lisa-tear-down-automations";
/** The two-part test plus a domain conjunct — stricter, never divergent. */
const ALL_THREE = /Propose teardown when ALL THREE hold/;
/** The precedence clause that keeps policy-obsolete from racing nothing-needed. */
const PRECEDENCE =
  "this row supersedes the `nothing-needed` row when it applies";
/**
 * Loop-ids seeded with the two-part test PLUS a domain conjunct, paired with
 * that conjunct. Silence alone means obsolescence only for the gardener: a
 * quiet month on a monitored or explored project usually means it is healthy,
 * so those loops must also observe that their subject matter is gone.
 */
const QUIET_WINDOW_LOOP_IDS = [
  ["monitor", /no connected observability surfaces left/],
  ["exploratory-prds", /no unresolved PRD pressure exists/],
  ["exploratory-bugs", /no longer ships an exploratory-qa command surface/],
] as const;
/** The three loops whose Run-outcome table carries a policy-obsolete row. */
const PRECEDENCE_LOOP_SKILLS = [
  "lisa-exploratory-qa",
  "lisa-project-ideation",
  "lisa-monitor",
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
      // Both valid substrates, per the ticket: the tracker OR RBC-3's bounded
      // run history. The run record is the contract's own recorder-written
      // substrate, so it is not the "counter or state file" the contract bans.
      expect(content).toContain(".lisa/automations/runs/<loop-id>.jsonl");
      expect(content).toContain("automation-run-record.mjs");
      expect(content).toContain(CONTRACT);
    });

    it.each(QUIET_WINDOW_LOOP_IDS)(
      "seeds %s with the quiet-window shape plus its domain conjunct",
      (loop, _conjunct) => {
        const row = seedRow(content, loop);
        expect(row).toMatch(ALL_THREE);
      }
    );
  });
});

describe("loops conform to the policy-obsolete teardown-proposal flow (#1801)", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(RETIRING_LOOP_SKILLS)("%s files one proposal", (slug, id) => {
      const content = readSkill(root, slug);

      it("reaches the outcome by evaluating the runbook's Retirement condition", () => {
        expect(content).toContain(OBSOLETE);
        expect(content).toContain(CONTRACT);
      });

      it("files exactly ONE proposal deduped on the shared retire marker", () => {
        expect(content).toContain(`<!-- ${RETIRE_MARKER}${id} -->`);
        expect(content).toContain("lisa-tracker-write");
      });

      it("remembers a declined proposal via the open-and-closed marker search", () => {
        expect(content).toContain("rejection-detection");
      });

      it("still records the outcome and files nothing on a re-fire", () => {
        // AC3: the condition holding again must not mint a duplicate ticket,
        // and must not silently drop the run outcome either.
        expect(content).toMatch(
          /still records `policy-obsolete` and files\s+nothing/
        );
      });

      it("files build-ready with the loop's own call under access-only (#4687)", () => {
        expect(content).toMatch(
          /\*\*Labels\*\* follow `humanGate\.mode`\. Under the default `access-only` the loop makes the call\s+itself/
        );
        expect(content).toMatch(
          /files the proposal build-ready \(`status:ready`\), so the\s+factory run that claims it performs that response/
        );
      });

      it("carries the decision-ready packet and its labels under strict", () => {
        expect(content).toMatch(
          /Under `strict`: `status:blocked` \+\s+`human-needed`, carrying the contract's decision-ready packet/
        );
      });

      it("marks the strict-mode proposal human-owned so repair-intake leaves it alone", () => {
        expect(content).toContain("lisa-repair-intake");
      });

      it("gives the operator enough evidence to choose a longer cadence", () => {
        expect(content).toContain(`.lisa/automations/runs/${id}.jsonl`);
      });

      it("names the three operator responses with the full teardown command", () => {
        expect(content).toContain(TEARDOWN_COMMAND);
        expect(content).toContain(`${TEARDOWN_COMMAND} ${id}`);
      });
    });

    it.each(PRECEDENCE_LOOP_SKILLS)(
      "%s's policy-obsolete row supersedes its nothing-needed row",
      slug => {
        // Both rows describe a run that proposed nothing; without an explicit
        // precedence clause the exit-path table is ambiguous.
        expect(readSkill(root, slug)).toContain(PRECEDENCE);
      }
    );

    describe.each(STRUCTURAL_LOOP_SKILLS)("%s never retires", slug => {
      const content = readSkill(root, slug);

      it("states the structural-no-retire fact instead of a filing path", () => {
        expect(content).toContain(OBSOLETE);
        expect(content).not.toMatch(/`policy-obsolete` — \*\*unreachable/);
      });
    });

    describe(`${TEARDOWN} cross-references the proposal`, () => {
      const content = readSkill(root, TEARDOWN);

      it("names itself the approve answer to a policy-obsolete proposal", () => {
        expect(content).toContain(OBSOLETE);
      });

      it("routes re-cadence through setup-automations, never self-adjustment", () => {
        expect(content).toContain("/lisa:setup-automations");
      });
    });
  });
});
