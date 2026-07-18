import { describe, expect, it, vi } from "vitest";
import {
  createGithubRepoProbe,
  expectedLabelsFromConfig,
  type GithubRepoGhReads,
} from "../../../src/cli/ui-github-repo.js";
import type { JsonObject } from "../../../src/sync/json-path.js";
import { runProbe } from "../../../src/cli/ui-status.js";

const OWNER = "acme";
const REPO = "acme-app";
const AUTHENTICATED = "authenticated" as const;
const STATUS_READY = "status:ready";
const STATUS_BLOCKED = "status:blocked";
const CONFIG: JsonObject = {
  github: {
    org: OWNER,
    repo: REPO,
    labels: {
      build: {
        ready: STATUS_READY,
        claimed: "status:in-progress",
        blocked: STATUS_BLOCKED,
        human_needed: "human-needed",
        done: {
          dev: "status:on-dev",
          staging: "status:on-stg",
          production: "status:done",
        },
      },
      prd: {
        draft: "prd-draft",
        ready: "prd-ready",
      },
    },
  },
};

/**
 * Build injectable gh reads for focused probe tests.
 * @param overrides - Partial collaborators to replace
 * @returns Complete injectable read surface
 */
function reads(overrides: Partial<GithubRepoGhReads> = {}): GithubRepoGhReads {
  return {
    readSettings: async () => ({
      allow_merge_commit: true,
      allow_squash_merge: false,
      allow_rebase_merge: false,
      allow_auto_merge: true,
      allow_update_branch: true,
      delete_branch_on_merge: true,
      merge_commit_title: "MERGE_MESSAGE",
      has_issues: true,
      has_wiki: false,
      secret_scanning: true,
      default_branch: "main",
    }),
    listRulesets: async () => [
      {
        name: "base",
        appliesTo: "dev · staging · main",
        enforces: "deletion, non_fast_forward, pull_request",
        active: true,
      },
    ],
    listLabels: async () => [
      { name: STATUS_READY, color: "fbca04" },
      { name: "status:in-progress", color: "0e8a16" },
    ],
    listSecretNames: async () => ["DEPLOY_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
    ...overrides,
  };
}

describe("expectedLabelsFromConfig", () => {
  it("flattens nested github.labels into role paths", () => {
    const labels = expectedLabelsFromConfig(CONFIG);
    expect(labels).toEqual(
      expect.arrayContaining([
        { name: STATUS_READY, role: "build · ready" },
        { name: "status:on-dev", role: "build · done · dev" },
        { name: "prd-draft", role: "prd · draft" },
      ])
    );
  });
});

describe("createGithubRepoProbe", () => {
  it("returns unknown not-authenticated without calling any repo reads", async () => {
    const readSettings = vi.fn();
    const listRulesets = vi.fn();
    const listLabels = vi.fn();
    const listSecretNames = vi.fn();

    const result = await runProbe(
      createGithubRepoProbe(".", CONFIG, {
        authenticate: async () => "not-authenticated",
        reads: {
          readSettings,
          listRulesets,
          listLabels,
          listSecretNames,
        },
      })
    );

    expect(result).toEqual({
      state: "unknown",
      reason: "not-authenticated",
      message: "GitHub CLI is not authenticated",
    });
    expect(result).not.toHaveProperty("value");
    expect(readSettings).not.toHaveBeenCalled();
    expect(listRulesets).not.toHaveBeenCalled();
    expect(listLabels).not.toHaveBeenCalled();
    expect(listSecretNames).not.toHaveBeenCalled();
  });

  it("returns unknown when github.org/repo are missing", async () => {
    const result = await runProbe(
      createGithubRepoProbe(
        ".",
        { tracker: "github" },
        {
          authenticate: async () => AUTHENTICATED,
          reads: reads(),
        }
      )
    );

    expect(result).toMatchObject({
      state: "unknown",
      reason: "repo-not-configured",
    });
    expect(result).not.toHaveProperty("value");
  });

  it("lists live rulesets and marks expected-but-absent labels missing", async () => {
    const result = await runProbe(
      createGithubRepoProbe(".", CONFIG, {
        authenticate: async () => AUTHENTICATED,
        reads: reads(),
      })
    );

    expect(result.state).toBe("value");
    if (result.state !== "value") {
      return;
    }
    const labels = result.value.labels as readonly {
      readonly name: string;
      readonly present: boolean;
      readonly color: string;
    }[];
    expect(result.value.rulesets).toEqual([
      {
        name: "base",
        appliesTo: "dev · staging · main",
        enforces: "deletion, non_fast_forward, pull_request",
        active: true,
      },
    ]);
    const ready = labels.find(label => label.name === STATUS_READY);
    const blocked = labels.find(label => label.name === STATUS_BLOCKED);
    expect(ready).toMatchObject({ present: true, color: "fbca04" });
    expect(blocked).toMatchObject({ present: false });
  });

  it("reports secret presence only and never includes a secret value field", async () => {
    const result = await runProbe(
      createGithubRepoProbe(".", CONFIG, {
        authenticate: async () => AUTHENTICATED,
        reads: reads(),
      })
    );

    expect(result.state).toBe("value");
    if (result.state !== "value") {
      return;
    }
    const secrets = result.value.secrets as readonly {
      readonly name: string;
      readonly purpose: string;
      readonly set: boolean;
    }[];
    const deploy = secrets.find(secret => secret.name === "DEPLOY_KEY");
    const snyk = secrets.find(secret => secret.name === "SNYK_TOKEN");
    expect(deploy).toEqual({
      name: "DEPLOY_KEY",
      purpose:
        "Write deploy key so CI can push version bumps through ruleset bypass",
      set: true,
    });
    expect(snyk).toMatchObject({ name: "SNYK_TOKEN", set: false });
    for (const secret of secrets) {
      expect(
        Object.keys(secret).toSorted((left, right) => left.localeCompare(right))
      ).toEqual(["name", "purpose", "set"]);
      expect(JSON.stringify(secret)).not.toMatch(/ghp_|github_pat_|-----BEGIN/);
    }
  });

  it("surfaces live repository settings in the value payload", async () => {
    const result = await runProbe(
      createGithubRepoProbe(".", CONFIG, {
        authenticate: async () => AUTHENTICATED,
        reads: reads({
          readSettings: async () => ({
            allow_merge_commit: true,
            allow_squash_merge: false,
            allow_rebase_merge: false,
            allow_auto_merge: true,
            allow_update_branch: true,
            delete_branch_on_merge: true,
            merge_commit_title: "PR_TITLE",
            has_issues: false,
            has_wiki: false,
            secret_scanning: false,
            default_branch: "staging",
          }),
        }),
      })
    );

    expect(result).toMatchObject({
      state: "value",
      value: {
        owner: OWNER,
        repo: REPO,
        settings: {
          merge_commit_title: "PR_TITLE",
          has_issues: false,
          default_branch: "staging",
          secret_scanning: false,
        },
      },
    });
  });
});
