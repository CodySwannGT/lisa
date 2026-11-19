/**
 * Where a repository is hosted, and whether `lisa controls protect` may send
 * that platform anything.
 *
 * The answer comes from the `origin` remote's address and from any
 * pull-request `executor.platform` the gates declaration names. Only a
 * github.com remote that the declaration does not contradict may be sent a
 * request (CodySwannGT/lisa#4993).
 */
import { describe, expect, it } from "vitest";

import {
  declaredExecutorPlatforms,
  detectPlatform,
  parseRemoteAddress,
  platformOfHost,
} from "../../../src/controls/protect-platform.js";

const REPO = "example-owner/example-repo";
const NO_GATES = {};
const GITHUB_HOST = "github.com";
const AZURE = "azure-devops";

/**
 * A gates block whose one gate names a pull-request executor platform.
 * @param platform - The platform as the declaration writes it
 * @returns The block
 */
function gatesOn(platform: unknown): Record<string, unknown> {
  return {
    "code-style": {
      "pull-request": {
        level: "required",
        executor: { platform, path: "ci/pull-request.yml" },
      },
    },
  };
}

describe("a remote address taken apart", () => {
  it.each([
    [`https://github.com/${REPO}.git`, GITHUB_HOST, REPO],
    [`https://github.com/${REPO}`, GITHUB_HOST, REPO],
    [`git@github.com:${REPO}.git`, GITHUB_HOST, REPO],
    [`ssh://git@github.com:22/${REPO}.git`, GITHUB_HOST, REPO],
    [`https://user@GitHub.com/${REPO}/`, GITHUB_HOST, REPO],
    [
      "https://gitlab.example.test/group/sub/project.git",
      "gitlab.example.test",
      "group/sub/project",
    ],
  ])("%s", (url, host, path) => {
    expect(parseRemoteAddress(url)).toEqual({ host, path });
  });

  it.each(["/srv/git/project.git", "../project", "", "file:///srv/project"])(
    "has no host in %j",
    url => {
      expect(parseRemoteAddress(url)).toBeNull();
    }
  );
});

describe("the platform of a host", () => {
  it.each([
    [GITHUB_HOST, "github"],
    ["www.github.com", "github"],
    ["github.example.test", "github-enterprise"],
    ["gitlab.com", "gitlab"],
    ["gitlab.example.test", "gitlab"],
    ["bitbucket.org", "bitbucket"],
    ["dev.azure.com", AZURE],
    ["example.visualstudio.com", AZURE],
    ["git.example.test", "unknown"],
  ])("%s is %s", (host, platform) => {
    expect(platformOfHost(host)).toBe(platform);
  });
});

describe("the executor platforms a declaration names", () => {
  it("reads the key where it is present and passes over every other shape", () => {
    expect(
      declaredExecutorPlatforms({
        ...gatesOn("GitLab"),
        "no-moment": {},
        "level-only": { "pull-request": "required" },
        "no-executor": { "pull-request": { level: "required" } },
        "executor-not-object": {
          "pull-request": { level: "required", executor: "gitlab" },
        },
        "platform-not-text": {
          "pull-request": { level: "required", executor: { platform: 7 } },
        },
        "not-a-gate": null,
      })
    ).toEqual(["gitlab"]);
  });

  it("treats every GitHub spelling as GitHub", () => {
    expect(declaredExecutorPlatforms(gatesOn("github-actions"))).toEqual([
      "github",
    ]);
  });
});

describe("whether the platform may be sent a request", () => {
  it("may, for a github.com remote naming one repository", () => {
    expect(detectPlatform(`https://github.com/${REPO}.git`, NO_GATES)).toEqual({
      name: "github",
      repository: REPO,
      detected_from: "remote",
      reachable: true,
      note: null,
    });
  });

  it("may, when the declaration names a GitHub executor too", () => {
    expect(
      detectPlatform(`git@github.com:${REPO}.git`, gatesOn("github")).reachable
    ).toBe(true);
  });

  it("may not, when the declaration names an executor elsewhere", () => {
    const facts = detectPlatform(
      `https://github.com/${REPO}.git`,
      gatesOn("gitlab")
    );

    expect(facts.reachable).toBe(false);
    expect(facts.note).toMatch(/disagree/u);
  });

  it("may not, when a GitHub address does not name owner/name", () => {
    expect(
      detectPlatform("https://github.com/only-one-part", NO_GATES).reachable
    ).toBe(false);
  });

  it.each([
    ["https://gitlab.com/group/project.git", "gitlab"],
    ["git@bitbucket.org:team/project.git", "bitbucket"],
    ["https://dev.azure.com/org/project/_git/repo", AZURE],
    ["https://github.example.test/team/project.git", "github-enterprise"],
  ])("may not, for %s", (url, name) => {
    const facts = detectPlatform(url, NO_GATES);

    expect(facts.name).toBe(name);
    expect(facts.detected_from).toBe("remote");
    expect(facts.reachable).toBe(false);
    expect(facts.note).toMatch(/nothing was sent/u);
  });

  it("takes the platform from the declaration when there is no remote", () => {
    expect(detectPlatform(null, gatesOn("gitlab"))).toMatchObject({
      name: "gitlab",
      repository: null,
      detected_from: "declaration",
      reachable: false,
    });
  });

  it("does not know, and sends nothing, when nothing says", () => {
    expect(detectPlatform(null, NO_GATES)).toMatchObject({
      name: "unknown",
      detected_from: "none",
      reachable: false,
    });
    expect(
      detectPlatform("https://git.example.test/team/project.git", NO_GATES)
    ).toMatchObject({ name: "unknown", reachable: false });
  });
});
