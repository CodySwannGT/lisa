/**
 * End to end through the real CLI (CodySwannGT/lisa#5065): an item blocked
 * only by finished tickets is swept by `stale-links-plan`, the planned
 * removals are applied to the tracker input, and the same `queue` the
 * dispatcher runs then offers the item for pickup. Also: a Jira plan carries
 * its comment as an ADF document, and a GitHub `Blocked by` ref to another
 * repository is read from that repository.
 * @module tests/unit/session-manager/cli-stale-links-readiness
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";
import { runStubOnly as run } from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const REPO = "example-org/demo-repo";
const PLAN = "stale-links-plan";
const OPERATOR = "operator-uuid";
const UPDATED = "2026-10-20T00:00:00Z";
const SHIPPED = { name: "Shipped", type: "started" };

/**
 * Merge fields into the sandbox's sessionManager block.
 * @param sandbox - Project sandbox
 * @param patch - Fields to set
 */
function patchBlock(sandbox: Sandbox, patch: Record<string, unknown>): void {
  const file = path.join(sandbox.root, ".lisa.config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  writeJson(file, {
    ...config,
    sessionManager: { ...config.sessionManager, ...patch },
  });
}

/**
 * A raw Linear backlog node blocked by the given relations.
 * @param relations - Its `blocks` inverse relations
 * @returns Raw node
 */
function linearNode(relations: Record<string, unknown>[]) {
  return {
    identifier: "DEMO-3",
    title: "DEMO-3",
    priority: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: UPDATED,
    assignee: null,
    labels: { nodes: [] },
    description: "",
    creator: { id: "author" },
    children: { nodes: [] },
    state: { name: "Backlog", type: "backlog" },
    team: { key: "DEMO" },
    inverseRelations: { nodes: relations },
    comments: [],
  };
}

describe("stale links, end to end", () => {
  it("makes an item blocked only by finished tickets eligible for pickup", () => {
    const sandbox = makeSandbox({
      extraConfig: {
        tracker: "linear",
        linear: {
          workflow: { ready: "Ready", blocked: "Blocked", done: "Shipped" },
        },
      },
    });
    patchBlock(sandbox, { operatorIds: [OPERATOR], backlogPickup: true });
    const item = linearNode([
      {
        id: "rel-1",
        type: "blocks",
        issue: { identifier: "DEMO-8", state: SHIPPED, team: { key: "DEMO" } },
      },
      {
        id: "rel-2",
        type: "blocks",
        issue: {
          identifier: "DEMO-9",
          state: { name: "Done", type: "completed" },
          team: { key: "DEMO" },
        },
      },
    ]);
    const input = path.join(sandbox.root, "links.json");
    writeJson(input, { complete: true, items: [item] });
    const sweep = run(sandbox, [PLAN, "--input", input]);
    expect(sweep.status).toBe(0);
    const [planned] = sweep.json.plans;
    expect(planned.actions).toEqual([
      { op: "delete-relation", relationId: "rel-1" },
      { op: "delete-relation", relationId: "rel-2" },
    ]);
    expect(sweep.json.report).toMatchObject({ realBlockers: 0 });

    // Apply the removals, then ask the dispatcher's own queue.
    const deleted = new Set(
      planned.actions.map((a: { relationId: string }) => a.relationId)
    );
    const after = {
      ...item,
      inverseRelations: {
        nodes: item.inverseRelations.nodes.filter(
          relation => !deleted.has(String(relation.id))
        ),
      },
    };
    const queueInput = path.join(sandbox.root, "queue.json");
    writeJson(queueInput, {
      complete: true,
      pages: 1,
      items: [],
      backlog: { complete: true, pages: 1, items: [after] },
    });
    const queue = runCli(sandbox, [
      "queue",
      "--tracker",
      "linear",
      "--input",
      queueInput,
      "--me",
      "agent-uuid",
    ]);
    expect(queue.status).toBe(0);
    expect(after.inverseRelations.nodes).toEqual([]);
    expect(
      queue.json.backlogOrdered.map((entry: { ref: string }) => entry.ref)
    ).toEqual(["DEMO-3"]);
  });

  it("hands Jira its comment as an ADF document", () => {
    const sandbox = makeSandbox({ extraConfig: { tracker: "jira" } });
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
                    status: { name: "Done", statusCategory: { key: "done" } },
                  },
                },
              },
            ],
          },
          comments: [],
        },
      ],
    });
    const result = run(sandbox, [PLAN, "--input", input]);
    expect(result.status).toBe(0);
    const [planned] = result.json.plans;
    expect(planned.commentAdf).toEqual({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: planned.comment.split("\n")[0] }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "[lisa-stale-blocker-link] blocker=ABC-9" },
          ],
        },
      ],
    });
    expect(planned.comment).toMatch(
      /^\[lisa-session-manager\] demo-manager cleared waiting-on links\. This was marked as waiting on ABC-9, which is done or closed/u
    );
  });

  it("reads a Blocked by ref to another repository from that repository", () => {
    const sandbox = makeSandbox();
    const routes = path.join(sandbox.root, "routes.json");
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues?state=open&per_page=100`,
        body: [
          [
            {
              number: 1,
              body: "Blocked by other-org/other-repo#4",
              labels: [],
              issue_dependencies_summary: { total_blocked_by: 0 },
            },
          ],
        ],
      },
      {
        match: "repos/other-org/other-repo/issues/4",
        body: { state: "closed" },
      },
      { match: `repos/${REPO}/issues/1/comments?per_page=100`, body: [[]] },
    ]);
    const result = run(sandbox, [PLAN, "--tracker", "github"], {
      env: { STUB_GH_ROUTES: routes },
    });
    expect(result.status).toBe(0);
    const endpoints = result.calls.map(call => call.argv.at(-1));
    expect(endpoints).toContain("repos/other-org/other-repo/issues/4");
    expect(endpoints).not.toContain(`repos/${REPO}/issues/4`);
    // Readable and finished, but another repository's: never removed here.
    expect(result.json.plans).toEqual([]);
    expect(result.json.report).toMatchObject({ crossProject: 1, cleared: 0 });
  });
});
