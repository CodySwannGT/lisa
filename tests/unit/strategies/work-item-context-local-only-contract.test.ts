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

const WRITERS = [
  "lisa-track",
  "lisa-implement",
  "lisa-github-build-intake",
  "lisa-jira-build-intake",
  "lisa-linear-build-intake",
] as const;

const BUILD_INTAKE_SKILLS = [
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
      expect(skill).toContain("**Ignore guard before any write.**");
      expect(skill).toContain(
        "`git check-ignore -q .lisa/work-item-context.md || printf '%s\\n' '.lisa/work-item-context.md' >> \"$(git rev-parse --git-common-dir)/info/exclude\"`"
      );
    });

    it("re-checks and stops without writing when the path is still not ignored", () => {
      expect(skill).toMatch(
        /If it is still not ignored, stop and report — do not write the bundle\./
      );
    });

    it("stops when an .easignore would still upload the file", () => {
      expect(skill).toContain(
        "If an `.easignore` exists and `grep -qxF '.lisa/work-item-context.md' .easignore` fails, stop and report instead of writing"
      );
    });
  }
);

describe.each(skillPaths("lisa-git-commit"))(
  "lisa-git-commit never stages the context file (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("carves the context file out of the commit-everything rule", () => {
      expect(skill).toMatch(
        /\*\*Commit ALL Files\*\*[^\n]*\*\*Local-only exception:\*\* never stage `\.lisa\/work-item-context\.md`/
      );
      expect(skill).toMatch(/even when it is untracked and not ignored/);
      expect(skill).toMatch(/Leave it untracked, and say in your report/);
    });

    it("carves the exception into every blanket commit-everything rule", () => {
      // A blanket "Never" rule left unqualified contradicts the exception, and
      // an agent resolving that conflict toward "commit everything" pushes the
      // credentials the exception exists to protect.
      const never = skill.slice(skill.indexOf("### Never"));
      for (const rule of [
        "- stash changes - ALL changes must be committed",
        "- skip or exclude any files from the commit",
        "- leave uncommitted changes in the working directory",
        "- ask the user which files to commit - commit everything",
      ]) {
        const line = never.split("\n").find(l => l.startsWith(rule)) ?? "";
        expect(line).toContain("local-only `.lisa/work-item-context.md`");
      }
      expect(skill).toMatch(
        /Every rule below that says "all" or "everything" excludes the local-only `\.lisa\/work-item-context\.md`/
      );
    });
  }
);

describe.each(pairs(BUILD_INTAKE_SKILLS))(
  "%s never hands over a stale bundle (%s)",
  (_skill, skillPath) => {
    it("always overwrites the file with this cycle's bundle", () => {
      expect(read(skillPath)).toContain(
        "always overwriting the file with this cycle's bundle, never reusing one an earlier item left behind"
      );
    });
  }
);

describe.each(skillPaths("lisa-implement"))(
  "lisa-implement bounds the context file's reach and lifetime (%s)",
  skillPath => {
    const skill = read(skillPath);

    it("refuses a caller bundle path that is not a context file", () => {
      expect(skill).toContain(
        "refuse a `caller_bundle_path` that does not end in `/.lisa/work-item-context.md` — do not read it"
      );
    });

    it("deletes the context file at terminal completion, alongside clearing the binding", () => {
      expect(skill).toMatch(
        /run `node scripts\/lisa-work-item\.mjs clear`, delete the work-item context file \(`rm -f \.lisa\/work-item-context\.md`/
      );
      expect(skill).toMatch(/no current binding and no context file/);
    });
  }
);
