/**
 * The audit's failure message must name the `lisa-security-audit-handling`
 * skill (#4521), so an agent that hits a failing audit is pointed at the
 * fix ladder (#4931: refresh, upgrade, override, reachability, replace).
 * Checked in the distributed script and the repository's own copy.
 *
 * The ladder ends at our own fork, patch or vendored copy (CodySwannGT/lisa#5024):
 * after the upstream fix, last, and only through a declared human gate the
 * classifier accepts. Every shipped copy of the skill and its rule pointer
 * must keep the steps in order, so the exclusion can never move behind a
 * code change and the copy can never move ahead of the others.
 * @module tests/unit/strategies/security-audit-handling-scope
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { classifyHumanGateReason } from "../../../plugins/src/base/scripts/human-gate-act.mjs";

/**
 * The remediation order (CodySwannGT/lisa#4931 and #5024): how the skill,
 * its rule pointer and the failure message write each step.
 */
const LADDER = [
  {
    skill: "**Refresh the lockfile within the current range.**",
    rule: "1. Refresh the lockfile",
    message: "refresh the lockfile within its current range",
  },
  {
    skill: "**Upgrade the direct dependency**",
    rule: "2. Upgrade the direct dependency",
    message: "upgrade the direct dependency",
  },
  {
    skill: "**Add a targeted override**",
    rule: "3. Add a targeted override",
    message: "add a targeted override to the fixed version",
  },
  {
    skill:
      "**Evaluate reachability, and exclude with a stated reason if unaffected**",
    rule: "4. Evaluate reachability",
    message: "evaluate reachability",
  },
  {
    skill: "**Replace or remove the dependency**",
    rule: "5. Replace or remove the dependency",
    message: "replace or remove the dependency",
  },
  {
    skill: "**Contribute the fix upstream**",
    rule: "6. Contribute the fix upstream",
    message: "contribute the fix upstream",
  },
  {
    skill:
      "**Fork, patch or vendor the library — last, and only through a human gate.**",
    rule: "7. Last: fork, patch or vendor the library",
    message: "last, fork, patch or vendor the library",
  },
] as const;

const GATED = LADDER[6];

/** Every shipped copy of the skill, source first. */
const SKILLS = [
  "plugins/src/base/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa/.codex-plugin/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-agy/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-copilot/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-cursor/skills/lisa-security-audit-handling/SKILL.md",
  "plugins/lisa-devin/skills/lisa-security-audit-handling/SKILL.md",
];

/** Every shipped copy of the always-reachable rule pointer, source first. */
const RULES = [
  "plugins/src/base/rules/reference/security-audit-handling.md",
  "plugins/lisa/rules/reference/security-audit-handling.md",
  "plugins/lisa-copilot/rules/reference/security-audit-handling.md",
  "plugins/lisa-cursor/rules/security-audit-handling-reference.mdc",
  "plugins/lisa-devin/rules/reference/security-audit-handling.md",
];

/** Every shipped copy of the internalization kit, source first. */
const KITS = [
  "plugins/src/base/rules/reference/dependency-internalization-kit.md",
  "plugins/lisa/rules/reference/dependency-internalization-kit.md",
  "plugins/lisa-copilot/rules/reference/dependency-internalization-kit.md",
  "plugins/lisa-cursor/rules/dependency-internalization-kit-reference.mdc",
  "plugins/lisa-devin/rules/reference/dependency-internalization-kit.md",
];

/** The scripts whose failure message prints the full seven-step ladder. */
const SCRIPTS = [
  "all/copy-overwrite/scripts/lisa-audit.mjs",
  "scripts/lisa-audit.mjs",
];

/**
 * Assert every step appears, and in ladder order.
 * @param text - The surface under test
 * @param steps - How that surface writes each step
 * @param label - Names the surface in a failure
 */
function expectInOrder(
  text: string,
  steps: readonly string[],
  label: string
): void {
  const offsets = steps.map(step => text.indexOf(step));
  expect(
    steps.filter((_, index) => (offsets[index] ?? -1) < 0),
    `${label}: steps missing`
  ).toEqual([]);
  expect(
    [...offsets].sort((x, y) => x - y),
    `${label}: steps out of order`
  ).toEqual(offsets);
}

/**
 * The single `Next step:` line a script prints.
 * @param script - Repository-relative script path
 * @returns The line
 */
function nextStep(script: string): string {
  const lines = readFileSync(script, "utf8")
    .split("\n")
    .filter(line => line.includes("Next step:"));
  expect(lines, script).toHaveLength(1);
  return lines[0] ?? "";
}

describe("security-audit-handling is named by the audit", () => {
  it("is named by the audit's failure message", () => {
    for (const script of SCRIPTS)
      expect(readFileSync(script, "utf8"), script).toContain(
        "lisa-security-audit-handling"
      );
  });

  it.each(SKILLS)("%s teaches the steps in order", file => {
    const skill = readFileSync(file, "utf8");
    expectInOrder(
      skill,
      LADDER.map(step => step.skill),
      file
    );
    expect(skill).toContain(
      "add a scoped exclusion with a concrete reason to `audit.ignore.local.json`"
    );
  });

  it.each(RULES)("%s lists the steps in order", file => {
    expectInOrder(
      readFileSync(file, "utf8"),
      LADDER.map(step => step.rule),
      file
    );
  });

  it("files a build-ready ticket instead of assuming a human", () => {
    const skill = readFileSync(SKILLS[0] ?? "", "utf8");
    expect(skill).toContain("**file a build-ready ticket**");
    expect(skill).toContain(
      "the advisory, the dependency path that reaches the vulnerable copy, and what was tried at each step"
    );
    expect(skill).toContain(
      "Stop only when the next act needs access you do not have, and then say exactly what is missing."
    );
    expect(skill).not.toMatch(/stop for a human/iu);
  });

  it("prints the first five steps in order in every failure message", () => {
    for (const script of [
      ...SCRIPTS,
      ".github/actions/dependency-audit/run.mjs",
    ]) {
      const line = nextStep(script);
      expectInOrder(
        line,
        LADDER.slice(0, 5).map(step => step.message),
        script
      );
      expect(line, script).toContain("audit.ignore.local.json");
    }
  });

  it.each(SCRIPTS)("%s prints all seven steps in order", script => {
    expectInOrder(
      nextStep(script),
      LADDER.map(step => step.message),
      script
    );
  });
});

describe("our own copy of a library is gated and last (CodySwannGT/lisa#5024)", () => {
  it.each(SKILLS)("%s gates the last step on a filable human gate", file => {
    const text = readFileSync(file, "utf8");
    const gated = text.slice(text.indexOf(GATED.skill));
    const reason = gated.split('human_gate: "')[1]?.split('"')[0];
    expect(reason, "the gated step declares a human_gate reason").toContain(
      "<pkg>"
    );
    const verdict = classifyHumanGateReason(
      reason?.replaceAll("<pkg>", "picomatch")
    );
    expect(verdict.valid).toBe(true);
    expect(verdict.act).toBe("own-dependency-copy");
  });

  it.each(KITS)(
    "%s routes a fork or vendored copy through the one ladder",
    file => {
      const text = readFileSync(file, "utf8");
      expect(text).toContain("step 7");
      expect(text).toContain("lisa-security-audit-handling");
    }
  );
});
