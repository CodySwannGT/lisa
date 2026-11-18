/**
 * `lisa controls reconcile --platform`: asking the hosting platform whether
 * it requires the checks the register lists for a pull request
 * (CodySwannGT/lisa#5000).
 *
 * This is the one read that leaves the machine, so it is opt-in, and these
 * cases hold three answers apart: not asked, asked and not answered, and
 * answered. Only an answer can produce a finding. No case reaches a
 * platform: each hands the command the in-memory stand-in of
 * `../unit/controls/support/fake-github.ts`, which records every request.
 * @module tests/integration/controls-reconcile-platform
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ReconcileDependencies } from "../../src/controls/reconcile.js";
import type { ControlAuditFixture } from "../helpers/control-audit-fixtures.js";
import { F_MIXED_GATES } from "../helpers/control-register.js";
import {
  declaredRepository,
  missingPoints,
  reconcile,
  type ReconcileCommandRun,
  resultOf,
} from "../support/reconcile-run.js";
import {
  fakeGithub,
  statusCheckRuleset,
  type FakeGhResult,
} from "../unit/controls/support/fake-github.js";
import {
  GITHUB_REMOTE,
  LINT_CHECK,
  protectFixture,
  REPO,
} from "../unit/controls/support/protect-fixture.js";

const PULL_REQUEST = "pull-request";
const PLATFORM = "hosting-platform";
const ASK = { platform: true };
const fixtures: ControlAuditFixture[] = [];

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

/**
 * Build F-mixed with a linter per folder required on a pull request.
 * @param gates - The `gates` block
 * @returns The repository's root
 */
function repository(gates = F_MIXED_GATES): string {
  const built = protectFixture({ gates });
  fixtures.push(built);
  return built.repoPath;
}

/**
 * The collaborators of a read that reaches the stand-in platform.
 * @param gh - What stands in for the platform's tool
 * @param remote - The remote address, or `null` for none
 * @returns The dependencies to hand the command
 */
function reaching(
  gh: (args: readonly string[]) => FakeGhResult,
  remote: string | null = GITHUB_REMOTE
): ReconcileDependencies {
  return { platform: { gh, readRemoteUrl: () => Promise.resolve(remote) } };
}

/**
 * A stand-in for the platform's tool that must never be called.
 * @returns A function that fails the case when anything is sent
 */
function nothingMayBeSent(): (args: readonly string[]) => FakeGhResult {
  return args => {
    throw new Error(`a request was sent: ${args.join(" ")}`);
  };
}

/**
 * The platform that requires some checks on the default branch.
 * @param contexts - The check names it requires
 * @returns The stand-in
 */
function requiring(contexts: readonly string[]) {
  return fakeGithub({
    admin: null,
    repo: REPO,
    rulesets: [statusCheckRuleset(7, "main checks", contexts)],
  });
}

/**
 * The state of each pull-request point of a run, by entry.
 * @param run - The finished run
 * @returns For example `{ "code-style@api": "wired" }`
 */
function pullRequestStates(run: ReconcileCommandRun): Record<string, string> {
  return Object.fromEntries(
    resultOf(run)
      .enforcement_points.filter(point => point.moment === PULL_REQUEST)
      .map(point => [point.entry_id, point.state])
  );
}

/**
 * What a run says about the read of the hosting platform.
 * @param run - The finished run
 * @returns The state of that read
 */
function platformState(run: ReconcileCommandRun): string | undefined {
  return resultOf(run).surfaces.find(surface => surface.surface === PLATFORM)
    ?.state;
}

describe("reconcile without --platform", () => {
  it("sends nothing and says the platform was not asked", async () => {
    const run = await reconcile(repository(), {}, reaching(nothingMayBeSent()));

    expect(run.code).toBe(0);
    expect(platformState(run)).toBe("not-asked");
    expect(pullRequestStates(run)).toEqual({
      "code-style@api": "not-read",
      "code-style@web": "not-read",
    });
    expect(
      missingPoints(run).filter(finding => finding.moment === PULL_REQUEST)
    ).toEqual([]);
    expect(run.said.at(-1)).toContain(
      'Run "lisa controls reconcile --platform"'
    );
  });
});

describe("reconcile --platform", () => {
  it("confirms a check the platform requires", async () => {
    const github = requiring([LINT_CHECK]);

    const run = await reconcile(repository(), ASK, reaching(github.gh));

    expect(platformState(run)).toBe("read");
    expect(pullRequestStates(run)).toEqual({
      "code-style@api": "wired",
      "code-style@web": "wired",
    });
    expect(
      resultOf(run).enforcement_points.find(
        point => point.moment === PULL_REQUEST
      )
    ).toMatchObject({
      checked: LINT_CHECK,
      reason: `GitHub requires "${LINT_CHECK}" before a merge into main.`,
    });
    expect(github.writes()).toEqual([]);
  });

  it("names each entry whose check the platform does not require", async () => {
    const github = requiring(["Another check"]);

    const run = await reconcile(repository(), ASK, reaching(github.gh));
    const missing = missingPoints(run).filter(
      finding => finding.moment === PULL_REQUEST
    );

    expect(run.code).toBe(0);
    expect(missing.map(finding => finding.entry_id)).toEqual([
      "code-style@api",
      "code-style@web",
    ]);
    expect(missing[0]?.message).toContain(
      `GitHub does not require "${LINT_CHECK}" before a merge into main`
    );
    expect(missing[0]?.next).toContain('Run "lisa controls protect"');
    expect(github.writes()).toEqual([]);
  });

  it("says only rulesets were read when one governs the branch and does not require the check", async () => {
    const github = requiring(["Another check"]);

    const run = await reconcile(repository(), ASK, reaching(github.gh));
    const [missing] = missingPoints(run).filter(
      finding => finding.moment === PULL_REQUEST
    );

    expect(missing?.message).toContain("Only rulesets were read");
    expect(missing?.message).toContain("branch protection rule");
    expect(resultOf(run).limits.join("\n")).toContain("only rulesets are read");
  });

  it("treats a branch no ruleset governs as not read, never as a missing check", async () => {
    const github = fakeGithub({ admin: null, repo: REPO, rulesets: [] });

    const run = await reconcile(repository(), ASK, reaching(github.gh));
    const points = resultOf(run).enforcement_points.filter(
      point => point.moment === PULL_REQUEST
    );

    expect(run.code).toBe(0);
    expect(pullRequestStates(run)).toEqual({
      "code-style@api": "not-read",
      "code-style@web": "not-read",
    });
    expect(
      missingPoints(run).filter(finding => finding.moment === PULL_REQUEST)
    ).toEqual([]);
    expect(points[0]?.reason).toContain("No ruleset governs main on GitHub");
    expect(points[0]?.reason).toContain("is not known");
    expect(points[0]?.reason).not.toContain("can be merged without it");
    expect(github.writes()).toEqual([]);
  });

  it("treats a platform that would not answer as not read, never as absent", async () => {
    const github = fakeGithub({
      admin: null,
      readFailure: "HTTP 403: Resource not accessible",
      repo: REPO,
    });

    const run = await reconcile(repository(), ASK, reaching(github.gh));

    expect(run.code).toBe(2);
    expect(resultOf(run).outcome).toBe("incomplete");
    expect(platformState(run)).toBe("could-not-read");
    expect(pullRequestStates(run)).toEqual({
      "code-style@api": "not-read",
      "code-style@web": "not-read",
    });
    expect(
      missingPoints(run).filter(finding => finding.moment === PULL_REQUEST)
    ).toEqual([]);
    expect(run.said.join("\n")).toContain("What is needed: read access");
  });

  it("says so when nothing says where the repository is hosted", async () => {
    const run = await reconcile(
      repository(),
      ASK,
      reaching(nothingMayBeSent(), null)
    );

    expect(run.code).toBe(2);
    expect(run.said.join("\n")).toContain(
      "Nothing says where this repository is hosted"
    );
  });

  it("does not ask for a rule the platform is not asked to require", async () => {
    const advisory = {
      "code-style": {
        ...(F_MIXED_GATES["code-style"] as object),
        tier: "advisory",
      },
    };
    const github = requiring([]);

    const run = await reconcile(repository(advisory), ASK, reaching(github.gh));

    expect(run.code).toBe(0);
    expect(pullRequestStates(run)).toEqual({
      "code-style@api": "not-verifiable",
      "code-style@web": "not-verifiable",
    });
  });

  it("sends nothing when no register entry depends on the platform", async () => {
    const built = declaredRepository();
    fixtures.push({ ...built.fixture, cleanup: built.cleanup });

    const run = await reconcile(
      built.fixture.repoPath,
      ASK,
      reaching(nothingMayBeSent())
    );

    expect(run.code).toBe(0);
    expect(platformState(run)).toBe("not-needed");
  });
});
