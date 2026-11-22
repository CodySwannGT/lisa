/**
 * `lisa controls protect` says "not known" when a read of the hosting
 * platform does not settle a question, and never guesses.
 *
 * Three reads can come back short. The list of rulesets comes one page at a
 * time, so a page that is full may not be the whole list. A ruleset's branch
 * conditions can be written in a way the matcher does not model, so it is
 * not known whether the ruleset covers the branch. And the name the platform
 * gives the default branch is text this command did not write, so it is
 * checked before it is put in a request. In each case the run changes
 * nothing and says what it could not tell (CodySwannGT/lisa#4993).
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import {
  fakeGithub,
  statusCheckRuleset,
  type FakeRuleset,
} from "./support/fake-github.js";
import {
  LINT_CHECK,
  REPO,
  handover,
  protect,
  protectFixture,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const QUALITY_RULESET = "quality checks";
const RULESET_LIST = `repos/${REPO}/rulesets?per_page=100`;
const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture with a workflow folder that is removed after the case.
 * @returns The repository root
 */
function repository(): string {
  const built = protectFixture();
  fixtures.push(built);
  return built.repoPath;
}

/**
 * Rulesets that are enforced on another branch and require nothing.
 * @param count - How many
 * @returns The rulesets, with ids from 1
 */
function unrelatedRulesets(count: number): readonly FakeRuleset[] {
  return Array.from({ length: count }, (_, index) =>
    statusCheckRuleset(index + 1, `release rules ${String(index + 1)}`, [], {
      conditions: {
        ref_name: { include: ["refs/heads/release"], exclude: [] },
      },
    })
  );
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("a repository with more rulesets than the platform lists by default", () => {
  it("has its thirty-first ruleset read, so a check that one requires is required", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: [
        ...unrelatedRulesets(30),
        statusCheckRuleset(31, QUALITY_RULESET, [LINT_CHECK]),
      ],
    });

    const result = await protect(repoPath, github, APPLY);

    expect(github.log[0]).toEqual({ method: "GET", path: RULESET_LIST });
    expect(github.log.map(request => request.path)).toContain(
      `repos/${REPO}/rulesets/31`
    );
    expect(result.required_checks[0]).toMatchObject({
      context: LINT_CHECK,
      state: "required",
    });
    expect(result.outcome).toBe("wired");
    expect(github.writes()).toEqual([]);
  });

  it("is not compared at all when the list comes back as a full page", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: unrelatedRulesets(100),
    });

    const result = await protect(repoPath, github, APPLY);

    // One request: no ruleset is read from a list that may be cut off.
    expect(github.log).toEqual([{ method: "GET", path: RULESET_LIST }]);
    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.required_checks[0]?.state).toBe("unknown");
    expect(result.reason).toMatch(/could not be read/u);
    expect(result.reason).toMatch(/full page of 100/u);
    expect(result.differences).toEqual([]);
  });
});

describe("a ruleset whose reach cannot be worked out", () => {
  /**
   * A ruleset that requires the lint check, on branches named by a pattern
   * the matcher does not model.
   * @returns The ruleset
   */
  function unmodelled(): FakeRuleset {
    return statusCheckRuleset(7, "main and release", [LINT_CHECK], {
      conditions: {
        ref_name: { include: ["refs/heads/{main,release}"], exclude: [] },
      },
    });
  }

  it("leaves a check it requires not known, never not required", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      rulesets: [unmodelled()],
    });

    const result = await protect(repoPath, github);

    expect(result.required_checks).toEqual([
      expect.objectContaining({ context: LINT_CHECK, state: "unknown" }),
    ]);
    expect(result.required_checks[0]?.detail).toMatch(
      /^It is not known whether this check is required on `main`\./u
    );
    expect(result.required_checks[0]?.detail).toContain('"main and release"');
    expect(result.differences).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.entries[0]?.reason).toMatch(
      /^It could not be confirmed that `[^`]+` is required on `main`\./u
    );
    expect(handover(repoPath)).toContain("| GitHub Actions | Not confirmed |");
  });

  it("is not answered by requiring the check a second time", async () => {
    const repoPath = repository();
    const held = unmodelled();
    const github = fakeGithub({ repo: REPO, admin: true, rulesets: [held] });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(github.rulesets()).toEqual([held]);
    // Nothing is asked about a check that is in no change.
    expect(github.log.some(request => request.path.includes("/commits/"))).toBe(
      false
    );
    expect(result.outcome).toBe("blocked");
  });

  it("does not put in doubt a check an enforced ruleset requires", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      rulesets: [
        unmodelled(),
        statusCheckRuleset(8, QUALITY_RULESET, [LINT_CHECK]),
      ],
    });

    const result = await protect(repoPath, github);

    expect(result.required_checks[0]?.state).toBe("required");
    expect(result.outcome).toBe("wired");
  });
});

describe("a default branch name the platform gives", () => {
  it.each(["main?per_page=1#", "main/../../other", "-main", "main branch"])(
    "is never put in a request when it is %j",
    async named => {
      const repoPath = repository();
      const github = fakeGithub({
        repo: REPO,
        admin: true,
        defaultBranch: named,
      });

      const result = await protect(repoPath, github, APPLY);

      // The ruleset list and the repository, and nothing after them.
      expect(github.log.map(request => request.path)).toEqual([
        RULESET_LIST,
        `repos/${REPO}`,
      ]);
      expect(github.writes()).toEqual([]);
      expect(result.outcome).toBe("blocked");
      expect(result.branch).toBeNull();
      expect(result.reason).toContain(JSON.stringify(named));
      expect(result.reason).toMatch(/--branch <name>/u);
    }
  );

  it("does not stop a run that was told which branch to protect", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      defaultBranch: "main branch",
      rulesets: [
        statusCheckRuleset(7, QUALITY_RULESET, [LINT_CHECK], {
          conditions: {
            ref_name: { include: ["refs/heads/release"], exclude: [] },
          },
        }),
      ],
    });

    const result = await protect(repoPath, github, { branch: "release" });

    expect(result.branch).toBe("release");
    expect(result.outcome).toBe("wired");
  });
});
