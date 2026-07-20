/**
 * Prose contract for the claim-time `last_confirmed` bump (#1579).
 *
 * Every build-intake flow must confirm demonstrably-applied learnings at the
 * end of step 3c through the surgical `confirmLearningEntry` writer, with the
 * "presence in context is NOT application" bar and the never-block guarantee.
 * The project-learnings reference rule documents the same contract. These are
 * agent instructions, so the assertions cover the canonical source and every
 * checked-in runtime projection.
 * @module tests/unit/strategies/learnings-confirmation-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PLUGIN_ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa/.codex-plugin",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
] as const;

const BUILD_INTAKE_SKILLS = [
  "lisa-jira-build-intake",
  "lisa-github-build-intake",
  "lisa-linear-build-intake",
] as const;

// Per-agent parity gaps (documented, not silently dropped): Antigravity ships
// no rules/ tree (Lisa reconciles a bounded AGENTS.md bridge instead), and the
// Codex overlay (`plugins/lisa/.codex-plugin`) distributes skills only — its
// SKILL.md pointer surface has no rules projection — so neither appears below.
// Cursor flattens the eager+reference pair into .mdc files. Assert each
// projection where the reference body actually lives.
const REFERENCE_RULE_PATHS = [
  "plugins/src/base/rules/reference/project-learnings.md",
  "plugins/lisa/rules/reference/project-learnings.md",
  "plugins/lisa-cursor/rules/project-learnings-reference.mdc",
  "plugins/lisa-copilot/rules/reference/project-learnings.md",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

describe.each(PLUGIN_ROOTS)("claim-time confirmation contract (%s)", root => {
  it.each(BUILD_INTAKE_SKILLS)(
    "%s hooks the last_confirmed bump into the end of step 3c",
    skillName => {
      const skill = read(`${root}/skills/${skillName}/SKILL.md`);
      const section = skill.slice(
        skill.indexOf("#### 3c.2 Confirm applied learnings"),
        skill.indexOf("#### 3d.")
      );

      expect(section).toContain("confirmLearningEntry");
      expect(section).toContain("@codyswann/lisa/learnings");
      expect(section).toContain("resolveProjectLearningsFile");
      expect(section).toMatch(/Presence in context is NOT application/);
      // #1802: the rationale is the contract's bounded projection, never the
      // retired "loaded eagerly into every session" premise.
      expect(section).not.toMatch(/loaded eagerly/);
      expect(section).toMatch(/bounded projection/);
      expect(section).toMatch(/explicitly cited or observably followed/);
      expect(section).toMatch(/advances ONLY `last_confirmed`/);
      expect(section).toMatch(/idempotent within a claim/);
      expect(section).toMatch(/bumped once, not once per application/);
      expect(section).toMatch(/failure-safe by construction/);
      expect(section).toMatch(/\|\| true/);
      expect(section).toMatch(/never abort the lifecycle/);
      expect(section).toMatch(/Never block on it/);
    }
  );
});

describe.each(REFERENCE_RULE_PATHS)(
  "project-learnings reference rule (%s)",
  rulePath => {
    it("documents the claim-time confirmation bar", () => {
      const rule = read(rulePath);

      expect(rule).toContain("## Claim-time confirmation (`last_confirmed`)");
      expect(rule).toContain("confirmLearningEntry");
      expect(rule).toMatch(/demonstrably applied/);
      expect(rule).toMatch(/NOT application/);
      expect(rule).toMatch(/never\s+blocks the build/);
    });
  }
);
