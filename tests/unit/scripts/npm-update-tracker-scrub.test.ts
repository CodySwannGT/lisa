/**
 * CodySwannGT/lisa#4859 review fix N6: Jira, Atlassian and Linear credentials
 * never reach an ordinary hook or a nested tool child, exactly like the GitHub
 * tokens already scrubbed there. Everything else passes through unchanged.
 */
import { describe, expect, it } from "vitest";
import { tokenFreeHookEnvironment } from "../../../all/copy-overwrite/scripts/lib/npm-update-hosted-hook.mjs";
import { childEnvironment } from "../../../all/copy-overwrite/scripts/lib/npm-update-execution-adapter.mjs";

const TRACKER = {
  JIRA_API_TOKEN: "t",
  JIRA_LOGIN: "l",
  JIRA_SERVER: "s",
  ATLASSIAN_API_TOKEN: "a",
  LINEAR_API_KEY: "k",
  LINEAR_API_KEY_acme: "w",
};
const GITHUB = { GH_TOKEN: "g", GITHUB_TOKEN: "h" };
const KEPT = { PATH: "/usr/bin:/bin", HOME: "/home/x", LINEAR_TEAM: "ENG" };

describe("tracker credentials are scrubbed from child environments", () => {
  it("removes tracker and GitHub credentials from the hook environment", () => {
    expect(
      tokenFreeHookEnvironment({ ...TRACKER, ...GITHUB, ...KEPT })
    ).toEqual(KEPT);
  });

  it("removes tracker and GitHub credentials from a nested tool child", () => {
    expect(
      childEnvironment({ env: { ...TRACKER, ...GITHUB, ...KEPT } }, "", false)
    ).toEqual(KEPT);
  });

  it("still sets the dispatch context for a canonical child", () => {
    expect(childEnvironment({ env: { ...KEPT } }, "/ctx.json", true)).toEqual({
      ...KEPT,
      LISA_NPM_DISPATCH_CONTEXT: "/ctx.json",
    });
  });
});
