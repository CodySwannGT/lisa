/**
 * Regression tests for the `/lisa:verify-prd` command + skill scaffold — the
 * read/guard front-half of initiative-level PRD verification.
 *
 * Issue #597 (PRD #553, Story #590, Epic #587): create the verify-prd command +
 * skill scaffold and its read/guard front-half — resolve the PRD across vendors,
 * read its generated top-level child work set by CONSUMING the
 * `prd-lifecycle-rollup` contract (native hierarchy first, machine-readable
 * generated-work section fallback — never reimplementing child enumeration), and
 * confirm every required generated top-level work item is terminal before any
 * empirical verification begins. If any required top-level child is non-terminal,
 * the terminal-child guard STOPS, reports the incomplete child set, and leaves
 * the PRD at `shipped`.
 *
 * This suite asserts the scaffold only: the command and skill exist in both
 * plugin roots, the command has frontmatter and passes `$ARGUMENTS` through,
 * and the skill frontmatter declares its name, description and allowed tools.
 * The skill's guidance prose (the guard, PASS path, FAIL path) is not pinned
 * (#4867). The executable proof that the guard's selection + verdict logic is
 * derivable from the consumed `prd-lifecycle-rollup` contract lives in the
 * sibling `verify-prd-guard-logic.test.ts`.
 *
 * Both plugin roots are asserted (`plugins/src/base` source of truth and the
 * generated `plugins/lisa` artifact), so a missed `bun run build:plugins` that
 * drops a file fails the suite.
 * @module tests/unit/strategies/verify-prd-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Both plugin roots: source of truth and generated artifact. */
const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** Relative path of the pass-through command within a plugin root. */
const COMMAND_REL = "commands/verify-prd.md";
/** Relative path of the skill within a plugin root. */
const SKILL_REL = "skills/lisa-verify-prd/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("verify-prd scaffold (#597)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);

    it("ships both the command and the skill in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
    });

    describe("commands/verify-prd.md", () => {
      const command = read(root, COMMAND_REL);

      it("has command frontmatter and passes $ARGUMENTS through", () => {
        expect(command).toMatch(/^---/);
        expect(command).toMatch(/description:/);
        expect(command).toContain("$ARGUMENTS");
      });
    });

    describe(SKILL_REL, () => {
      const skill = read(root, SKILL_REL);

      it("declares frontmatter name, description, and allowed-tools", () => {
        expect(skill).toMatch(/^---/);
        expect(skill).toMatch(/name:\s*lisa-verify-prd/);
        expect(skill).toMatch(/description:/);
        expect(skill).toMatch(/allowed-tools:/);
        // The vendor read surfaces it resolves (Skill/Bash plus MCP readers).
        expect(skill).toContain("Skill");
        expect(skill).toContain("Bash");
      });
    });
  });
});
