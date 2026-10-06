/** Pure authority inputs narrow exact helpers; fixtures do not authenticate GitHub or released helpers. */
import { describe, expect, it } from "vitest";
import {
  canonicalHelperArguments,
  controllerSubject,
  controllerDeadline,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-controller-factory.mjs";

const repository = "acme/widgets";
const workItem = `${repository}#42`;
const stagePhase = "stage-read";
const parent = "a".repeat(40);
const context = {
  config: { tracker: "github", github: { org: "acme", repo: "widgets" } },
  policy: { repository, maintainer: "maintainer" },
  proposal: { repository, key: "b".repeat(64), parent },
  allocation: {
    number: 42,
    workItem: `${repository}#42`,
    claimCommentId: "123",
  },
  descriptor: {
    parent,
    workItem: `${repository}#42`,
    claimCommentId: "123",
    runId: "10",
    runAttempt: "1",
  },
};
const pr = { number: 12, html_url: "https://github.com/acme/widgets/pull/12" };

describe("controller-derived canonical helper recipes", () => {
  it("caps each helper to the remaining original phase and refuses expiration without renewal", () => {
    expect(controllerDeadline({ deadline: 1010 }, 1000)).toBe(1010);
    expect(controllerDeadline({ deadline: 1_801_000 }, 1000)).toBe(121000);
    expect(() => controllerDeadline({ deadline: 1000 }, 1000)).toThrow(/phase/);
    expect(() => controllerDeadline({}, 1000)).toThrow(/phase/);
  });
  it("refuses the publisher's formerly uninstrumented helper path before executing a credentialed child", async () => {
    const { GitHub } =
      await import("../../../all/copy-overwrite/scripts/lib/npm-update-github.mjs");
    const calls: unknown[] = [];
    const fixture = {
      policy: { repository, ghExecutable: "/usr/bin/false" },
      token: "synthetic-unit-token",
      execute: async (...args: unknown[]) => {
        calls.push(args);
        return { code: 0 };
      },
    };
    await expect(
      Reflect.apply(GitHub.prototype.workItem, fixture, [
        "/unused",
        ["backlink", "--ref", workItem, "--pr-url", pr.html_url],
      ])
    ).rejects.toThrow(/controller authority/);
    expect(calls).toEqual([]);
  });

  it("constructs immutable stage and publication argv from exact allocation and actual PR", () => {
    expect(canonicalHelperArguments(context, stagePhase, "link", null)).toEqual(
      ["link", workItem]
    );
    expect(
      canonicalHelperArguments(context, stagePhase, "attach-branch", null)
    ).toEqual(["attach-branch"]);
    expect(
      canonicalHelperArguments(context, "publication-backlink", "backlink", pr)
    ).toEqual(["backlink", "--ref", workItem, "--pr-url", pr.html_url]);
    expect(
      canonicalHelperArguments(
        { ...context, commit: { sha: "c".repeat(40) } },
        "publication-validate-pr",
        "validate-pr",
        pr
      )
    ).toEqual([
      "validate-pr",
      "--base",
      parent,
      "--head",
      "c".repeat(40),
      "--pr-number",
      "12",
      "--repo",
      repository,
      "--pr-url",
      pr.html_url,
    ]);
  });

  it("refuses unrelated repo/ref/PR and phase escalation before any native provider process", () => {
    expect(() =>
      controllerSubject(
        {
          ...context,
          allocation: { ...context.allocation, workItem: "acme/other#42" },
        },
        stagePhase,
        null
      )
    ).toThrow(/allocation/);
    expect(() =>
      controllerSubject(context, "publication-backlink", {
        ...pr,
        html_url: "https://github.com/acme/other/pull/12",
      })
    ).toThrow(/PR/);
    expect(() =>
      canonicalHelperArguments(context, stagePhase, "backlink", pr)
    ).toThrow(/phase/);
    expect(() =>
      controllerSubject(
        {
          ...context,
          config: {
            ...context.config,
            github: { ...context.config.github, queueRepo: "other/repo" },
          },
        },
        stagePhase,
        null
      )
    ).toThrow(/umbrella/);
  });
});
