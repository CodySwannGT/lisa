/**
 * Tests for the stash entitlement rule (CodySwannGT/lisa#2993).
 *
 * `refs/stash` is one reflog shared by every worktree of a repository, so there
 * is nothing to scope by and the only defensible entitlement is provable
 * redundancy. Each case below is a stash a wrong answer would destroy.
 * @module tests/unit/cli/stash-prune-policy
 */
import { describe, expect, it } from "vitest";
import {
  classifyStash,
  DEFAULT_MIN_DEBRIS_AGE_SECONDS,
  isLintStagedBackup,
  STASH_BLOCKER_EXPLANATIONS,
  type StashFacts,
} from "../../../src/cli/stash-prune-policy.js";

/** The exact message lint-staged gives its automatic backup stash. */
const LINT_STAGED_BACKUP = "lint-staged automatic backup";

/** Blocker emitted for a stash whose content is not provably preserved. */
const NOT_REDUNDANT = "not-provably-redundant";

const POLICY = { minDebrisAgeSeconds: 86_400 };

/**
 * Build facts for an ordinary stash holding real work.
 * @param overrides - Facts to change
 * @returns Facts for the entitlement rule
 */
function humanStash(overrides: Partial<StashFacts> = {}): StashFacts {
  return {
    index: 0,
    sha: "abc123def456",
    subject: "WIP on main: 1234567 some work",
    ageSeconds: 200_000,
    readable: true,
    recordsNoChange: false,
    baseOnRemote: true,
    ...overrides,
  };
}

describe("isLintStagedBackup", () => {
  it("matches the bare backup message", () => {
    expect(isLintStagedBackup(LINT_STAGED_BACKUP)).toBe(true);
  });

  it("matches the branch-prefixed form git writes on push", () => {
    expect(isLintStagedBackup("On main: lint-staged automatic backup")).toBe(
      true
    );
  });

  it("does NOT match a human stash that merely mentions lint-staged", () => {
    expect(
      isLintStagedBackup("WIP on main: fixing the lint-staged automatic backup")
    ).toBe(false);
    expect(isLintStagedBackup("lint-staged automatic backup notes")).toBe(
      false
    );
  });
});

describe("classifyStash", () => {
  it("keeps an ordinary stash holding real work", () => {
    const verdict = classifyStash(humanStash(), POLICY);
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toEqual([NOT_REDUNDANT]);
  });

  it("drops a stash that records no change against a published base", () => {
    const verdict = classifyStash(
      humanStash({ recordsNoChange: true, baseOnRemote: true }),
      POLICY
    );
    expect(verdict.eligible).toBe(true);
    expect(verdict.redundancy).toBe("empty-and-published");
  });

  it("keeps an empty stash whose base exists on no remote", () => {
    const verdict = classifyStash(
      humanStash({ recordsNoChange: true, baseOnRemote: false }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toEqual([NOT_REDUNDANT]);
  });

  it("drops machine-generated backup debris past the age threshold", () => {
    const verdict = classifyStash(
      humanStash({
        subject: LINT_STAGED_BACKUP,
        ageSeconds: 90_000,
      }),
      POLICY
    );
    expect(verdict.eligible).toBe(true);
    expect(verdict.redundancy).toBe("machine-debris");
  });

  it("keeps machine backup debris whose producing run may still be alive", () => {
    const verdict = classifyStash(
      humanStash({ subject: LINT_STAGED_BACKUP, ageSeconds: 60 }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toEqual(["too-recent"]);
  });

  it("keeps an entry git could not report on", () => {
    const verdict = classifyStash(
      humanStash({
        readable: false,
        subject: LINT_STAGED_BACKUP,
        ageSeconds: 90_000,
      }),
      POLICY
    );
    expect(verdict.eligible).toBe(false);
    expect(verdict.blockers).toEqual(["unreadable"]);
  });

  it("carries the commit id through, so drops are never addressed by position", () => {
    expect(classifyStash(humanStash({ index: 4 }), POLICY)).toMatchObject({
      index: 4,
      sha: "abc123def456",
    });
  });

  it("defaults the debris threshold to a full day", () => {
    expect(DEFAULT_MIN_DEBRIS_AGE_SECONDS).toBe(86_400);
  });

  it("explains every blocker it can emit", () => {
    const blockers = [
      classifyStash(humanStash(), POLICY),
      classifyStash(
        humanStash({ subject: LINT_STAGED_BACKUP, ageSeconds: 1 }),
        POLICY
      ),
      classifyStash(humanStash({ readable: false }), POLICY),
    ].flatMap(verdict => verdict.blockers);
    expect(blockers).toEqual([NOT_REDUNDANT, "too-recent", "unreadable"]);
    blockers.forEach(blocker => {
      expect(STASH_BLOCKER_EXPLANATIONS[blocker]).toBeTruthy();
    });
  });
});
