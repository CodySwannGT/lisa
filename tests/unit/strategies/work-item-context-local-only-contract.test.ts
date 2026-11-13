/**
 * Prose contract keeping the work-item context file local-only (#4323).
 *
 * `.lisa/work-item-context.md` can quote credentials from tracker comments.
 * The shipped `.gitignore` entry reaches a host through `lisa apply`, but the
 * plugin skills that write the file can arrive first — a two-channel skew in
 * which the file is untracked yet not ignored, and `lisa-git-commit`'s
 * commit-everything rule would stage and push it. So every writer proves the
 * path is ignored (adding it to `info/exclude` when it is not) before writing,
 * refuses to write when an `.easignore` would still upload it, and the commit
 * skill carves the file out of commit-everything. Retention is bounded too:
 * intake always overwrites, the resolver accepts only a context-file path, and
 * terminal completion deletes the file.
 *
 * Pinned across the canonical source and every generated skill surface; the
 * handoff is pinned in `work-item-context-handoff-contract.test.ts`.
 * @module tests/unit/strategies/work-item-context-local-only-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

const IMPLEMENT = "lisa-implement";

const WRITERS = [
  "lisa-track",
  IMPLEMENT,
  "lisa-github-build-intake",
  "lisa-jira-build-intake",
  "lisa-linear-build-intake",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const skillPaths = (skill: string): readonly string[] =>
  SKILL_ROOTS.map(root => `${root}/${skill}/SKILL.md`);

const pairs = (
  skills: readonly string[]
): readonly (readonly [string, string])[] =>
  skills.flatMap(skill =>
    skillPaths(skill).map(skillPath => [skill, skillPath] as const)
  );

describe.each(pairs(WRITERS))(
  "%s proves the context file is ignored before writing it (%s)",
  (_skill, skillPath) => {
    const skill = read(skillPath);

    it("adds the path to info/exclude when check-ignore says it is not ignored", () => {
      expect(skill).toContain(
        "`git check-ignore -q .lisa/work-item-context.md || printf '%s\\n' '.lisa/work-item-context.md' >> \"$(git rev-parse --git-common-dir)/info/exclude\"`"
      );
    });
  }
);

describe.each(skillPaths(IMPLEMENT))(
  "lisa-implement bounds the context file's reach and lifetime (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("deletes the context file at terminal completion, alongside clearing the binding", () => {
      expect(skill).toMatch(
        /run `node scripts\/lisa-work-item\.mjs clear`, delete the work-item context file \(`rm -f \.lisa\/work-item-context\.md`/
      );
    });
  }
);
