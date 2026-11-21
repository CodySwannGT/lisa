/** Configured human releases are used when the real queue command ranks items. */
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { orderReadyQueue } from "../../../plugins/src/base/scripts/ready-queue-order.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
} from "./support/cli-harness.js";

const RELEASER = "operator-1";
const AUTHOR = "trusted-author";
const HOLD =
  "The operator must supply a credential.\n<!-- [lisa-human-gate] reason=supply-api-key -->";
const RELEASE = "<!-- [lisa-human-gate-release] reason=supply-api-key -->";
const LINEAR = "DEMO-1";
const HELD = "human-gated";

afterEach(removeSandboxes);

/**
 * One ready issue with provider-shaped comment authorship.
 * @param comment - Native comment to attach
 * @returns Ready Linear issue
 */
function issue(comment: unknown) {
  return {
    identifier: LINEAR,
    title: "Ready issue",
    description: HOLD,
    labels: { nodes: [] },
    creator: { id: AUTHOR },
    comments: { nodes: comment ? [comment] : [] },
    trustedHumanActorIds: ["untrusted"],
  };
}

/**
 * A queue project with separate rules for submitters and hold releasers.
 * @param keys - Additional session-manager settings
 * @returns Temporary project
 */
function queueSandbox(keys: Record<string, unknown> = {}) {
  return makeSandbox({
    sessionManager: {
      name: "released-queue",
      operatorIds: [RELEASER],
      trustedAuthorIds: [AUTHOR],
      trustedReleaseIds: [`id:${RELEASER}`],
      ...keys,
    },
    extraConfig: {
      humanGate: { mode: "strict" },
      github: { org: "example-org", repo: "demo-repo" },
    },
  });
}

/**
 * Run the real queue CLI with one Linear issue.
 * @param comment - Native comment to attach
 * @returns CLI exit status and output
 */
function queue(comment: unknown) {
  const sandbox = queueSandbox();
  const input = path.join(sandbox.root, "queue.json");
  writeJson(input, { complete: true, pages: 1, items: [issue(comment)] });
  return runCli(sandbox, ["queue", "--tracker", "linear", "--input", input]);
}

describe("queue release trust", () => {
  it("dispatches a Linear item released by the configured person", () => {
    const result = queue({ body: RELEASE, user: { id: RELEASER } });

    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([
      expect.objectContaining({ ref: LINEAR }),
    ]);
    expect(result.json.ordered[0]).not.toHaveProperty("comments");
    expect(result.json.excluded).toEqual([]);
  });

  it.each([
    ["an untrusted person", { body: RELEASE, user: { id: "untrusted" } }],
    [
      "an identified bot",
      { body: RELEASE, user: { id: RELEASER, type: "Bot" } },
    ],
    ["no release", null],
  ])("keeps a hold with %s", (_name, comment) => {
    const result = queue(comment);

    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([]);
    expect(result.json.excluded).toEqual([{ ref: LINEAR, reason: HELD }]);
  });

  it("reads a Jira release with a native document body and author account ID", () => {
    const sandbox = queueSandbox();
    const input = path.join(sandbox.root, "jira-queue.json");
    writeJson(input, {
      complete: true,
      pages: 1,
      items: [
        {
          key: "DEMO-1",
          fields: {
            description: HOLD,
            reporter: { accountId: AUTHOR },
            comment: {
              comments: [
                {
                  body: {
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: RELEASE }],
                      },
                    ],
                  },
                  author: { accountId: RELEASER, accountType: "atlassian" },
                },
              ],
            },
          },
        },
      ],
    });
    const result = runCli(sandbox, [
      "queue",
      "--tracker",
      "jira",
      "--input",
      input,
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([
      expect.objectContaining({ ref: LINEAR }),
    ]);
  });

  it("requests every GitHub comment page only for a held item", () => {
    const sandbox = queueSandbox({
      trustedAuthorIds: ["123"],
      trustedReleaseIds: ["id:42"],
    });
    const routes = path.join(sandbox.root, "gh-routes.json");
    const endpoint =
      "repos/example-org/demo-repo/issues/1/comments?per_page=100";
    const author = { id: 123, login: "reporter" };
    writeJson(routes, [
      {
        match:
          "repos/example-org/demo-repo/issues?state=open&labels=status%3Aready&per_page=100",
        body: [
          [
            { number: 1, title: "Held", body: HOLD, user: author },
            { number: 2, title: "Ordinary", body: "", user: author },
            { number: 3, title: "Unreadable", body: HOLD, user: author },
          ],
        ],
      },
      {
        match: endpoint,
        body: [[], [{ body: RELEASE, user: { id: 42, type: "User" } }]],
      },
    ]);
    const result = runCli(
      sandbox,
      ["queue", "--tracker", "github", "--label", "status:ready"],
      {
        env: { STUB_GH_ROUTES: routes },
      }
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([
      expect.objectContaining({ ref: "example-org/demo-repo#1" }),
      expect.objectContaining({ ref: "example-org/demo-repo#2" }),
    ]);
    expect(result.json.excluded).toEqual([
      { ref: "example-org/demo-repo#3", reason: HELD },
    ]);
    expect(result.calls.map(call => call.argv)).toContainEqual([
      "api",
      "--paginate",
      "--slurp",
      endpoint,
    ]);
    expect(result.calls.flatMap(call => call.argv).join("\n")).not.toContain(
      "issues/2/comments"
    );
  });

  it("lets declared ordering policy control trust independently of item fields", () => {
    const item = {
      ref: LINEAR,
      body: HOLD,
      comments: [{ body: RELEASE, user: { id: RELEASER } }],
    };

    expect(
      orderReadyQueue([item], { trustedHumanActorIds: [RELEASER] }).ordered
    ).toEqual([item]);
    expect(
      orderReadyQueue([{ ...item, trustedHumanActorIds: [RELEASER] }], {
        trustedHumanActorIds: [],
      }).excluded
    ).toEqual([{ ref: LINEAR, reason: HELD }]);
  });

  it.each([
    { account: { id: 42, login: "releaser", type: "User" }, dispatched: true },
    { account: { id: 82, login: "releaser", type: "User" }, dispatched: false },
    { account: { id: 42, login: "another", type: "User" }, dispatched: false },
    { account: { id: 42, login: "releaser", type: "Bot" }, dispatched: false },
    { account: null, dispatched: false },
  ])(
    "compares a GitHub login releaser by the ID GitHub resolves ($account)",
    ({ account, dispatched }) => {
      const sandbox = queueSandbox({
        trustedAuthorIds: ["123"],
        trustedReleaseIds: ["login:releaser"],
      });
      const routes = path.join(sandbox.root, "gh-routes.json");
      writeJson(routes, [
        {
          match:
            "repos/example-org/demo-repo/issues?state=open&labels=status%3Aready&per_page=100",
          body: [[{ number: 1, title: "Held", body: HOLD, user: { id: 123 } }]],
        },
        {
          match: "repos/example-org/demo-repo/issues/1/comments?per_page=100",
          body: [
            [
              {
                body: RELEASE,
                user: { id: 42, login: "releaser", type: "User" },
              },
            ],
          ],
        },
        ...(account ? [{ match: "users/releaser", body: account }] : []),
      ]);
      const outcome = runCli(
        sandbox,
        ["queue", "--tracker", "github", "--label", "status:ready"],
        { env: { STUB_GH_ROUTES: routes } }
      );

      expect(outcome.status, outcome.stderr).toBe(0);
      expect(outcome.json.ordered).toHaveLength(dispatched ? 1 : 0);
      expect(outcome.json.excluded).toHaveLength(dispatched ? 0 : 1);
      expect(outcome.calls.map(call => call.argv)).toContainEqual([
        "api",
        "users/releaser",
      ]);
    }
  );
});
