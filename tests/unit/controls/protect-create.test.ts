/**
 * The ruleset `lisa controls protect --apply` creates when a repository has
 * none that requires checks, and the changes it never makes.
 *
 * The command writes required checks and nothing else. A ruleset it creates
 * takes its branches, its enforcement and its bypass list from the shipped
 * ruleset generator — the repository's `policy` block, or Lisa's defaults —
 * and holds the status-check rule only. Repository settings are never sent,
 * whatever the policy block says (CodySwannGT/lisa#4993).
 */
import { afterEach, describe, expect, it } from "vitest";

import { loadProtectionModules } from "../../../src/controls/protect-modules.js";
import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { fakeGithub, statusCheckRuleset } from "./support/fake-github.js";
import {
  LINT_CHECK,
  REPO,
  protect,
  protectFixture,
  type ProtectFixtureOptions,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture that is removed after the case.
 * @param options - How it differs from F-mixed with its declaration
 * @returns The repository root
 */
function repository(options: ProtectFixtureOptions = {}): string {
  const built = protectFixture(options);
  fixtures.push(built);
  return built.repoPath;
}

/**
 * The body of the only write a platform received.
 * @param github - The in-memory platform
 * @returns The request body
 */
function onlyWrite(
  github: ReturnType<typeof fakeGithub>
): Record<string, unknown> {
  expect(github.writes()).toHaveLength(1);
  return github.writes()[0]?.body as Record<string, unknown>;
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("the ruleset lisa controls protect --apply creates", () => {
  it("takes its branches, enforcement and bypass list from the shipped generator", async () => {
    const { payload } = await loadProtectionModules();
    const generated = payload.buildRulesetPayload({ gates: {}, policy: {} });
    const github = fakeGithub({ repo: REPO, admin: true });

    await protect(repository(), github, APPLY);

    const body = onlyWrite(github);
    expect(body.target).toBe(generated.target);
    expect(body.enforcement).toBe(generated.enforcement);
    expect(body.conditions).toEqual(generated.conditions);
    expect(body.bypass_actors).toEqual(generated.bypass_actors);
    expect(body).not.toHaveProperty("id");
  });

  it("follows the repository's own policy for which branches it covers", async () => {
    const github = fakeGithub({ repo: REPO, admin: true });
    const repoPath = repository({
      config: {
        policy: {
          ruleset: { include_refs: ["~DEFAULT_BRANCH"], bypass_actors: [] },
        },
      },
    });

    const result = await protect(repoPath, github, APPLY);

    const body = onlyWrite(github);
    expect(body.conditions).toEqual({
      ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] },
    });
    expect(body.bypass_actors).toEqual([]);
    expect(result.outcome).toBe("wired");
  });

  it("takes the name it is given", async () => {
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repository(), github, {
      apply: true,
      ruleset: "required checks",
    });

    expect(onlyWrite(github).name).toBe("required checks");
    expect(result.outcome).toBe("wired");
  });

  it("is not created when the policy would not enforce it on the branch", async () => {
    const github = fakeGithub({ repo: REPO, admin: true });
    const repoPath = repository({
      config: { policy: { ruleset: { enforcement: "disabled" } } },
    });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/would not be enforced on `main`/u);
  });

  it("is not created beside a ruleset of the same name that is switched off", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: [
        statusCheckRuleset(7, "quality checks", [LINT_CHECK], {
          enforcement: "disabled",
        }),
      ],
    });

    const result = await protect(repository(), github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/exists but is not enforced on `main`/u);
  });
});

describe("what lisa controls protect --apply never changes", () => {
  it("sends no repository setting, whatever the policy block declares", async () => {
    const github = fakeGithub({ repo: REPO, admin: true });
    const repoPath = repository({
      config: {
        policy: {
          merge: { squash: true, merge_commit: false },
          repository: { has_wiki: false },
        },
      },
    });

    await protect(repoPath, github, APPLY);

    expect(
      github.writes().map(({ method, path }) => `${method} ${path}`)
    ).toEqual([`POST repos/${REPO}/rulesets`]);
  });

  it("removes no check a ruleset already requires", async () => {
    const other = "Some Other App";
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: [statusCheckRuleset(7, "quality checks", [other])],
    });

    await protect(repository(), github, APPLY);

    const rule = (
      onlyWrite(github).rules as readonly Record<string, unknown>[]
    )[0];
    const parameters = rule?.parameters as {
      readonly required_status_checks: readonly { readonly context: string }[];
    };
    expect(
      parameters.required_status_checks.map(check => check.context)
    ).toEqual([other, LINT_CHECK]);
  });
});
