/**
 * Regression tests for decomposition-time multi-repo container guidance.
 *
 * Issue #703 clarifies that a source PRD and coordination containers may span
 * repositories, while every build-ready leaf work unit must still resolve to
 * exactly one repository before ticket creation.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/multi-repo-container-decomposition
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

describe("task-decomposition preserves cross-repo containers", () => {
  const content = readFileSync(
    path.resolve("plugins/src/base/skills/task-decomposition/SKILL.md"),
    "utf8"
  );

  it("allows the source PRD and containers to span repositories", () => {
    expect(content).toMatch(/PRD.*MAY span repos/i);
    expect(content).toMatch(/Epic, Story, Spike.*MAY span repos/i);
  });

  it("requires every buildable leaf work unit to name exactly one repo", () => {
    expect(content).toMatch(
      /Task, Bug, Sub-task, Improvement.*MUST name exactly one repo/i
    );
    expect(content).toMatch(/buildable leaf work units/i);
  });

  it("keeps decomposition-time and work-time repo splitting distinct", () => {
    expect(content).toMatch(/decomposition-time/i);
    expect(content).toMatch(/work-time/i);
    expect(content).toMatch(/already-existing leaf ticket/i);
  });
});

describe("github-to-tracker keeps multi-repo containers but splits leaves", () => {
  describe.each(ROOTS)("%s", root => {
    const content = readSkill(root, "github-to-tracker");

    it("allows the source PRD and containers to remain cross-repo", () => {
      expect(content).toMatch(/PRD may span multiple repositories/i);
      expect(content).toMatch(/Epics.*may stay cross-repo/i);
      expect(content).toMatch(/Stories may span repositories/i);
    });

    it("restricts build-ready leaves to one repository each", () => {
      expect(content).toMatch(
        /every Bug, Task, Sub-task, or Improvement.*exactly one repository/i
      );
      expect(content).toMatch(/status:ready/);
    });
  });
});
