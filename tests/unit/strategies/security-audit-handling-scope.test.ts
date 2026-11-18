/**
 * The audit's failure message must name the `lisa-security-audit-handling`
 * skill (#4521), so an agent that hits a failing audit is pointed at the
 * fix ladder (#4931: refresh, upgrade, override, replace). Checked in the distributed
 * script and the repository's own copy.
 * @module tests/unit/strategies/security-audit-handling-scope
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The remediation order (CodySwannGT/lisa#4931, matching #5024's
 * reachability-before-code-change rung): how the skill and the failure
 * message write each step.
 */
const LADDER = [
  {
    skill: "**Refresh the lockfile within the current range.**",
    message: "refresh the lockfile within its current range",
  },
  {
    skill: "**Upgrade the direct dependency**",
    message: "upgrade the direct dependency",
  },
  {
    skill: "**Add a targeted override**",
    message: "add a targeted override to the fixed version",
  },
  {
    skill:
      "**Evaluate reachability, and exclude with a stated reason if unaffected**",
    message: "evaluate reachability",
  },
  {
    skill: "**Replace or remove the dependency**",
    message: "replace or remove the dependency",
  },
] as const;

describe("security-audit-handling is named by the audit", () => {
  it("is named by the audit's failure message", () => {
    for (const script of [
      "all/copy-overwrite/scripts/lisa-audit.mjs",
      "scripts/lisa-audit.mjs",
    ])
      expect(readFileSync(script, "utf8"), script).toContain(
        "lisa-security-audit-handling"
      );
  });

  it("teaches the five steps in order, reachability before replace", () => {
    const skill = readFileSync(
      "plugins/src/base/skills/lisa-security-audit-handling/SKILL.md",
      "utf8"
    );
    const offsets = LADDER.map(step => skill.indexOf(step.skill));
    expect(
      offsets.filter(offset => offset < 0),
      "steps missing"
    ).toEqual([]);
    expect(
      [...offsets].sort((x, y) => x - y),
      "steps out of order"
    ).toEqual(offsets);
    expect(skill).toContain(
      "add a scoped exclusion with a concrete reason to `audit.ignore.local.json`"
    );
  });

  it("files a build-ready ticket instead of assuming a human", () => {
    const skill = readFileSync(
      "plugins/src/base/skills/lisa-security-audit-handling/SKILL.md",
      "utf8"
    );
    expect(skill).toContain("**file a build-ready ticket**");
    expect(skill).toContain(
      "the advisory, the dependency path that reaches the vulnerable copy, and what was tried at each of the five steps"
    );
    expect(skill).toContain(
      "Stop only when the next act needs access you do not have, and then say exactly what is missing."
    );
    expect(skill).not.toMatch(/stop for a human/iu);
  });

  it("prints the five steps in order in every failure message", () => {
    for (const script of [
      "all/copy-overwrite/scripts/lisa-audit.mjs",
      "scripts/lisa-audit.mjs",
      ".github/actions/dependency-audit/run.mjs",
    ]) {
      const lines = readFileSync(script, "utf8")
        .split("\n")
        .filter(line => line.includes("Next step:"));
      expect(lines, script).toHaveLength(1);
      const offsets = LADDER.map(step => lines[0]!.indexOf(step.message));
      expect(
        offsets.filter(offset => offset < 0),
        script
      ).toEqual([]);
      expect(
        [...offsets].sort((x, y) => x - y),
        script
      ).toEqual(offsets);
      expect(lines[0], script).toContain("audit.ignore.local.json");
    }
  });
});
