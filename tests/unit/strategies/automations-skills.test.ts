/**
 * Regression tests for /setup-automations and /tear-down-automations.
 *
 * These skills are declarative specifications, not scripts: they tell the
 * current runtime which recurring Lisa automations to create/remove, how often,
 * and with which parameters, and the runtime's NATIVE scheduler does the work
 * (Codex automations / Claude /schedule). setup registers the default loops
 * (intake-repair 60m, intake-prd 60m, intake-tickets 10m, exploratory-bugs
 * daily, exploratory-prds daily, monitor daily) plus the opt-in weekly
 * learnings-audit gardener; auto-start-prds/auto-start-tickets map to
 * project-ideation `prd_ready` / exploratory-qa `ready` (default true — autonomous).
 * Registration also scaffolds one checked-in runbook per registered loop
 * (#1796). teardown sweeps the project's `lisa-auto-<project>-*` registration
 * set — no hardcoded roster — and leaves runbook files on disk.
 *
 * Both source and generated plugin roots are asserted.
 * @module tests/unit/strategies/automations-skills
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated roots. */
const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
/** The stable teardown-scoping name prefix. */
const PREFIX = "lisa-auto-<project>-";

/** Proposing-loop skill slugs, shared across the run-outcome + rejection-memory suites. */
const QA = "lisa-exploratory-qa";
const IDEATION = "lisa-project-ideation";
const MONITOR = "lisa-monitor";
const REPAIR = "lisa-repair-intake";
const GARDENER = "lisa-learnings-audit";
const INTAKE = "lisa-intake";

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe("setup-automations is a runtime-branched declarative spec", () => {
  describe.each(ROOTS)("%s/lisa-setup-automations", root => {
    const content = readSkill(root, "lisa-setup-automations");

    it("is declared a specification, not a script (no hand-templating)", () => {
      expect(content).toMatch(/specification, not a script/i);
      expect(content).toMatch(
        /do \*\*not\*\* hand-template|not template schedule files/i
      );
    });

    it("branches on runtime: Codex automations vs Claude /schedule", () => {
      expect(content).toMatch(/Codex.*automations/i);
      expect(content).toMatch(/automation_update/);
      expect(content).toContain("/schedule");
      expect(content).toMatch(/local/);
    });

    it("specifies every registered automation with its command", () => {
      expect(content).toContain("/lisa:repair-intake");
      expect(content).toContain("/lisa:intake");
      expect(content).toContain(QA);
      expect(content).toContain("/lisa:project-ideation");
    });

    it("specifies the cadences (60m / 10m / daily) incl. rrule equivalents", () => {
      expect(content).toMatch(/every \*\*60 minutes\*\*|every 60 minutes/i);
      expect(content).toMatch(/every \*\*10 minutes\*\*|every 10 minutes/i);
      expect(content).toMatch(/once a day/i);
      expect(content).toContain("FREQ=HOURLY;INTERVAL=1");
      expect(content).toContain("FREQ=MINUTELY;INTERVAL=10");
      expect(content).toContain("FREQ=DAILY;INTERVAL=1");
    });

    it("maps the auto-start flags to prd_ready / ready, default true", () => {
      expect(content).toMatch(/auto-start-prds[^]*prd_ready/i);
      expect(content).toMatch(/auto-start-tickets[^]*ready/i);
      // Markdown may bold the value (`default **true**`); tolerate punctuation.
      expect(content).toMatch(/default[^\w]{0,4}true/i);
    });

    it("uses a stable lisa-auto-<project> prefix and is idempotent", () => {
      expect(content).toContain(PREFIX);
      expect(content).toMatch(/idempotent/i);
    });

    it("requires a durable verified Codex checkout and pre-run rebase", () => {
      expect(content).toContain("<project>-automation-main");
      expect(content).toMatch(/non-bare Git work tree|--is-bare-repository/);
      expect(content).toMatch(/fetch the default remote\s+branch/i);
      expect(content).toMatch(/rebase.*origin\/main/i);
    });

    it("only creates exploratory-bugs when the stack ships exploratory-qa", () => {
      // Names the three exploratory-qa stacks (markdown may wrap each in backticks).
      expect(content).toMatch(/expo[^]{0,12}rails[^]{0,16}harper-fabric/);
      expect(content).toMatch(/skip that automation|do not invent/i);
    });

    it("can author files (Write/Edit) so it can scaffold runbooks", () => {
      expect(content).toMatch(/allowed-tools:.*"Write"/);
      expect(content).toMatch(/allowed-tools:.*"Edit"/);
    });

    it("scaffolds one runbook per registered loop, citing the contract", () => {
      expect(content).toContain(".lisa/automations/<loop-id>.runbook.md");
      expect(content).toContain("automation-runbook-contract");
      // Registration-derived, never a fixed list of loop names.
      expect(content).toMatch(/never write a runbook from a fixed list/i);
      // Skipped loops get no runbook.
      expect(content).toMatch(/skipped gets no runbook/i);
    });

    it("refreshes only the machine block and never overwrites operator prose", () => {
      expect(content).toContain("<!-- lisa:machine-resolved:start -->");
      expect(content).toContain("<!-- lisa:machine-resolved:end -->");
      expect(content).toMatch(
        /rewritten wholesale|rewrite the\s+machine-resolved block/i
      );
      expect(content).toMatch(
        /never overwrite, reorder, reword, or\s+delete prose/i
      );
    });

    it("treats a missing runbook as a degradation, never a precondition", () => {
      expect(content).toMatch(/degradation, not a blocker/i);
      expect(content).toMatch(/never a precondition/i);
    });

    it("reports each runbook written and each skipped loop", () => {
      expect(content).toMatch(/list each runbook written/i);
      // Anchored to the report sentence, not a wildcard span across the file.
      expect(content).toMatch(
        /whether it was \*\*created\*\* \(seeded fresh\) or \*\*refreshed\*\*/
      );
      expect(content).toMatch(/runbook because it was not registered/i);
    });

    it("states the consequence and the action on every report line", () => {
      expect(content).toMatch(
        /new files were written under `\.lisa\/automations\/` — commit\s+them/i
      );
      expect(content).toMatch(/runs on defaults and its summaries will lead/i);
      expect(content).toMatch(/re-run\s+`\/lisa:setup-automations` to fix/i);
    });

    it("makes the ownership boundary visible in rendered markdown", () => {
      expect(content).toMatch(
        /Lisa rewrites this section on every \/lisa:setup-automations run — edits here are lost/
      );
      expect(content).toMatch(/Everything below is\s+yours\./);
    });

    it("seeds the ten sections deterministically, per loop", () => {
      expect(content).toMatch(/### Per-loop seed defaults/);
      for (const loop of [
        "intake-repair",
        "intake-prd",
        "intake-tickets",
        "monitor",
        "exploratory-prds",
        "exploratory-bugs",
        "learnings-audit",
      ]) {
        expect(content).toContain(`| **${loop}** |`);
      }
      // The remaining five sections are derived from the loop's own skill file.
      expect(content).toMatch(
        /derived\s+from \*\*that loop's own SKILL\.md\*\*/i
      );
      expect(content).toContain("lisa-learnings-audit/SKILL.md");
      // The seed table must not be mistaken for a roster.
      expect(content).toMatch(/is \*\*not\*\* a roster/i);
    });

    it("inserts a missing section in contract order, never merely appended", () => {
      expect(content).toMatch(
        /insert it \*\*at its position in the contract's ten-section order\*\*/i
      );
      expect(content).toMatch(/never merely\s+appended at the end/i);
    });
  });
});

describe("tear-down-automations removes only this project's lisa-auto set", () => {
  describe.each(ROOTS)("%s/lisa-tear-down-automations", root => {
    const content = readSkill(root, "lisa-tear-down-automations");

    it("is declared a specification, not a script", () => {
      expect(content).toMatch(/specification, not a script/i);
    });

    it("branches on runtime: Codex automations vs Claude /schedule", () => {
      expect(content).toMatch(/Codex.*automations/i);
      expect(content).toContain("/schedule");
    });

    it("scopes removal to the lisa-auto-<project> prefix and never touches others", () => {
      expect(content).toContain(PREFIX);
      expect(content).toMatch(/never.*remove|never.*touch/i);
      expect(content).toMatch(/non-Lisa/i);
    });

    it("is idempotent (already-absent is a no-op)", () => {
      expect(content).toMatch(/idempotent/i);
      expect(content).toMatch(/already absent|no-op/i);
    });

    it("carries no hardcoded loop roster — the registration set is the roster", () => {
      expect(content).toMatch(/membership is registration, not a roster/i);
      expect(content).toMatch(/do \*\*not\*\* work from a fixed list/i);
      // The old defective wording enumerated exactly six loops.
      expect(content).not.toMatch(/the six automations/i);
    });

    it("explicitly covers the opt-in learnings-audit gardener", () => {
      expect(content).toContain("learnings-audit");
      expect(content).toMatch(/gardener/i);
    });

    it("leaves scaffolded runbook files on disk, and says why", () => {
      expect(content).toContain(".lisa/automations/");
      expect(content).toMatch(/leave the runbooks alone|never deletes/i);
      expect(content).toMatch(/written record of what those jobs did/i);
      expect(content).toMatch(/kept on purpose/i);
      expect(content).toMatch(/delete them yourself in git/i);
    });

    it("derives 'already absent' from the expected-fleet resolver", () => {
      expect(content).toContain("resolveExpectedAutomationFleet");
      expect(content).toMatch(/do not invent an expected set of your own/i);
    });
  });
});

/**
 * Loop-conformance to the run-outcome recording contract (RBC-4, #1798).
 *
 * Every registered loop skill declares a Run outcome section citing the
 * `automation-runbook-contract` rule and records via the RBC-3 helper CLI on
 * every exit path. Six skills back the seven registered loop-ids (lisa-intake
 * backs both intake-prd and intake-tickets).
 */
const LOOP_SKILLS = [REPAIR, INTAKE, QA, IDEATION, MONITOR, GARDENER] as const;

describe("registered loops conform to the run-outcome recording contract (#1798)", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(LOOP_SKILLS)("%s", slug => {
      const content = readSkill(root, slug);

      it("carries a Run outcome section", () => {
        // lisa-learnings-audit renames its section to the plural `## Run outcomes`.
        expect(content).toMatch(/## Run outcomes?/);
      });

      it("cites the automation-runbook-contract rule by slug", () => {
        expect(content).toContain("automation-runbook-contract");
      });

      it("requires recording via the RBC-3 helper CLI on every exit path", () => {
        expect(content).toContain("scripts/automation-run-record.mjs");
        expect(content).toContain("--outcome");
        expect(content).toContain("--runbook");
      });

      it("names the never-block degradation rule for recording failures", () => {
        expect(content).toMatch(/degrad/i);
        expect(content).toMatch(/never\s+(block|abort)/i);
      });
    });
  });
});

describe("lisa-intake keeps the blocked-is-a-successful-run seam explicit (#1798)", () => {
  describe.each(ROOTS)("%s/lisa-intake", root => {
    const content = readSkill(root, "lisa-intake");

    it("states that routing to Blocked is candidate-proposed, never recovery-required", () => {
      // Flatten prose line-wraps so the seam is checked as one statement.
      const flat = content.replace(/\s+/g, " ");
      const blockedIdx = flat.indexOf("routes to `Blocked`");
      const successIdx = flat.indexOf("successful run — `candidate-proposed`");
      const neverIdx = flat.indexOf("never `recovery-required`");
      expect(blockedIdx).toBeGreaterThanOrEqual(0);
      expect(successIdx).toBeGreaterThan(blockedIdx);
      expect(neverIdx).toBeGreaterThan(successIdx);
    });

    it("records under both per-mode loop-ids", () => {
      expect(content).toContain("intake-prd");
      expect(content).toContain("intake-tickets");
    });
  });
});

/**
 * Proposal rejection memory conformance (RBC-6, #1800).
 *
 * Every proposing loop cites the ONE shared `rejection-detection` "Proposal
 * rejection memory" contract. Fresh filing loops either carry their direct
 * closed-item search wording or delegate to their owning rule; monitor delegates
 * the fingerprint/idempotency details to `observability-audit`. The gardener is
 * the shipped precedent (citation only). exploratory-qa's old closed-blind
 * sentence is gone.
 */
const OPEN_AND_CLOSED = "open AND closed";
const NOT_PLANNED = 'stateReason == "not_planned"';
const OPERATOR_FOOTER =
  "To stop this from being raised again, close it as **Not planned**";
const REFILE_ACK = "so we're raising it once more for your review";
const RECOVERY_EXEMPLAR = "restore credentials; nothing was filed this run";

/** All five proposing loops cite the shared contract. */
const PROPOSING_LOOPS = [QA, IDEATION, MONITOR, REPAIR, GARDENER] as const;
/** Fresh-candidate proposers that own direct closed-search wording. */
const CLOSED_SEARCH_PROPOSERS = [QA, IDEATION, REPAIR] as const;
/** The loops that FILE a proposal ticket carry the operator footer. */
const FOOTER_LOOPS = [QA, MONITOR, IDEATION, REPAIR, GARDENER] as const;
/** The three that surface a suppression count in their run outcome. */
const RUN_OUTCOME_PROPOSERS = [QA, IDEATION, MONITOR] as const;
/** Fresh-candidate proposers that own direct re-file wording. */
const REFILE_TONE_PROPOSERS = [QA, IDEATION, REPAIR] as const;

describe("proposing loops consult the shared rejection-memory contract (#1800)", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(PROPOSING_LOOPS)("%s", slug => {
      const content = readSkill(root, slug);

      it("cites the rejection-detection Proposal rejection memory section", () => {
        expect(content).toContain("rejection-detection");
        expect(content).toContain("Proposal rejection memory");
      });
    });

    // The gardener already ships that discipline (citation only), so it is
    // exempt from the closed-search wording pin.
    describe.each(CLOSED_SEARCH_PROPOSERS)(
      "%s closed-inclusive decline search",
      slug => {
        const content = readSkill(root, slug);

        it("searches open AND closed and keys suppression on not_planned", () => {
          expect(content).toContain(OPEN_AND_CLOSED);
          expect(content).toContain(NOT_PLANNED);
        });
      }
    );

    describe("lisa-exploratory-qa splits completed (regression) from not_planned (decline)", () => {
      const content = readSkill(root, QA);

      it("distinguishes closed-as-completed from closed-as-not-planned", () => {
        expect(content).toMatch(/Closed as _completed_/);
        expect(content).toMatch(/Closed as _not planned_/);
        expect(content).toMatch(/regression/i);
      });

      it("drops the old closed-blind sentence", () => {
        expect(content).not.toContain(
          "A *closed* prior ticket does not suppress a new one"
        );
      });
    });

    describe("lisa-monitor delegates its idempotency contract", () => {
      const content = readSkill(root, MONITOR);

      it("points to observability-audit instead of restating the full decline contract", () => {
        expect(content).toContain("observability-audit");
        expect(content).toContain("current fingerprint/idempotency contract");
        expect(content).toContain("open-and-closed search");
        expect(content).not.toContain(REFILE_ACK);
      });
    });

    // Fresh-candidate proposers surface the suppression count in a
    // nothing-needed run and escalate an unreadable memory check to
    // recovery-required rather than a silent nothing-needed.
    describe.each(RUN_OUTCOME_PROPOSERS)("%s run-outcome wiring", slug => {
      const content = readSkill(root, slug);

      it("names the suppression count on a nothing-needed run", () => {
        expect(content).toMatch(/suppression count/i);
      });

      it("escalates an unreadable memory check to recovery-required", () => {
        expect(content).toMatch(/rejection-memory.*could not (run|read)/i);
        expect(content).toContain("recovery-required");
      });

      it("pins the operator-readable recovery-required exemplar", () => {
        expect(content).toContain(RECOVERY_EXEMPLAR);
      });
    });

    // Every loop that files a proposal ticket teaches the close-reason via the
    // operator footer so the not_planned-vs-completed choice is visible.
    describe.each(FOOTER_LOOPS)("%s teaches the close-reason", slug => {
      const content = readSkill(root, slug);

      it("carries the required operator close-reason footer", () => {
        expect(content).toContain(OPERATOR_FOOTER);
      });
    });

    // The fresh-candidate proposers that own direct filing wording write a human
    // acknowledgment sentence when re-filing a previously declined proposal.
    describe.each(REFILE_TONE_PROPOSERS)("%s re-file tone", slug => {
      const content = readSkill(root, slug);

      it("re-files with a human acknowledgment sentence", () => {
        expect(content).toContain(REFILE_ACK);
      });
    });
  });
});
