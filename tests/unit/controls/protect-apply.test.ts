/**
 * `lisa controls protect --apply` with permission to change merge protection.
 *
 * The command sends the checks the register derives, then reads the live
 * settings back and compares them with what it derived. Only a read-back that
 * agrees is reported as wired; a platform that accepted the change and did
 * not keep it is reported as blocked, with the difference. Every request goes
 * to the in-memory platform in `./support/fake-github.ts`, never to a real
 * one (CodySwannGT/lisa#4993).
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { F_PAVED_GATES } from "../../helpers/control-register.js";
import {
  ACTIONS_APP_ID,
  fakeGithub,
  statusCheckRuleset,
  type FakeGithub,
} from "./support/fake-github.js";
import {
  LINT_CHECK,
  REPO,
  handover,
  protect,
  protectFixture,
  type ProtectFixtureOptions,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const OTHER_CHECK = "🔍 Quality Checks / 🧪 Run Unit Tests";
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
 * The check names every enforced ruleset of the platform requires.
 * @param github - The in-memory platform
 * @returns The names, in ruleset order
 */
function requiredOnPlatform(github: FakeGithub): readonly string[] {
  return github.rulesets().flatMap(ruleset => {
    const rules = ruleset.rules as readonly Record<string, unknown>[];
    return rules.flatMap(rule => {
      const parameters = (rule.parameters ?? {}) as Record<string, unknown>;
      const checks = (parameters.required_status_checks ?? []) as readonly {
        readonly context: string;
      }[];
      return checks.map(check => check.context);
    });
  });
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("lisa controls protect --apply with permission", () => {
  it("applies the derived checks and reads back the same set", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY);

    expect(result.outcome).toBe("wired");
    expect(result.differences).toEqual([]);
    expect(requiredOnPlatform(github)).toEqual([LINT_CHECK]);
    expect(result.required_checks).toEqual([
      {
        context: LINT_CHECK,
        source: "workflow",
        app_id: null,
        gates: ["code-style"],
        state: "required",
        detail: null,
      },
    ]);
    expect(result.entries.map(entry => entry.outcome)).toEqual([
      "wired",
      "wired",
    ]);
    expect(handover(repoPath)).toBeNull();
  });

  it("creates one ruleset holding only the status-check rule", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: true });

    await protect(repoPath, github, APPLY);

    expect(github.writes()).toHaveLength(1);
    const [write] = github.writes();
    expect(write?.method).toBe("POST");
    expect(write?.path).toBe(`repos/${REPO}/rulesets`);
    const body = write?.body as Record<string, unknown>;
    expect(body.name).toBe("quality checks");
    expect(body.enforcement).toBe("active");
    expect(body.rules).toEqual([
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: true,
          required_status_checks: [
            { context: LINT_CHECK, integration_id: ACTIONS_APP_ID },
          ],
        },
      },
    ]);
  });

  it("reads the settings back after the write, and only then reports", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY);

    const methods = github.log.map(request => request.method);
    const write = methods.indexOf("POST");
    expect(write).toBeGreaterThan(-1);
    expect(methods.slice(write + 1)).toEqual(["GET", "GET"]);
    expect(result.requests).toEqual(
      github.log.map(({ method, path }) => ({ method, path, sent: true }))
    );
  });

  it("adds to the ruleset that already requires checks and keeps what it had", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: [statusCheckRuleset(7, "quality checks", [OTHER_CHECK])],
    });

    const result = await protect(repoPath, github, APPLY);

    expect(result.outcome).toBe("wired");
    expect(
      github.writes().map(({ method, path }) => ({ method, path }))
    ).toEqual([{ method: "PUT", path: `repos/${REPO}/rulesets/7` }]);
    expect(requiredOnPlatform(github)).toEqual([OTHER_CHECK, LINT_CHECK]);
  });

  it("reports blocked with the difference when the read-back does not match", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      forgets: [LINT_CHECK],
    });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toHaveLength(1);
    expect(result.outcome).toBe("blocked");
    expect(result.differences).toEqual([
      `\`${LINT_CHECK}\` is not required on \`main\`.`,
    ]);
    expect(result.reason).toMatch(/read back/u);
    expect(result.entries.map(entry => entry.outcome)).toEqual([
      "blocked",
      "blocked",
    ]);
    expect(handover(repoPath)).toContain(LINT_CHECK);
  });

  it("reports blocked with the platform's answer when the write is refused", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      writeFailure: "Validation Failed",
    });

    const result = await protect(repoPath, github, APPLY);

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toContain("Validation Failed");
    expect(handover(repoPath)).not.toBeNull();
  });

  it("sends nothing on a second run", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: true });
    await protect(repoPath, github, APPLY);
    const writesAfterFirst = github.writes().length;

    const second = await protect(repoPath, github, APPLY);

    expect(second.outcome).toBe("wired");
    expect(github.writes()).toHaveLength(writesAfterFirst);
    expect(second.handover.action).toBe("none");
  });

  it("refuses to guess between two rulesets that both require checks", async () => {
    const repoPath = repository();
    const rulesets = [
      statusCheckRuleset(7, "first", [OTHER_CHECK]),
      statusCheckRuleset(8, "second", [OTHER_CHECK]),
    ];
    const github = fakeGithub({ repo: REPO, admin: true, rulesets });

    const result = await protect(repoPath, github, APPLY);

    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/--ruleset/u);
    expect(github.writes()).toEqual([]);

    const named = await protect(repoPath, github, {
      apply: true,
      ruleset: "second",
    });

    expect(named.outcome).toBe("wired");
    expect(github.writes().map(request => request.path)).toEqual([
      `repos/${REPO}/rulesets/8`,
    ]);
  });

  it("sends an awaited check with the app the declaration pins, not as a workflow check", async () => {
    const repoPath = repository({ gates: F_PAVED_GATES });
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY);

    expect(result.outcome).toBe("wired");
    const body = github.writes()[0]?.body as {
      readonly rules: readonly {
        readonly parameters: {
          readonly required_status_checks: readonly unknown[];
        };
      }[];
    };
    expect(body.rules[0]?.parameters.required_status_checks).toContainEqual({
      context: "Review Bot",
      integration_id: 4242,
    });
    expect(
      result.required_checks.find(check => check.context === "Review Bot")
    ).toMatchObject({ source: "external", app_id: 4242, state: "required" });
  });
});
