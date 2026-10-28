/** Native provider resources staged independently from captured proof payloads. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { git, type Fixture } from "./work-item-cli.js";
import { installStatefulProvider } from "./work-item-stateful-provider.js";
import {
  PUBLISHER,
  setApi,
  setCompare,
  type ProofFacts,
} from "./work-item-proof-assets.js";
const WORKFLOW = ".github/workflows/deploy.yml";
const PAGINATE = "--paginate";
/**
 * Register source reconciliation and selected whole delivery run.
 * @param fixture - Owned disposable repository.
 * @param facts - Actual fixture Git and provider identities.
 */
function sourceResources(fixture: Fixture, facts: ProofFacts): void {
  const { repository, sourceRef, branch, prHead, merge, now } = facts;
  const REPO = `repos/${repository}`;
  setApi(fixture, ["api", `${REPO}/pulls/7`], {
    json: {
      number: 7,
      merged: true,
      state: "closed",
      merged_at: now,
      html_url: `https://github.com/${repository}/pull/7`,
      body: `Work-Item: ${sourceRef}`,
      merge_commit_sha: merge,
      head: { sha: prHead },
      base: { ref: branch },
    },
  });
  for (const sha of [prHead, merge])
    setApi(fixture, ["api", `${REPO}/commits/${sha}`], {
      json: {
        sha,
        commit: {
          message: git(
            fixture.root,
            ["show", "-s", "--format=%B", sha],
            fixture.env
          ),
        },
        parents: git(
          fixture.root,
          ["show", "-s", "--format=%P", sha],
          fixture.env
        )
          .split(" ")
          .map(parent => ({ sha: parent })),
      },
    });
  setApi(fixture, ["api", `${REPO}/branches/${encodeURIComponent(branch)}`], {
    json: { commit: { sha: merge } },
  });
  setCompare(fixture, prHead, merge);
  setCompare(fixture, merge, merge);
  setApi(fixture, ["api", `${REPO}/actions/runs/31`], {
    json: {
      id: 31,
      repository: { id: 881 },
      workflow_id: 22,
      path: WORKFLOW,
      event: "push",
      head_branch: branch,
      head_sha: merge,
      run_attempt: 1,
      status: "completed",
      conclusion: "success",
      created_at: now,
      updated_at: now,
    },
  });
}
/**
 * Build the explicit native issue snapshot independently of provider setup.
 * @param facts - Exact fixture identity or captured description.
 * @returns Initial native-shaped issue snapshot.
 */
function nativeProofIssue(facts: ProofFacts) {
  const { repository, number, body, now } = facts;
  return {
    id: `I_fixture${number}`,
    number,
    body,
    state: "OPEN",
    stateReason: "",
    url: `https://github.com/${repository}/issues/${number}`,
    assignees: [{ login: "fixture-owner" }],
    labels: [
      { name: "status:in-progress" },
      { name: "type:Bug" },
      { name: "component:ci" },
    ],
    closedByPullRequestsReferences: [],
    comments: [
      {
        id: 1,
        body: `[lisa-pr-link] https://github.com/${repository}/pull/7`,
        user: PUBLISHER,
        created_at: now,
        updated_at: now,
      },
    ],
  };
}

/**
 * Install explicit native resources before creating captured attachment bytes.
 * @param fixture - Owned disposable repository.
 * @param facts - Actual fixture Git and provider identities.
 * @returns The same source identities after provider initialization.
 */
export function prepareProofProvider(
  fixture: Fixture,
  facts: ProofFacts
): ProofFacts {
  const { repository, number, now } = facts;
  const REPO = `repos/${repository}`;
  const state = nativeProofIssue(facts);
  installStatefulProvider(fixture, JSON.stringify(state));
  fixture.env.FAKE_GH_LOG = path.join(fixture.root, "gh.log");
  fixture.env.FAKE_GH_REPOSITORY = repository;
  fixture.env.FAKE_GH_API_FILE = path.join(fixture.root, "api.json");
  fixture.env.FAKE_GH_ASSET_DIRECTORY = path.join(fixture.root, "assets");
  fixture.env.FAKE_GH_ASSET_INDEX = path.join(fixture.root, "assets.json");
  fixture.env.FAKE_GH_PUBLISHER = JSON.stringify(PUBLISHER);
  fixture.env.FAKE_GH_TIMELINE_JSON = JSON.stringify([
    {
      event: "cross-referenced",
      source: {
        issue: {
          number: 7,
          pull_request: { merged_at: now },
          repository_url: `https://api.github.com/repos/${repository}`,
        },
      },
    },
  ]);
  fixture.env.FAKE_GH_LIST_JSON = JSON.stringify([
    { number: 42, title: "Synthetic verified feature" },
  ]);
  mkdirSync(fixture.env.FAKE_GH_ASSET_DIRECTORY);
  writeFileSync(fixture.env.FAKE_GH_API_FILE, "{}");
  writeFileSync(fixture.env.FAKE_GH_ASSET_INDEX, "[]");
  setApi(fixture, ["api", REPO], { json: { id: 881, full_name: repository } });
  setApi(fixture, ["api", "user"], { json: PUBLISHER });
  setApi(
    fixture,
    ["api", `${REPO}/collaborators/fixture-publisher/permission`],
    { json: { permission: "admin", user: PUBLISHER } }
  );
  setApi(
    fixture,
    [
      "api",
      PAGINATE,
      "--slurp",
      `${REPO}/issues/${number}/comments?per_page=100`,
    ],
    { kind: "comments" }
  );
  setApi(fixture, ["api", `${REPO}/releases/tags/pr-assets`], {
    json: { id: 19 },
  });
  setApi(
    fixture,
    ["api", PAGINATE, "--slurp", `${REPO}/releases/19/assets?per_page=100`],
    { kind: "assets" }
  );

  sourceResources(fixture, facts);
  return facts;
}
