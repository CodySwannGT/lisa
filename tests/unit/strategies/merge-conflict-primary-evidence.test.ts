/**
 * Pins "a merge conflict is proved by a merge trial, not by a cached field" in
 * `lisa-drive-pr-to-merge` and `lisa-repair-intake`, on every agent's copy.
 *
 * `mergeable` and `mergeStateStatus` are computed asynchronously by GitHub and
 * a stale value is served. Measured (#3694): the same field, at the same
 * moment, reported `DIRTY` for two branches while `git merge-tree --write-tree`
 * exited `0` for one and `1` for the other, and a single response carried
 * `mergeable: MERGEABLE` next to `mergeState: DIRTY`. Branching on `DIRTY`
 * alone sent an agent to resolve conflicts that did not exist, and — worse, in
 * the unattended scanner — filed a blocker against a clean pull request.
 *
 * These assertions exist because prose drifts, and because the failure mode has
 * a specific shape that a looser test would not catch: collapsing three states
 * into two. CONFLICTED, CLEAN and NOT DETERMINED must all survive future edits,
 * since a rewrite that keeps the trial but drops the third arm reintroduces the
 * defect in a new place.
 * @module tests/unit/strategies/merge-conflict-primary-evidence
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa/.codex-plugin/skills",
] as const;

const SKILLS = ["lisa-drive-pr-to-merge", "lisa-repair-intake"] as const;

const CASES = ROOTS.flatMap(root =>
  SKILLS.map(slug => ({
    root,
    slug,
    path: path.resolve(root, slug, "SKILL.md"),
  }))
);

describe.each(CASES)(
  "conflict is decided by a merge trial ($root/$slug)",
  ({ path: file }) => {
    const content = readFileSync(file, "utf8");

    it("runs the trial against the live base and head, not a remembered ref", () => {
      // A trial against a stale local ref is its own cached answer wearing the
      // clothes of primary evidence.
      expect(content).toContain("baseRefName");
      expect(content).toContain("headRefOid");
      // A trial against a ref that was never fetched exits 1 with an empty
      // stdout, so resolving both sides first is what makes the third state
      // reachable at all.
      expect(content).toContain("git rev-parse --verify");
    });

    it("keeps NOT DETERMINED as a third state, distinct from both verdicts", () => {
      // Collapsing the unreadable case into CLEAN skips a real conflict;
      // collapsing it into CONFLICTED is the original bug in a new place.
      expect(content).toContain("NOT DETERMINED");
      expect(content).toContain("not_determined");
    });

    it("distinguishes all three outcomes by name", () => {
      expect(content).toContain("CLEAN");
    });

    it("does not treat a bare DIRTY as sufficient to enter the conflict path", () => {
      // The exact pre-fix shapes. Kept as literal strings so a revert is caught
      // rather than paraphrased past.
      expect(content).not.toContain("or `mergeStateStatus == DIRTY`");
      expect(content).not.toContain(
        "`mergeable = CONFLICTING` or `mergeStateStatus = DIRTY`"
      );
    });
  }
);

describe("stored settings stay trusted", () => {
  it("does not extend the distrust to `autoMergeRequest`", () => {
    // Third acceptance scenario of #3694. `autoMergeRequest` is a stored
    // setting, not a computation, and was reliable throughout; widening the
    // rule to "distrust the GitHub API" would cost a verification step on every
    // arming read for no measured reason.
    const content = readFileSync(
      path.resolve("plugins/src/base/skills/lisa-drive-pr-to-merge/SKILL.md"),
      "utf8"
    );
    const flat = content.replace(/\s+/gu, " ");
    expect(flat).toMatch(/`autoMergeRequest` is a \*stored\* setting/u);
  });
});
