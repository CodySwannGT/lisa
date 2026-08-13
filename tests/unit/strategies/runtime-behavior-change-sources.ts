/**
 * Shared corpus for the two `runtime_behavior_change` contract suites.
 *
 * `runtime-behavior-change-decidability.test.ts` asserts the contract wording
 * is **present**; `runtime-behavior-change-consistency.test.ts` asserts no copy
 * of it **contradicts** another. They read the same roots, so the roots live
 * here rather than in two hand-maintained lists — two drifting copies of one
 * rule is the precise defect these suites exist to catch, and repeating it in
 * the harness would be self-parody.
 *
 * The split into two files is the 300-line lint ceiling, not a scope boundary.
 * A coverage probe that scores by filename must read both or it will
 * under-report, which is a known false-negative mode in this repo.
 * @module tests/unit/strategies/runtime-behavior-change-sources
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Every generated skill root an agent may actually load. */
export const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

/** Every generated rule root. Cursor keeps a flat `.mdc` layout. */
export const RULE_ROOTS = [
  "plugins/src/base/rules",
  "plugins/lisa/rules",
  "plugins/lisa-cursor/rules",
  "plugins/lisa-copilot/rules",
] as const;

export const SLUG = "derived-branch-plan";
export const FLAG = "runtime_behavior_change";
export const SECTION = "Target Backend Environment";

/** The machine discriminator. Its exact spelling is the contract. */
export const EXEMPT_PREFIX = "None —";

/** The three skills that persist the declaration onto a work item. */
export const WRITERS = [
  "lisa-github-write-issue",
  "lisa-jira-write-ticket",
  "lisa-linear-write-issue",
] as const;

/** The three skills that derive the flag back off a live work item. */
export const VALIDATORS = [
  "lisa-github-validate-issue",
  "lisa-jira-validate-ticket",
  "lisa-linear-validate-issue",
] as const;

/** Every skill carrying a copy of the declaration grammar. */
export const CONTRACT_SKILLS = [
  ...WRITERS,
  ...VALIDATORS,
  "lisa-implement",
] as const;

/**
 * Read one skill's SKILL.md from a generated or source root.
 * @param root - The skills root.
 * @param slug - The skill directory name.
 * @returns The file contents.
 */
export const readSkill = (root: string, slug: string): string =>
  readFileSync(path.resolve(root, slug, "SKILL.md"), "utf-8");

/**
 * Read a rule body, tolerating Cursor's flat `.mdc` layout.
 * @param root - The rules root.
 * @param tier - Either "eager" or "reference".
 * @returns The rule contents.
 */
export const readRule = (root: string, tier: "eager" | "reference"): string => {
  const nested = path.resolve(root, tier, `${SLUG}.md`);
  const flat = path.resolve(
    root,
    tier === "eager" ? `${SLUG}.mdc` : `${SLUG}-reference.mdc`
  );
  try {
    return readFileSync(nested, "utf-8");
  } catch (error) {
    // Fall back only when the nested rule is ABSENT. Catching everything meant
    // a permissions or encoding failure on the nested path was reported
    // against the flat one, sending a maintainer to a file that was never the
    // problem.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readFileSync(flat, "utf-8");
  }
};
