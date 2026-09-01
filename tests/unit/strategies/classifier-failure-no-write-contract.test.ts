/**
 * A failed rollup classifier proves no state, so every vendor lane must stop
 * before both lifecycle writes and comment writes.
 * @module tests/unit/strategies/classifier-failure-no-write-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const SKILLS = [
  "lisa-github-sync",
  "lisa-jira-sync",
  "lisa-linear-sync",
  "lisa-tracker-sync",
  "lisa-repair-intake",
] as const;

describe.each(ROOTS)("%s rollup classifier failure", root => {
  it.each(SKILLS)("makes %s a no-write lane", skillName => {
    const skill = readFileSync(
      path.resolve(root, `skills/${skillName}/SKILL.md`),
      "utf8"
    );
    expect(skill).toMatch(/non-zero[\s\S]{0,400}(strict )?\*\*no-write\*\*/i);
    expect(skill).toMatch(
      /(label|transition|save parent state|lifecycle mutation)/i
    );
    expect(skill).toMatch(/comment/i);
  });
});
