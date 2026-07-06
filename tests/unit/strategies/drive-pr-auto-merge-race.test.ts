/**
 * Regression tests for issue #1395: auto-merge must not stay armed while a
 * later fix commit is still being pushed or queued for checks.
 *
 * Both source and generated plugin roots are asserted so a missed
 * `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/drive-pr-auto-merge-race
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
] as const;

const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf8");

describe.each(ROOTS)("drive-pr-to-merge auto-merge race guard (%s)", root => {
  const content = readSkill(root, "lisa-drive-pr-to-merge");

  it("checks the live PR head before enabling auto-merge", () => {
    expect(content).toMatch(/headRefOid/);
    expect(content).toMatch(/Never enable\s+auto-merge against a stale head/i);
  });

  it("requires auto-merge to be disarmed or treated as race-prone before fix pushes", () => {
    expect(content).toMatch(/disablePullRequestAutoMerge/);
    expect(content).toMatch(/Do not leave auto-merge armed/i);
    expect(content).toMatch(/required fix, CodeRabbit follow-up/i);
  });

  it("resets verify_commit to the pushed head before re-enabling auto-merge", () => {
    expect(content).toMatch(
      /reset\s+`verify_commit` to the returned\/pushed head/i
    );
    expect(content).toMatch(/wait for that head's checks to start/i);
    expect(content).toMatch(/failed drive-to-merge outcome/i);
  });
});
