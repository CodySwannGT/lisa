/**
 * The audit's failure message must name the `lisa-security-audit-handling`
 * skill (#4521), so an agent that hits a failing audit is pointed at the
 * fix ladder (#4931: refresh, upgrade, override, replace). Checked in the distributed
 * script and the repository's own copy.
 * @module tests/unit/strategies/security-audit-handling-scope
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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

  it("teaches the four fixes and never an exclusion as the remedy", () => {
    const skill = readFileSync(
      "plugins/src/base/skills/lisa-security-audit-handling/SKILL.md",
      "utf8"
    );
    for (const step of [
      "Refresh the lockfile within the current range",
      "Upgrade the direct dependency",
      "Add a targeted override",
      "Replace or remove the dependency",
    ])
      expect(skill).toContain(step);
    expect(skill).not.toMatch(/add (?:it|an exclusion entry) to/iu);
  });

  it("files a build-ready ticket instead of assuming a human", () => {
    const skill = readFileSync(
      "plugins/src/base/skills/lisa-security-audit-handling/SKILL.md",
      "utf8"
    );
    expect(skill).toContain("**file a build-ready ticket**");
    expect(skill).toContain(
      "the advisory, the dependency path that reaches the vulnerable copy, and what was tried at each of the four steps"
    );
    expect(skill).toContain(
      "Stop only when the next act needs access you do not have, and then say exactly what is missing."
    );
    expect(skill).not.toMatch(/stop for a human/iu);
  });

  it("never advertises an exclusion file in the failure message", () => {
    for (const script of [
      "all/copy-overwrite/scripts/lisa-audit.mjs",
      "scripts/lisa-audit.mjs",
      ".github/actions/dependency-audit/run.mjs",
    ]) {
      const nextStep = readFileSync(script, "utf8")
        .split("\n")
        .filter(line => line.includes("Next step:"));
      expect(nextStep, script).toHaveLength(1);
      expect(nextStep[0], script).not.toContain("audit.ignore");
    }
  });
});
