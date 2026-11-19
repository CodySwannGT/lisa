/**
 * `lisa controls protect` in a repository that is not on github.com, and in
 * one whose checks cannot safely be required yet.
 *
 * Merge protection is changed on GitHub only. Anywhere else the command sends
 * nothing at all — not even a read — and writes the file an administrator
 * acts on. The request log is asserted in every case, with `--apply` given
 * and an account that could have written (CodySwannGT/lisa#4993).
 */
import { afterEach, describe, expect, it } from "vitest";

import type { ControlAuditFixture } from "../../helpers/control-audit-fixtures.js";
import { F_MIXED_GATES, evidenceAt } from "../../helpers/control-register.js";
import { fakeGithub } from "./support/fake-github.js";
import {
  GITHUB_REMOTE,
  LINT_CHECK,
  REPO,
  handover,
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
 * Answer a fixed remote address, whatever repository is asked about.
 * @param url - The address, or `null` for no remote
 * @returns The reader to hand the command
 */
function remote(url: string | null): {
  readonly readRemoteUrl: () => Promise<string | null>;
} {
  return { readRemoteUrl: () => Promise.resolve(url) };
}

afterEach(() => {
  fixtures.splice(0).forEach(built => {
    built.cleanup();
  });
});

describe("lisa controls protect on another hosting platform", () => {
  it.each([
    ["https://gitlab.com/group/project.git", "gitlab", "GitLab"],
    ["git@bitbucket.org:team/project.git", "bitbucket", "Bitbucket"],
    [
      "https://github.example.test/team/project.git",
      "github-enterprise",
      "GitHub (self-hosted)",
    ],
  ])(
    "sends nothing for %s and hands the change over",
    async (url, name, shown) => {
      const repoPath = repository();
      const github = fakeGithub({ repo: REPO, admin: true });

      const result = await protect(repoPath, github, APPLY, remote(url));

      expect(github.log).toEqual([]);
      expect(result.requests).toEqual([]);
      expect(result.platform.name).toBe(name);
      expect(result.outcome).toBe("blocked");
      expect(result.permission.can_change).toBeNull();
      expect(result.required_checks.map(check => check.state)).toEqual([
        "unknown",
      ]);
      expect(result.differences).toEqual([]);
      expect(handover(repoPath)).toContain(`- Platform: ${shown}`);
    }
  );

  it("sends nothing when the repository has no remote", async () => {
    const repoPath = repository();
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY, remote(null));

    expect(github.log).toEqual([]);
    expect(result.platform.name).toBe("unknown");
    expect(result.outcome).toBe("blocked");
    expect(handover(repoPath)).not.toBeNull();
  });

  it("sends nothing when the declaration names an executor on another platform", async () => {
    const repoPath = repository({
      gates: {
        ...F_MIXED_GATES,
        "code-style": {
          ...(F_MIXED_GATES["code-style"] as Record<string, unknown>),
          "pull-request": {
            level: "required",
            executor: { platform: "gitlab", path: ".gitlab-ci.yml" },
          },
        },
      },
    });
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(
      repoPath,
      github,
      APPLY,
      remote(GITHUB_REMOTE)
    );

    expect(github.log).toEqual([]);
    expect(result.platform.reachable).toBe(false);
    expect(result.outcome).toBe("blocked");
    expect(result.reason).toMatch(/executor on GitLab/u);
  });
});

describe("lisa controls protect when a check cannot be required yet", () => {
  it("does not require a pipeline check in a repository with no workflow folder", async () => {
    const repoPath = repository({ workflows: false });
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.required_checks.map(check => check.state)).toEqual([
      "not-ready",
    ]);
    expect(result.reason).toMatch(/\.github\/workflows/u);
    expect(handover(repoPath)).toContain("Not yet");
  });

  it("does not require a check the configuration says never to require", async () => {
    const repoPath = repository({
      config: {
        github: { rulesets: { dropRequiredChecks: [LINT_CHECK] } },
      },
    });
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.required_checks.map(check => check.state)).toEqual([
      "excluded",
    ]);
    expect(result.reason).toMatch(/dropRequiredChecks/u);
  });
});

describe("lisa controls protect when the register asks nothing of the platform", () => {
  it("sends nothing and reports that there is nothing to require", async () => {
    const repoPath = repository({
      gates: {
        "type-correctness": {
          push: "required",
          parts: [
            {
              scope: "web",
              command: ["npx", "tsc", "--noEmit"],
              evidence: evidenceAt("web/tsconfig.json"),
            },
          ],
        },
      },
    });
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY);

    expect(github.log).toEqual([]);
    expect(result.outcome).toBe("nothing-to-require");
    expect(result.entries).toEqual([]);
    expect(result.handover.action).toBe("none");
  });

  it("reports an entry with no check a platform can require as blocked", async () => {
    const repoPath = repository({
      gates: {
        "destructive-safety": {
          "pull-request": "required",
          tier: "authoritative",
        },
      },
    });
    const github = fakeGithub({ repo: REPO, admin: true });

    const result = await protect(repoPath, github, APPLY);

    expect(github.writes()).toEqual([]);
    expect(result.outcome).toBe("blocked");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.checks).toEqual([]);
    expect(result.entries[0]?.reason).toMatch(
      /no check a platform can require/u
    );
    expect(handover(repoPath)).toBeNull();
  });
});
