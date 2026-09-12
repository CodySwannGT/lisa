/**
 * A cached mergeability field is a hint; `git merge-tree` is the verdict
 * (CodySwannGT/lisa#3694).
 *
 * ## The defect
 *
 * GitHub computes `mergeable` and `mergeStateStatus` asynchronously and serves
 * a cached result. Measured: the same unchanged branch moved
 * `DIRTY` → `UNKNOWN` → `BLOCKED` with no push in between, one response carried
 * `{"mergeable":"MERGEABLE","mergeState":"DIRTY"}` with the two fields
 * disagreeing, and two branches read `DIRTY` at the same moment while only one
 * actually conflicted.
 *
 * Two skills branched on that field as proof, and they fail in opposite
 * directions of seriousness: `lisa-drive-pr-to-merge` sends an agent to resolve
 * a conflict that is not there — wasteful and visible — while
 * `lisa-repair-intake` classifies it a TRUE merge conflict and files a blocker,
 * unattended, so a wrong answer becomes durable tracker state a later cycle
 * reads as fact.
 *
 * ## Why the rule is "computed fields", not "the API"
 *
 * `autoMergeRequest` is a stored setting and was reliable throughout. The two
 * executables in this repository already draw exactly that line —
 * `block-blind-automerge.sh` says `mergeStateStatus` "is deliberately NOT read",
 * and `pr-arming-sweep.mjs` cites this ticket. The rule existed in code and had
 * never been applied to the prose, which is what these cases pin.
 * @module tests/unit/strategies/merge-state-not-proof-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/**
 * Read one skill's prose from a generated or source root.
 * @param root - Plugin root
 * @param skill - Skill directory name
 * @returns The skill text
 */
function read(root: string, skill: string): string {
  return readFileSync(path.resolve(root, `skills/${skill}/SKILL.md`), "utf8");
}

/**
 * Collapse whitespace so a rule is matched as a sentence, not as the line
 * breaks the prose happens to wrap at today.
 * @param source - Skill text
 * @returns The text with every whitespace run reduced to one space
 */
function flat(source: string): string {
  return source.replace(/\s+/gu, " ");
}

describe.each(ROOTS)("%s drive-pr conflict proof", root => {
  const skill = read(root, "lisa-drive-pr-to-merge");

  it("no longer treats a DIRTY read alone as a conflict", () => {
    expect(skill).not.toContain(
      "If `gh pr update-branch` reports a conflict (or `mergeStateStatus == DIRTY`)"
    );
  });

  it("names merge-tree as the local authority", () => {
    expect(skill).toContain("git merge-tree --write-tree");
    // The trial's outcomes, by name. This case originally pinned the comment
    // `exit 0 = merges clean; exit 1 = real conflict`, which reads the exit
    // code alone — and that is wrong in the same direction as the cached
    // field, because a trial that could not RUN also exits 1. The claim kept
    // here is the one that survives: the skill names the outcomes rather than
    // leaving the reader to infer them.
    expect(skill).toContain("CLEAN");
    expect(skill).toContain("CONFLICTED");
    expect(skill).toContain("NOT DETERMINED");
  });

  it("calls the cached field a hint rather than proof", () => {
    // Flattened: the sentence wraps, and where its line happens to break is
    // not part of the claim.
    expect(flat(skill)).toMatch(/is a HINT, never proof of a conflict/u);
  });

  it("keeps the genuine-conflict path intact", () => {
    // The precision control. A change that stopped resolving conflicts
    // entirely would satisfy every case above and be strictly worse.
    expect(flat(skill)).toMatch(/trial says CONFLICTED[^.]*fetch the base/u);
  });

  it("distrusts computed fields without distrusting stored ones", () => {
    // Wording-independent: the rule must be scoped to the computed fields and
    // must say so about `autoMergeRequest` by name.
    expect(flat(skill)).toMatch(/narrower than "distrust the API"/iu);
    expect(flat(skill)).toMatch(/Distrust the \*\*computed\*\* fields/u);
    expect(flat(skill)).toMatch(/`autoMergeRequest` is a \*stored\* setting/u);
  });
});

describe.each(ROOTS)("%s repair-intake conflict proof", root => {
  const skill = read(root, "lisa-repair-intake");

  it("no longer classifies a cached read as a true conflict", () => {
    expect(skill).not.toContain(
      "**True merge conflict** — `mergeable = CONFLICTING` or `mergeStateStatus = DIRTY`"
    );
  });

  it("requires merge-tree before filing a blocker", () => {
    expect(skill).toContain("git merge-tree --write-tree");
    expect(skill).toMatch(/[Vv]erify before filing, never after/);
  });

  it("says why the same field is worse here than in drive-pr", () => {
    // The direction-of-failure distinction is what sets the priority, and a
    // later editor who does not know it will relax this back.
    expect(skill).toMatch(/files a\s+BLOCKER against a pull request/);
    expect(skill).toMatch(/durable tracker state/);
  });

  it("keeps update-branch's own conflict report as sufficient", () => {
    // That one is not a cached field — it is the server attempting the merge —
    // so it must stay authoritative.
    expect(skill).toMatch(/update-branch.*reported a conflict/);
  });
});
