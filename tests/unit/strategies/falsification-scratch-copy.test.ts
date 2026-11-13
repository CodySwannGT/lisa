/**
 * Falsification mutations must run on a scratch copy (CodySwannGT/lisa#4760).
 *
 * A falsification step breaks the guarded property, confirms the check fails,
 * and restores. Run in place inside a shared worktree, that break is a write
 * into another agent's files: a verifier's mutate/restore once raced a
 * builder's concurrent edits and briefly deleted code the builder had just
 * written, and a revert that lands after the builder's next save can delete or
 * commit their work. Every surface that tells an agent to "break it and
 * restore" must therefore say where: on a scratch copy (a throwaway detached
 * `git worktree add` or a temp copy of the touched files), never in a worktree
 * another agent is editing.
 *
 * Both roots are checked because `plugins/lisa` is generated from
 * `plugins/src/base`; asserting one side only would let source-or-artifact
 * drift through.
 * @module tests/unit/strategies/falsification-scratch-copy
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/**
 * Every surface that instructs an agent to break a guarded property and
 * restore it. Each must carry the scratch-copy requirement.
 */
const SURFACES = [
  "agents/verification-specialist.md",
  "agents/test-specialist.md",
  "rules/eager/falsifiable-checks.md",
  "rules/reference/falsifiable-checks.md",
  "skills/lisa-codify-verification/SKILL.md",
] as const;

const SCRATCH_COPY = /scratch copy/i;
const NOT_SHARED = /never in a worktree another agent is editing/i;

const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

describe("falsification runs on a scratch copy", () => {
  describe.each(ROOTS)("%s", root => {
    it.each(SURFACES)("%s names the scratch-copy requirement", rel => {
      const text = read(root, rel);
      expect(text, `${root}/${rel}`).toMatch(SCRATCH_COPY);
      expect(text, `${root}/${rel}`).toMatch(NOT_SHARED);
    });

    it("the reference body says how to build and remove the scratch worktree", () => {
      const reference = read(root, "rules/reference/falsifiable-checks.md");
      expect(reference).toContain("git worktree add --detach");
      expect(reference).toContain("git worktree remove --force");
    });

    it("codify-verification no longer breaks the property in place", () => {
      const skill = read(root, "skills/lisa-codify-verification/SKILL.md");
      expect(skill).not.toMatch(/Break the property in place/i);
      expect(skill).not.toMatch(/return to the fix branch/i);
    });
  });
});
