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
/** The contract's two-part test seeded verbatim (the gardener's shape). */
const BOTH_HOLD = /Propose teardown when BOTH hold/;
/** The two-part test plus a domain conjunct — stricter, never divergent. */
const ALL_THREE = /Propose teardown when ALL THREE hold/;
/** The verbatim RBC-6 close-reason footer every loop-filed proposal carries. */
const OPERATOR_FOOTER =
  "To stop this from being raised again, close it as **Not planned**";
/** The precedence clause that keeps policy-obsolete from racing nothing-needed. */
const PRECEDENCE =
  "this row supersedes the `nothing-needed` row when it applies";

/** Loop-ids seeded as structural to the factory — no retirement, ever. */
const STRUCTURAL_LOOP_IDS = [
  "intake-repair",
  "intake-prd",
  "intake-tickets",
] as const;
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
      expect(content).toMatch(/mandatory and non-empty/i);
      expect(content).toMatch(/never an ad-hoc counter/i);
      expect(content).toMatch(/stateless/i);
      expect(content).toMatch(/derived from the tracker/i);
      // Both valid substrates, per the ticket: the tracker OR RBC-3's bounded
      // run history. The run record is the contract's own recorder-written
      // substrate, so it is not the "counter or state file" the contract bans.
      expect(content).toContain(".lisa/automations/runs/<loop-id>.jsonl");
      expect(content).toMatch(/same discipline, not a loosening/);
      expect(content).toContain("automation-run-record.mjs");
      expect(content).toMatch(/Prefer the tracker/);
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

    it("permits a tightening domain conjunct but never a weakened condition", () => {
      expect(content).toMatch(/domain conjunct/i);
      expect(content).toMatch(/strictly\s+tighter and never divergent/i);
      expect(content).toMatch(/never drop or weaken either/i);
    });

    it.each(QUIET_WINDOW_LOOP_IDS)(
      "seeds %s with the quiet-window shape plus its domain conjunct",
      (loop, conjunct) => {
        const row = seedRow(content, loop);
        expect(row).toMatch(ALL_THREE);
        expect(row).toMatch(/date-filtered/);
        expect(row).toMatch(/trailing 30-day window/);
        expect(row).toMatch(/AND this run (found|proposed) nothing/);
        // The domain conjunct is what stops a healthy quiet project from
        // proposing to tear down its own monitoring or exploration.
        expect(row).toMatch(conjunct);
        expect(row).toMatch(/only tightens the contract's two-part test/);
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

      it("still records the outcome and files nothing on a re-fire", () => {
        // AC3: the condition holding again must not mint a duplicate ticket,
        // and must not silently drop the run outcome either.
        expect(content).toMatch(
          /still records `policy-obsolete` and files\s+nothing/
        );
        expect(content).toMatch(/ticket is filed exactly\s+once/);
      });

      it("branches proposal dedupe by open, Not planned, and Completed close state", () => {
        expect(content).toMatch(/\*\*open\*\* suppresses another proposal/i);
        expect(content).toMatch(
          /\*\*Not planned\*\*\s+suppresses another proposal/i
        );
        expect(content).toMatch(
          /\*\*Completed\*\* means the prior approved action happened/i
        );
      });

      it("carries the decision-ready packet and its labels", () => {
        expect(content).toContain("status:blocked");
        expect(content).toContain("human-needed");
        expect(content).toMatch(/decision-ready packet/i);
      });

      it("marks the proposal human-owned so repair-intake leaves it alone", () => {
        expect(content).toMatch(/marks the proposal\s+human-owned/);
        expect(content).toContain("lisa-repair-intake");
        expect(content).toMatch(/never\s+re-dispatches it/);
      });

      it("gives the operator enough evidence to choose a longer cadence", () => {
        expect(content).toMatch(/the\s+loop's current cadence/);
        expect(content).toContain(`.lisa/automations/runs/${id}.jsonl`);
        // Packet field-mapping guidance, so the escalation reads the same
        // way no matter which loop filed it.
        expect(content).toMatch(/Work already attempted\* is the searches/);
        expect(content).toMatch(/keeps consuming schedule\s+slots/);
      });

      it("carries the verbatim RBC-6 operator close-reason footer", () => {
        expect(content).toContain(OPERATOR_FOOTER);
      });

      it("names the three operator responses with the full teardown command", () => {
        expect(content).toContain(TEARDOWN_COMMAND);
        expect(content).toContain(`${TEARDOWN_COMMAND} ${id}`);
        expect(content).toMatch(/only that loop registration goes away/i);
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
        expect(content).toMatch(/structural to the\s+factory/i);
        expect(content).toMatch(/do(es)? not retire/i);
        expect(content).toContain(OBSOLETE);
        // "never reached by design" reads as intent; "unreachable" reads as a
        // gap an implementer forgot to fill.
        expect(content).toMatch(/never reached by design/);
        expect(content).not.toMatch(/`policy-obsolete` — \*\*unreachable/);
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
        expect(content).toMatch(/loop never\s+removes its own registration/i);
      });

      it("tells the operator how to close the proposal after each answer", () => {
        // Approve: teardown actually happened, so Completed is truthful.
        expect(content).toMatch(
          /When it has run, close the proposal as \*\*Completed\*\*/
        );
        expect(content).toMatch(/with the proposal's loop id/i);
        expect(content).toMatch(/only\s+that one registered loop/i);
        // Decline: only Not planned durably suppresses the re-file.
        expect(content).toMatch(
          /close the proposal as \*\*Not planned\*\*.*stops the loop/s
        );
      });

      it("routes re-cadence through setup-automations, never self-adjustment", () => {
        expect(content).toContain("/lisa:setup-automations");
        expect(content).toMatch(/you pick the longer cadence/i);
        expect(content).toMatch(/never adjusts its own schedule/i);
        expect(content).toMatch(/\*\*current cadence\*\* as the baseline/);
      });
    });
  });
});
