/**
 * Regression tests for issue #730: PRD writers and tracker writers must preserve
 * the managed Lisa Usage ledger instead of dropping or duplicating it during
 * updates.
 *
 * The writers' guidance prose is reviewed, not pinned. What stays pinned is the
 * machine-read `## Lisa Usage` heading, which the usage-accounting parser
 * locates the ledger by: every writer must carry it so an agent following the
 * writer preserves the section the parser reads.
 *
 * Assert both the upstream source skills and the generated plugin artifacts so
 * `bun run build:plugins` remains a required parity step.
 * @module tests/unit/strategies/usage-accounting-writer-preservation
 */
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { committedCaseKeys } from "../../helpers/committed-case-table.js";

const ROOTS = ["plugins/src/base/skills", "plugins/lisa/skills"] as const;
const USAGE_SECTION = "## Lisa Usage";

const readSkill = (root: string, skill: string): string =>
  readFileSync(path.resolve(root, skill, "SKILL.md"), "utf8");

const skillRoots = (skill: string): string[] =>
  ROOTS.filter(root => existsSync(path.resolve(root, skill, "SKILL.md")));

/**
 * The roots a writer's cases run over, with a guard that fails if any vanish.
 *
 * `skillRoots` is a filesystem probe, so a renamed, moved or unbuilt SKILL.md
 * silently shrinks it — and `describe.each` over the shrunken list registers
 * fewer cases with nothing red, which is the whole defect
 * (CodySwannGT/lisa#3043). Both roots are expected for every writer: the
 * upstream source and the generated plugin artifact, which is exactly the
 * parity `bun run build:plugins` exists to keep.
 * @param skill - The writer skill id.
 * @returns The roots that hold it.
 */
const guardedSkillRoots = (skill: string): string[] => {
  const roots = skillRoots(skill);
  committedCaseKeys(`${skill} root`, roots, ROOTS);
  return roots;
};

describe("writer shims preserve managed Lisa Usage ledgers", () => {
  describe.each(ROOTS)("%s", root => {
    it("PRD write shim carries the canonical usage heading", () => {
      expect(readSkill(root, "lisa-prd-source-write")).toContain(USAGE_SECTION);
    });

    it("tracker write shim carries the canonical usage heading", () => {
      expect(readSkill(root, "lisa-tracker-write")).toContain(USAGE_SECTION);
    });
  });
});

describe("per-vendor PRD writers preserve managed Lisa Usage ledgers", () => {
  const writers = [
    "lisa-github-write-prd",
    "lisa-linear-write-prd",
    "lisa-notion-write-prd",
    "lisa-confluence-write-prd",
  ] as const;

  describe.each(writers)("%s", writer => {
    describe.each(guardedSkillRoots(writer))("%s", root => {
      it("carries the canonical usage heading", () => {
        expect(readSkill(root, writer)).toContain(USAGE_SECTION);
      });
    });
  });
});

describe("per-vendor tracker writers preserve managed Lisa Usage ledgers", () => {
  const writers = [
    "lisa-github-write-issue",
    "lisa-linear-write-issue",
    "lisa-jira-write-ticket",
  ] as const;

  describe.each(writers)("%s", writer => {
    describe.each(guardedSkillRoots(writer))("%s", root => {
      it("carries the canonical usage heading", () => {
        expect(readSkill(root, writer)).toContain(USAGE_SECTION);
      });
    });
  });
});
