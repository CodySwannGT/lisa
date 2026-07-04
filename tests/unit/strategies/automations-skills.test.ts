/**
 * Regression tests for /setup-automations and /tear-down-automations.
 *
 * These skills are declarative specifications, not scripts: they tell the
 * current runtime which recurring Lisa automations to create/remove, how often,
 * and with which parameters, and the runtime's NATIVE scheduler does the work
 * (Codex automations / Claude /schedule). setup creates five automations
 * (intake-repair 60m, intake-prd 60m, intake-tickets 10m, exploratory-bugs
 * daily, exploratory-prds daily); auto-start-prds/auto-start-tickets map to
 * project-ideation `prd_ready` / exploratory-qa `ready` (default false).
 * teardown removes only the project's `lisa-auto-<project>-*` set.
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

    it("specifies all five automations with their commands", () => {
      expect(content).toContain("/lisa:repair-intake");
      expect(content).toContain("/lisa:intake");
      expect(content).toContain("lisa-exploratory-qa");
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

    it("maps the auto-start flags to prd_ready / ready, default false", () => {
      expect(content).toMatch(/auto-start-prds[^]*prd_ready/i);
      expect(content).toMatch(/auto-start-tickets[^]*ready/i);
      // Markdown may bold the value (`default **false**`); tolerate punctuation.
      expect(content).toMatch(/default[^\w]{0,4}false/i);
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
  });
});
