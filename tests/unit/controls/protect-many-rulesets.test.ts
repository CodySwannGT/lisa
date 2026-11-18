/**
 * `lisa controls protect --apply` confirms a change on a repository that has
 * many rulesets (CodySwannGT/lisa#4993).
 *
 * The rulesets are read twice in a run that changes something: once before
 * the change, by the shipped reconciler, and once after it, by `lisa
 * health`'s ruleset reader. Both ask for the largest page the platform gives
 * and both must draw the line between "the whole list" and "may be cut off"
 * at the same length. When the second read refused a list the first one
 * accepted, a repository with that many rulesets (organisation ones count)
 * had its change sent and then reported as not confirmed, on every run.
 *
 * The same line decides one more thing. A change that creates a ruleset makes
 * the list one longer, so on a repository one short of a full page the
 * read-back could not confirm it. That change is not sent.
 */
import { afterEach, describe, expect, it } from "vitest";

import { loadProtectionModules } from "../../../src/controls/protect-modules.js";
import { readRulesetsBack } from "../../../src/controls/protect-requests.js";
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
  sentAsRequired,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const QUALITY_RULESET = "quality checks";
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

/**
 * That many rulesets, the last of which is enforced on the default branch
 * and requires a check other than the derived one.
 * @param count - How many in all
 * @returns The rulesets
 */
function withQualityRuleset(count: number): readonly FakeRuleset[] {
  return [
    ...unrelatedRulesets(count - 1),
    statusCheckRuleset(count, QUALITY_RULESET, ["Some Other Check"]),
  ];
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("a change that adds a check to an existing ruleset", () => {
  it.each([33, 40, 99])(
    "is confirmed on a repository with %i rulesets",
    async count => {
      const github = fakeGithub({
        repo: REPO,
        admin: true,
        rulesets: withQualityRuleset(count),
      });

      const result = await protect(repository(), github, APPLY);

      expect(github.writes().map(write => write.method)).toEqual(["PUT"]);
      expect(sentAsRequired(github)).toContain(LINT_CHECK);
      expect(result.differences).toEqual([]);
      expect(result.outcome).toBe("wired");
      expect(result.required_checks[0]).toMatchObject({
        context: LINT_CHECK,
        state: "required",
      });
    }
  );
});

describe("a change that creates a ruleset", () => {
  it.each([32, 40, 98])(
    "is confirmed on a repository that had %i rulesets",
    async count => {
      const repoPath = repository();
      const github = fakeGithub({
        repo: REPO,
        admin: true,
        rulesets: unrelatedRulesets(count),
      });

      const result = await protect(repoPath, github, APPLY);

      expect(github.writes().map(write => write.method)).toEqual(["POST"]);
      expect(github.rulesets()).toHaveLength(count + 1);
      expect(result.outcome).toBe("wired");
      expect(handover(repoPath)).toBeNull();
    }
  );

  it("is not sent when the list would then fill the page and could not be read back", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: unrelatedRulesets(99),
    });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(github.rulesets()).toHaveLength(99);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/lists 99 rulesets/u);
    expect(result.reason).toMatch(/Nothing was changed\.$/u);
    expect(result.reason).toMatch(/--ruleset/u);
  });
});

describe("the read before a change and the read after it", () => {
  it.each([
    [99, true],
    [100, false],
  ] as const)(
    "both take a list of %i rulesets for the whole list: %s",
    async (count, whole) => {
      const modules = await loadProtectionModules();
      const github = fakeGithub({
        repo: REPO,
        admin: true,
        rulesets: unrelatedRulesets(count),
      });

      const before = modules.reconcile.readLivePolicy({
        repo: REPO,
        gh: github.gh,
      });
      const after = await readRulesetsBack(github.gh, REPO, process.cwd());

      expect(before.ok).toBe(whole);
      expect(after.ok).toBe(whole);
    }
  );

  it("say the same thing about a list that may be cut off", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: unrelatedRulesets(100),
    });

    const after = await readRulesetsBack(github.gh, REPO, process.cwd());

    expect(after).toEqual({
      ok: false,
      reason: expect.stringContaining("full page of 100") as string,
    });
  });

  it("counts every ruleset the list held, whatever it applies to", async () => {
    const modules = await loadProtectionModules();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: [
        ...unrelatedRulesets(3),
        statusCheckRuleset(4, "tag rules", [], { target: "tag" }),
      ],
    });

    const before = modules.reconcile.readLivePolicy({
      repo: REPO,
      gh: github.gh,
    });

    expect(before).toMatchObject({ ok: true, listed: 4 });
    expect(before.ok ? before.rulesets : []).toHaveLength(3);
  });
});
