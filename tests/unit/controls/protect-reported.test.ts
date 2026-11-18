/**
 * `lisa controls protect` never requires a check nothing has reported.
 *
 * A required check that never reports does not fail a pull request: the
 * platform holds it waiting for ever, with no failure to read. So before a
 * check is sent as required, the platform must show a result under that
 * exact name, from the source the write would require it from — on the head
 * of the protected branch, or on the head of a pull request that was merged
 * into it. An open pull request, or one closed without being merged, shows
 * what somebody proposed, not what the branch runs. One the platform shows
 * nothing for is `not-ready`; one it could not be asked about is `unknown`;
 * neither is ever in a write. The proof costs reads only
 * (CodySwannGT/lisa#4993).
 *
 * Where a result counts, and from whom, is in
 * `./protect-reported-source.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { F_PAVED_GATES } from "../../helpers/control-register.js";
import { fakeGithub, statusCheckRuleset } from "./support/fake-github.js";
import {
  LINT_CHECK,
  REPO,
  REVIEW_CHECK as REVIEW,
  handover,
  protect,
  protectFixture,
  sentAsRequired,
  type ProtectFixtureOptions,
} from "./support/protect-fixture.js";

const APPLY = { apply: true } as const;
const COMMITS = `repos/${REPO}/commits`;
const HEAD_RUNS = `${COMMITS}/heads/main/check-runs?per_page=100`;
const HEAD_STATUS = `${COMMITS}/heads/main/status?per_page=100`;
const MERGED_PULLS = `repos/${REPO}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=30`;
const FIRST_PULL = `${COMMITS}/01c0ffee${"0".repeat(32)}`;

const fixtures: ControlAuditFixture[] = [];

/**
 * Build a fixture that is removed after the case. It has a workflow folder.
 * @param options - How it differs from F-mixed with its declaration
 * @returns The repository root
 */
function repository(options: ProtectFixtureOptions = {}): string {
  const built = protectFixture(options);
  fixtures.push(built);
  return built.repoPath;
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("a check the platform has never shown a result for", () => {
  it("is not written, is not-ready, and blocks, even with a workflow folder and permission", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: true, reported: [] });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.required_checks).toEqual([
      expect.objectContaining({ context: LINT_CHECK, state: "not-ready" }),
    ]);
    expect(result.required_checks[0]?.detail).toMatch(/^It has not run yet:/u);
    expect(result.entries.map(entry => entry.outcome)).toEqual([
      "blocked",
      "blocked",
    ]);
    expect(result.reason).toMatch(/It has not run yet/u);
  });

  it("is named in the handover with what has to happen first", async () => {
    const repoPath = repository();

    await protect(
      repoPath,
      fakeGithub({ repo: REPO, admin: false, reported: [] })
    );

    const text = handover(repoPath) ?? "";
    expect(text).toContain("| GitHub Actions | Not yet |");
    expect(text).toContain(`- \`${LINT_CHECK}\`: It has not run yet:`);
    expect(text).toMatch(
      /First merge the workflow \(or install the app\) that reports it and let it run once/u
    );
  });

  it("is looked for on the branch, then on the pull requests merged into it, with reads only", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: ["Some Other Check"],
      pulls: [["Another Check"]],
    });

    await protect(repository(), github, APPLY);

    const proving = github.log.slice(2);
    expect(proving.map(request => request.method)).toEqual(
      proving.map(() => "GET")
    );
    expect(proving.map(request => request.path)).toEqual([
      HEAD_RUNS,
      HEAD_STATUS,
      MERGED_PULLS,
      `${FIRST_PULL}/check-runs?per_page=100`,
      `${FIRST_PULL}/status?per_page=100`,
    ]);
    expect(github.writes()).toEqual([]);
  });

  it("is left out of a write that carries the checks that have run", async () => {
    const repoPath = repository({ gates: F_PAVED_GATES });
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [LINT_CHECK, REVIEW],
    });

    const result = await protect(repoPath, github, APPLY);

    expect(new Set(sentAsRequired(github))).toEqual(
      new Set([LINT_CHECK, REVIEW])
    );
    expect(sentAsRequired(github)).toHaveLength(2);
    expect(
      result.required_checks.map(check => [check.context, check.state])
    ).toEqual([
      [REVIEW, "required"],
      ["🔍 Quality Checks / 🔒 Security Scan", "not-ready"],
      ["🔍 Quality Checks / 🧪 Run Unit Tests", "not-ready"],
      [LINT_CHECK, "required"],
    ]);
    expect(result.outcome).toBe("blocked");
  });
});

describe("a check the platform shows a result for", () => {
  it("is written when it has run on the protected branch, for one more read", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [LINT_CHECK],
    });

    const result = await protect(repository(), github, APPLY);

    expect(sentAsRequired(github)).toEqual([LINT_CHECK]);
    expect(result.outcome).toBe("wired");
    expect(github.log.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET repos/${REPO}/rulesets?per_page=100`,
      `GET repos/${REPO}`,
      `GET ${HEAD_RUNS}`,
      `POST repos/${REPO}/rulesets`,
      `GET repos/${REPO}/rulesets?per_page=100`,
      `GET repos/${REPO}/rulesets/1`,
    ]);
  });

  it("is written when it has only run on a pull request that was merged into the branch", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [],
      pulls: [["Unrelated"], [LINT_CHECK]],
    });

    const result = await protect(repository(), github, APPLY);

    expect(sentAsRequired(github)).toEqual([LINT_CHECK]);
    expect(result.outcome).toBe("wired");
  });

  it("is not looked for when it is already required", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [],
      rulesets: [statusCheckRuleset(7, "quality checks", [LINT_CHECK])],
    });

    const result = await protect(repository(), github, APPLY);

    expect(result.outcome).toBe("wired");
    expect(github.log.some(request => request.path.includes("/commits/"))).toBe(
      false
    );
  });
});

describe("a check whose history cannot be read", () => {
  it("is unknown and is not written when the proving read fails", async () => {
    const repoPath = repository();
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reportFailure: "Resource not accessible",
    });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.required_checks[0]?.state).toBe("unknown");
    expect(result.required_checks[0]?.detail).toMatch(
      /^It could not be read whether this check has ever run/u
    );
    expect(result.required_checks[0]?.detail).toContain(
      "Resource not accessible"
    );
    expect(result.differences).toEqual([
      `\`${LINT_CHECK}\` is not required on \`main\`.`,
    ]);
    expect(handover(repoPath)).toContain("| GitHub Actions | Not confirmed |");
  });

  it("is unknown, not not-ready, when a list came back incomplete", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: ["Some Other Check"],
      checkRunTotal: 250,
    });

    const result = await protect(repository(), github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.required_checks[0]?.state).toBe("unknown");
    expect(result.required_checks[0]?.detail).toMatch(/incomplete/u);
  });

  it("is still written when it was seen in a list that came back incomplete", async () => {
    const github = fakeGithub({
      repo: REPO,
      admin: true,
      reported: [LINT_CHECK],
      checkRunTotal: 250,
    });

    const result = await protect(repository(), github, APPLY);

    expect(sentAsRequired(github)).toEqual([LINT_CHECK]);
    expect(result.outcome).toBe("wired");
  });
});
