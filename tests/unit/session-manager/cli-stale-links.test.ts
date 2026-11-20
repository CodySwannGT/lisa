/**
 * The real `stale-links-plan` CLI (CodySwannGT/lisa#5065): it reads the
 * configured done and lifecycle roles, reads GitHub itself through `gh` (a
 * stub that answers per endpoint), takes Jira and Linear as a paged envelope,
 * and writes nothing.
 * @module tests/unit/session-manager/cli-stale-links
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  writeJson,
} from "./support/cli-harness.js";
import { runStubOnly as run } from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const REPO = "example-org/demo-repo";
const PLAN = "stale-links-plan";
const CONFIRM = "stale-links-confirm";
const READY = "status:ready";
const LIVE = "stage:live";

/**
 * A GitHub sandbox whose terminal done label is custom.
 * @returns Sandbox
 */
function githubSandbox() {
  return makeSandbox({
    extraConfig: {
      github: {
        org: "example-org",
        repo: "demo-repo",
        labels: {
          build: {
            ready: READY,
            blocked: "status:blocked",
            done: { dev: "stage:dev", production: LIVE },
          },
        },
      },
    },
  });
}

describe(PLAN, () => {
  it("reads GitHub itself and plans only the stale links", () => {
    const sandbox = githubSandbox();
    const routes = path.join(sandbox.root, "routes.json");
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues?state=open&per_page=100`,
        body: [
          [
            {
              number: 1,
              body: "Blocked by #9, #11",
              labels: [{ name: READY }],
              issue_dependencies_summary: { total_blocked_by: 2 },
            },
            { number: 2, body: "no links", labels: [] },
            { number: 3, body: "Blocked by #9", pull_request: {} },
          ],
        ],
      },
      {
        match: `repos/${REPO}/issues/1/dependencies/blocked_by?per_page=100`,
        body: [
          [
            {
              id: 801,
              number: 20,
              repository: { full_name: REPO },
              state: "open",
              labels: [{ name: LIVE }],
            },
            {
              id: 802,
              number: 21,
              repository: { full_name: REPO },
              state: "open",
              labels: [{ name: "stage:dev" }],
            },
          ],
        ],
      },
      { match: `repos/${REPO}/issues/9`, body: { state: "closed" } },
      { match: `repos/${REPO}/issues/1/comments?per_page=100`, body: [[]] },
    ]);
    const result = run(sandbox, [PLAN, "--tracker", "github"], {
      env: { STUB_GH_ROUTES: routes },
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      tracker: "github",
      doneRoles: [LIVE],
      plans: [
        {
          ref: `${REPO}#1`,
          actions: [
            {
              op: "delete-dependency",
              endpoint: `repos/${REPO}/issues/1/dependencies/blocked_by/801`,
            },
          ],
          body: "Blocked by #11",
          removed: [`${REPO}#20`, `${REPO}#9`],
          becomesClaimable: false,
        },
      ],
      report: {
        cleared: 2,
        // #21 sits in the dev rung: merged to a non-production environment,
        // so it holds nothing, but it is not finished, so its link stays.
        realBlockers: 0,
        landed: 1,
        inaccessible: [{ ref: `${REPO}#1`, blocker: `${REPO}#11` }],
      },
      summary:
        "stale links (plan): planned removal of 2 stale blocker links on 1 item; 0 real blockers remain on 0 items; could not open example-org/demo-repo#11 (on example-org/demo-repo#1); kept 1 link to work merged but not yet in production (not holding anything).",
    });
    // Reads only: no DELETE and no edit ever leaves the plan.
    const argv = result.calls.map(call => call.argv.join(" "));
    expect(argv.some(line => /-X|DELETE|edit|comment /.test(line))).toBe(false);
  });

  it("plans a Jira envelope with the configured done status", () => {
    const sandbox = makeSandbox({
      extraConfig: {
        tracker: "jira",
        jira: {
          workflow: { ready: "Ready", blocked: "Blocked", done: "Shipped" },
        },
      },
    });
    const input = path.join(sandbox.root, "links.json");
    writeJson(input, {
      complete: true,
      items: [
        {
          key: "ABC-1",
          fields: {
            status: { name: "Ready" },
            issuelinks: [
              {
                id: "10",
                type: { inward: "is blocked by" },
                inwardIssue: {
                  key: "ABC-9",
                  fields: {
                    status: {
                      name: "Shipped",
                      statusCategory: { key: "indeterminate" },
                    },
                  },
                },
              },
            ],
          },
          comments: [],
        },
      ],
    });
    const result = run(sandbox, [PLAN, "--tracker", "jira", "--input", input]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      doneRoles: ["shipped"],
      plans: [
        {
          ref: "ABC-1",
          actions: [{ op: "unlink", linkId: "10" }],
          becomesClaimable: true,
        },
      ],
    });
    expect(result.calls).toEqual([]);
  });

  it("refuses a half-read envelope and a tracker it does not know", () => {
    const sandbox = makeSandbox({ extraConfig: { tracker: "linear" } });
    const input = path.join(sandbox.root, "links.json");
    writeJson(input, { complete: false, items: [] });
    expect(run(sandbox, [PLAN, "--input", input]).status).toBe(2);
    expect(run(sandbox, [PLAN, "--tracker", "trello"]).status).toBe(2);
    expect(run(sandbox, [PLAN, "--tracker", "linear"]).status).toBe(2);
  });
});

describe(CONFIRM, () => {
  it("re-reads GitHub and keeps a link whose blocker reopened", () => {
    const sandbox = githubSandbox();
    const routes = path.join(sandbox.root, "routes.json");
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues/1`,
        body: {
          number: 1,
          body: "Edited by a person.\nBlocked by #9, #11",
          labels: [{ name: READY }],
          issue_dependencies_summary: { total_blocked_by: 0 },
        },
      },
      { match: `repos/${REPO}/issues/9`, body: { state: "closed" } },
      { match: `repos/${REPO}/issues/11`, body: { state: "open" } },
      { match: `repos/${REPO}/issues/1/comments?per_page=100`, body: [[]] },
    ]);
    const planFile = path.join(sandbox.root, "entry.json");
    writeJson(planFile, {
      ref: `${REPO}#1`,
      removed: [`${REPO}#9`, `${REPO}#11`],
      edges: [`github-body||${REPO}#9`, `github-body||${REPO}#11`],
    });
    const result = run(
      sandbox,
      [CONFIRM, "--tracker", "github", "--plan", planFile],
      { env: { STUB_GH_ROUTES: routes } }
    );
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      plan: {
        removed: [`${REPO}#9`],
        body: "Edited by a person.\nBlocked by #11",
      },
      skipped: [{ blocker: `${REPO}#11`, reason: "blocker-not-resolved" }],
    });
  });

  it("needs --plan, and --input for Jira", () => {
    const sandbox = makeSandbox({ extraConfig: { tracker: "jira" } });
    const planFile = path.join(sandbox.root, "entry.json");
    writeJson(planFile, { ref: "ABC-1", removed: ["ABC-9"] });
    expect(run(sandbox, [CONFIRM]).status).toBe(2);
    expect(run(sandbox, [CONFIRM, "--plan", planFile]).status).toBe(2);
  });
});
