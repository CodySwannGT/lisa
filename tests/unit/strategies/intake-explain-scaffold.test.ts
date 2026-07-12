/**
 * Regression tests for the `/lisa:intake-explain` command + skill scaffold.
 *
 * Issue #843 introduces the initial distribution surfaces for the per-item
 * intake/repair diagnosis flow: the base command file, the base skill scaffold,
 * and the generated `plugins/lisa` artifact mirror. The lifecycle readers,
 * verdict renderer, vendor adapters, and read-only smoke coverage land in the
 * follow-up tickets under PRD #838.
 *
 * This suite proves the scaffold shipped in both plugin roots and documents the
 * intended contract clearly enough for later implementation work:
 *   (1) the command delegates to `/lisa:intake-explain`;
 *   (2) the skill is read-only and scoped to one repo/project item;
 *   (3) the skill reuses `lisa-intake` / `repair-intake` contract semantics rather
 *       than inventing a second source of truth;
 *   (4) the skill names the expected verdict families and supported vendors;
 *   (5) the skill defines a stable per-item output shape and next-action model.
 *
 * Both plugin roots are asserted so a missed `bun run build:plugins` fails the
 * suite.
 * @module tests/unit/strategies/intake-explain-scaffold
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const COMMAND_REL = "commands/intake-explain.md";
const SKILL_REL = "skills/lisa-intake-explain/SKILL.md";

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("intake-explain scaffold (#843)", () => {
  describe.each(PLUGIN_ROOTS)("%s", root => {
    const commandPath = path.resolve(root, COMMAND_REL);
    const skillPath = path.resolve(root, SKILL_REL);

    it("ships the command and skill in this plugin root", () => {
      expect(existsSync(commandPath)).toBe(true);
      expect(existsSync(skillPath)).toBe(true);
    });

    it("uses a pass-through command that delegates to /lisa:intake-explain", () => {
      const command = read(root, COMMAND_REL);

      expect(command).toMatch(/^---/);
      expect(command).toMatch(/description:/);
      expect(command).toContain('argument-hint: "<item-ref>"');
      expect(command).toMatch(/Use the \/lisa-intake-explain skill/);
      expect(command).toContain("$ARGUMENTS");
    });

    it("documents a read-only, single-item operator surface", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/^---/);
      expect(skill).toMatch(/name:\s*lisa-intake-explain/);
      expect(skill).toMatch(/allowed-tools:/);
      expect(skill).toContain("Skill");
      expect(skill).toContain("Bash");
      expect(skill).toContain("Read");
      expect(skill).toMatch(/read-only/i);
      expect(skill).toMatch(/one specific item|exactly one repo-scoped item/i);
      expect(skill).toMatch(/current repo|current project/i);
      expect(skill).toMatch(
        /do \*\*not\*\* ask for confirmation|do not ask for confirmation/i
      );
    });

    it("reuses intake and repair-intake contract semantics", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/intake/);
      expect(skill).toMatch(/repair-intake/);
      expect(skill).toMatch(/same contract/i);
      expect(skill).toMatch(
        /do \*\*not\*\* invent a second source of truth|do not invent a second source of truth/i
      );
      expect(skill).toMatch(/queue detection|queue source/i);
      expect(skill).toMatch(/lifecycle role/i);
      expect(skill).toMatch(/staleness/i);
      expect(skill).toMatch(/backoff|loop-prevention/i);
    });

    it("names the expected verdict families and supported vendors", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/ELIGIBLE_FOR_INTAKE/);
      expect(skill).toMatch(/ELIGIBLE_FOR_REPAIR/);
      expect(skill).toMatch(/WAITING_ON_STALENESS/);
      expect(skill).toMatch(/HELD_BY_BLOCKERS/);
      expect(skill).toMatch(/NON_LEAF_CONTAINER/);
      expect(skill).toMatch(/PRODUCT_OWNED_STATE/);
      expect(skill).toMatch(/MISCONFIGURED/);
      expect(skill).toMatch(/GitHub/);
      expect(skill).toMatch(/Linear/);
      expect(skill).toMatch(/JIRA/);
      expect(skill).toMatch(/Notion/);
      expect(skill).toMatch(/Confluence/);
    });

    it("documents the key gate families and next-action handoff", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/leaf-only/i);
      expect(skill).toMatch(/repo-scope/i);
      expect(skill).toMatch(/active blocker|dependency hold/i);
      expect(skill).toMatch(/product-owned/i);
      expect(skill).toMatch(/Lisa-owned/i);
      expect(skill).toMatch(/\/lisa:intake/);
      expect(skill).toMatch(/\/lisa:repair-intake/);
      expect(skill).toMatch(/manual product clarification|decomposition/i);
    });

    it("defines a stable per-item output shape", () => {
      const skill = read(root, SKILL_REL);

      expect(skill).toMatch(/Item: <identity>/);
      expect(skill).toMatch(/Lifecycle: <PRD\|BUILD>/);
      expect(skill).toMatch(/Role: <current role>/);
      expect(skill).toMatch(/Verdict: <VERDICT>/);
      expect(skill).toMatch(/Why: <rule or gate explanation>/);
      expect(skill).toMatch(/Next action: <smallest useful follow-up>/);
      expect(skill).toMatch(/Signals:|Relevant refs:/);
    });
  });
});
