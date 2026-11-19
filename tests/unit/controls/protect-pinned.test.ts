/**
 * `lisa controls protect` never changes which app may satisfy a check the
 * hosting platform already requires.
 *
 * A required check is a name and, where the settings say so, the one app
 * allowed to report it. The platform's own settings page pins a check to an
 * app by default. So a host whose ruleset already requires a check from an
 * app, and whose declaration awaits that check without naming the app, has
 * the check required already: it is reported as required and left exactly
 * as it is. No change this command plans may drop a pin the host had, or
 * swap it for another; such a change is refused before anything is sent
 * (CodySwannGT/lisa#4993).
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import {
  F_PAVED_GATES,
  type GatesBlock,
} from "../../helpers/control-register.js";
import {
  fakeGithub,
  statusCheckRuleset,
  type FakeRequiredCheck,
} from "./support/fake-github.js";
import {
  AWAITED_FROM_ANYONE,
  LINT_CHECK,
  REPO,
  REVIEW_CHECK as REVIEW,
  handover,
  protect,
  protectFixture,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const SECURITY = "🔍 Quality Checks / 🔒 Security Scan";
const TESTS = "🔍 Quality Checks / 🧪 Run Unit Tests";
const QUALITY_RULESET = "quality checks";

/** The app the host's own ruleset says must report the review check. */
const HOST_APP = 999;

/** The app the paved-road declaration says reports it. */
const DECLARED_APP = 4242;

/** The review check as the host's ruleset requires it: from one app. */
const HOST_REVIEW: FakeRequiredCheck = {
  context: REVIEW,
  integration_id: HOST_APP,
};

const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture with a workflow folder that is removed after the case.
 * @param gates - The gates declaration
 * @returns The repository root
 */
function repository(gates: GatesBlock): string {
  const built = protectFixture({ gates });
  fixtures.push(built);
  return built.repoPath;
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("an awaited check the host already requires from one app", () => {
  it("is reported required, and nothing is handed to an administrator", async () => {
    const repoPath = repository(AWAITED_FROM_ANYONE);
    const github = fakeGithub({
      repo: REPO,
      admin: false,
      rulesets: [
        statusCheckRuleset(7, QUALITY_RULESET, [
          HOST_REVIEW,
          LINT_CHECK,
          SECURITY,
          TESTS,
        ]),
      ],
    });

    const result = await protect(repoPath, github);

    expect(
      result.required_checks.find(check => check.context === REVIEW)
    ).toMatchObject({ source: "external", app_id: null, state: "required" });
    expect(result.outcome).toBe("wired");
    expect(result.differences).toEqual([]);
    expect(handover(repoPath)).toBeNull();
  });

  it("is left exactly as it is by --apply with administrator access", async () => {
    const repoPath = repository(AWAITED_FROM_ANYONE);
    const held = statusCheckRuleset(7, QUALITY_RULESET, [
      HOST_REVIEW,
      LINT_CHECK,
      SECURITY,
      TESTS,
    ]);
    const github = fakeGithub({ repo: REPO, admin: true, rulesets: [held] });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(github.rulesets()).toEqual([held]);
    expect(result.outcome).toBe("wired");
  });

  it("keeps its app when another check is added to the same ruleset", async () => {
    const repoPath = repository(AWAITED_FROM_ANYONE);
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      rulesets: [
        statusCheckRuleset(7, QUALITY_RULESET, [HOST_REVIEW, SECURITY, TESTS]),
      ],
    });

    const result = await protect(repoPath, github, APPLY);

    const [write] = github.writes();
    expect(write?.method).toBe("PUT");
    const body = write?.body as {
      readonly rules: readonly {
        readonly parameters: {
          readonly required_status_checks: readonly unknown[];
        };
      }[];
    };
    expect(body.rules[0]?.parameters.required_status_checks).toContainEqual({
      context: REVIEW,
      integration_id: HOST_APP,
    });
    expect(result.outcome).toBe("wired");
  });
});

describe("a change that would swap the app a required check is pinned to", () => {
  it("is refused before anything is sent, and says why", async () => {
    const repoPath = repository(F_PAVED_GATES);
    const held = statusCheckRuleset(7, QUALITY_RULESET, [
      HOST_REVIEW,
      LINT_CHECK,
      SECURITY,
      TESTS,
    ]);
    const github = fakeGithub({ repo: REPO, admin: true, rulesets: [held] });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(github.rulesets()).toEqual([held]);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toContain(`\`${REVIEW}\``);
    expect(result.reason).toContain(`app ${String(HOST_APP)}`);
    expect(result.reason).toContain(`app ${String(DECLARED_APP)}`);
    expect(result.reason).toMatch(/Nothing was changed\.$/u);
    expect(handover(repoPath)).toContain(REVIEW);
  });
});
