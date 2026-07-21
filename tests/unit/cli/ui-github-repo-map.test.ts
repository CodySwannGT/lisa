import { describe, expect, it } from "vitest";
import {
  mapRepoSettings,
  mapRulesetRow,
} from "../../../src/cli/ui-github-repo-map.js";

describe("mapRepoSettings", () => {
  it("maps repository JSON including secret scanning status", () => {
    expect(
      mapRepoSettings({
        allow_merge_commit: true,
        allow_squash_merge: false,
        allow_rebase_merge: false,
        allow_auto_merge: true,
        allow_update_branch: true,
        delete_branch_on_merge: true,
        merge_commit_title: "MERGE_MESSAGE",
        has_issues: true,
        has_wiki: false,
        default_branch: "main",
        security_and_analysis: {
          secret_scanning: { status: "enabled" },
        },
      })
    ).toMatchObject({
      allow_merge_commit: true,
      secret_scanning: true,
      default_branch: "main",
    });
  });

  it("treats missing security_and_analysis as secret scanning off", () => {
    expect(
      mapRepoSettings({
        allow_merge_commit: false,
        allow_squash_merge: true,
        allow_rebase_merge: true,
        allow_auto_merge: false,
        allow_update_branch: false,
        delete_branch_on_merge: false,
        merge_commit_title: "PR_TITLE",
        has_issues: false,
        has_wiki: true,
        default_branch: "dev",
      }).secret_scanning
    ).toBe(false);
  });
});

describe("mapRulesetRow", () => {
  it("humanizes ref includes and joins rule types", () => {
    expect(
      mapRulesetRow({
        name: "base",
        enforcement: "active",
        conditions: {
          ref_name: {
            include: ["~DEFAULT_BRANCH", "refs/heads/main", "refs/tags/v*"],
          },
        },
        rules: [
          { type: "deletion" },
          { type: "pull_request" },
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "CI" }],
            },
          },
        ],
      })
    ).toEqual({
      name: "base",
      appliesTo: "default · main · v*",
      enforces: "deletion, pull_request, required_status_checks",
      active: true,
      targetsDefaultBranch: true,
      requiresPullRequest: true,
      requiresStatusChecks: true,
    });
  });
});
