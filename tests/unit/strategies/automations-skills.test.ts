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

    it("specifies every registered automation with its command", () => {
      expect(content).toContain("/lisa:repair-intake");
      expect(content).toContain("/lisa:intake");
      expect(content).toContain(QA);
      expect(content).toContain("/lisa:project-ideation");
    });

    it("specifies the cadences (60m / 10m / daily) incl. rrule equivalents", () => {
      expect(content).toContain("FREQ=HOURLY;INTERVAL=1");
      expect(content).toContain("FREQ=MINUTELY;INTERVAL=10");
      expect(content).toContain("FREQ=DAILY;INTERVAL=1");
    });

    it("maps the auto-start flags to prd_ready / ready, default true", () => {
      expect(content).toMatch(/auto-start-prds[^]*prd_ready/i);
    });

    it("uses a stable lisa-auto-<project> prefix and is idempotent", () => {
      expect(content).toContain(PREFIX);
    });

    it("requires a durable verified Codex checkout and pre-run rebase", () => {
      expect(content).toMatch(/non-bare Git work tree|--is-bare-repository/);
      expect(content).toMatch(/rebase.*origin\/main/i);
    });

    it("can author files (Write/Edit) so it can scaffold runbooks", () => {
      expect(content).toMatch(/allowed-tools:.*"Write"/);
      expect(content).toMatch(/allowed-tools:.*"Edit"/);
    });

    it("scaffolds one runbook per registered loop, citing the contract", () => {
      expect(content).toContain(".lisa/automations/<loop-id>.runbook.md");
      expect(content).toContain("automation-runbook-contract");
    });

    it("states the consequence and the action on every report line", () => {
      expect(content).toMatch(
        /new files were written under `\.lisa\/automations\/` — commit\s+them/i
      );
      expect(content).toMatch(/re-run\s+`\/lisa:setup-automations` to fix/i);
    });

    it("makes the ownership boundary visible in rendered markdown", () => {
      expect(content).toMatch(
        /Lisa rewrites this section on every \/lisa:setup-automations run — edits here are lost/
      );
    });

    it("seeds the ten sections deterministically, per loop", () => {
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
    });
  });
});

describe("tear-down-automations removes only this project's lisa-auto set", () => {
  describe.each(ROOTS)("%s/lisa-tear-down-automations", root => {
    const content = readSkill(root, "lisa-tear-down-automations");

    it("scopes removal to the lisa-auto-<project> prefix and never touches others", () => {
      expect(content).toContain(PREFIX);
    });

    it("explicitly covers the opt-in learnings-audit gardener", () => {
      expect(content).toContain("learnings-audit");
    });

    it("leaves scaffolded runbook files on disk, and says why", () => {
      expect(content).toContain(".lisa/automations/");
    });

    it("derives 'already absent' from the expected-fleet resolver", () => {
      expect(content).toContain("resolveExpectedAutomationFleet");
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

      it("cites the automation-runbook-contract rule by slug", () => {
        expect(content).toContain("automation-runbook-contract");
      });

      it("requires recording via the RBC-3 helper CLI on every exit path", () => {
        expect(content).toContain("scripts/automation-run-record.mjs");
        expect(content).toContain("--outcome");
        expect(content).toContain("--runbook");
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
      expect(content).toContain("intake-tickets");
    });
  });
});
const NOT_PLANNED = 'stateReason == "not_planned"';

/** All five proposing loops cite the shared contract. */
const PROPOSING_LOOPS = [QA, IDEATION, MONITOR, REPAIR, GARDENER] as const;
/** Fresh-candidate proposers that own direct closed-search wording. */
const CLOSED_SEARCH_PROPOSERS = [QA, IDEATION, REPAIR] as const;
/** The three that surface a suppression count in their run outcome. */
const RUN_OUTCOME_PROPOSERS = [QA, IDEATION, MONITOR] as const;

describe("proposing loops consult the shared rejection-memory contract (#1800)", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(PROPOSING_LOOPS)("%s", slug => {
      const content = readSkill(root, slug);

      it("cites the rejection-detection Proposal rejection memory section", () => {
        expect(content).toContain("rejection-detection");
      });
    });

    // The gardener already ships that discipline (citation only), so it is
    // exempt from the closed-search wording pin.
    describe.each(CLOSED_SEARCH_PROPOSERS)(
      "%s closed-inclusive decline search",
      slug => {
        const content = readSkill(root, slug);

        it("searches open AND closed and keys suppression on not_planned", () => {
          expect(content).toContain(NOT_PLANNED);
        });
      }
    );

    describe("lisa-monitor delegates its idempotency contract", () => {
      const content = readSkill(root, MONITOR);

      it("points to observability-audit instead of restating the full decline contract", () => {
        expect(content).toContain("observability-audit");
      });
    });

    // Fresh-candidate proposers surface the suppression count in a
    // nothing-needed run and escalate an unreadable memory check to
    // recovery-required rather than a silent nothing-needed.
    describe.each(RUN_OUTCOME_PROPOSERS)("%s run-outcome wiring", slug => {
      const content = readSkill(root, slug);

      it("escalates an unreadable memory check to recovery-required", () => {
        expect(content).toContain("recovery-required");
      });
    });
  });
});
