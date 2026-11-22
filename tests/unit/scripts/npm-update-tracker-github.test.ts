/**
 * AC6 of CodySwannGT/lisa#4859: on a GitHub-tracked host the tracker seam is
 * a pass-through. The GitHub adapter issues exactly the calls the updater made
 * before the seam existed, and the leaf draft is byte-identical to the one
 * captured at the pre-change HEAD.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  githubTracker,
  trackerOf,
  trustedHumanActorIds,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-tracker.mjs";
import { buildDraft } from "../../../all/copy-overwrite/scripts/lib/npm-update-leaf-contract.mjs";

const REPOSITORY = "acme/widgets";
// sha256(JSON.stringify(buildDraft(...))) for the fixture below, measured at
// 8d2385d27d before the tracker seam existed.
const GOLDEN_DRAFT =
  "6a6d95a4eb63e6baabcb0038d35f10e025e7a28a9477a03e2a62dabcfddbd8e1";

/** A duck-typed GitHub `api` that records every call it receives. */
function recordingApi() {
  const calls: unknown[][] = [];
  const api = {
    policy: { repository: REPOSITORY, claimActorId: "456" },
    request: async (...args: unknown[]) => {
      calls.push(["request", ...args]);
      const endpoint = String(args[0]);
      if (endpoint.endsWith("/comments") && args[1] === "POST")
        return {
          id: 9,
          body: (args[2] as { body: string }).body,
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/42`,
        };
      if (endpoint.includes("issues/comments/"))
        return {
          id: 9,
          body: "text",
          issue_url: `https://api.github.com/repos/${REPOSITORY}/issues/42`,
        };
      return { number: 42 };
    },
    list: async (...args: unknown[]) => {
      calls.push(["list", ...args]);
      return [{ name: "type:Task" }];
    },
    issue: async (...args: unknown[]) => {
      calls.push(["issue", ...args]);
      return { number: 42 };
    },
    assignable: async (...args: unknown[]) => {
      calls.push(["assignable", ...args]);
    },
  };
  return { api, calls };
}

describe("GitHub tracker adapter parity", () => {
  it("is the fallback for any api without an attached tracker", () => {
    expect(trackerOf({}).provider).toBe("github");
    expect(trackerOf({ tracker: { provider: "linear" } }).provider).toBe(
      "linear"
    );
  });

  it("issues exactly the pre-seam endpoint, method and body tuples", async () => {
    const { api, calls } = recordingApi();
    const tracker = githubTracker(api, REPOSITORY);
    const proposal = { repository: REPOSITORY, selectionKey: "e".repeat(64) };
    expect(tracker.ref(42)).toBe("acme/widgets#42");
    await tracker.issue(42);
    await tracker.searchPrior(proposal);
    const relationships = await tracker.relationships(proposal);
    expect(await tracker.vocabulary(proposal)).toEqual(["type:Task"]);
    await tracker.ensureRole("type:Task");
    await tracker.createLeaf({
      title: "T",
      body: "B",
      labels: ["type:Task"],
      assignees: ["maintainer"],
    });
    await tracker.assignable("maintainer");
    await tracker.assign(42, "maintainer");
    await tracker.transition(
      { number: 42, labels: [{ name: "type:Task" }, { name: "status:ready" }] },
      { ready: "status:ready", claimed: "status:in-progress" }
    );
    await tracker.comment(42, "claim");
    await tracker.comments(42);
    await tracker.durableComment(42, "text");
    const selection = `repo:${REPOSITORY} "${"e".repeat(64)}" is:issue in:body`;
    const npm = `repo:${REPOSITORY} npm is:issue in:title,body`;
    expect(relationships.query).toBe(npm);
    expect(calls).toEqual([
      ["issue", 42],
      [
        "request",
        `search/issues?q=${encodeURIComponent(selection)}&per_page=100`,
      ],
      ["request", `search/issues?q=${encodeURIComponent(npm)}&per_page=100`],
      ["list", `repos/${REPOSITORY}/labels`],
      [
        "request",
        `repos/${REPOSITORY}/labels`,
        "POST",
        {
          name: "type:Task",
          color: "ededed",
          description: "Managed dependency Task lifecycle",
        },
      ],
      [
        "request",
        `repos/${REPOSITORY}/issues`,
        "POST",
        {
          title: "T",
          body: "B",
          labels: ["type:Task"],
          assignees: ["maintainer"],
        },
      ],
      ["assignable", "maintainer"],
      [
        "request",
        `repos/${REPOSITORY}/issues/42/assignees`,
        "POST",
        { assignees: ["maintainer"] },
      ],
      [
        "request",
        `repos/${REPOSITORY}/issues/42`,
        "PATCH",
        { labels: ["type:Task", "status:in-progress"] },
      ],
      [
        "request",
        `repos/${REPOSITORY}/issues/42/comments`,
        "POST",
        { body: "claim" },
      ],
      ["list", `repos/${REPOSITORY}/issues/42/comments`],
      [
        "request",
        `repos/${REPOSITORY}/issues/42/comments`,
        "POST",
        { body: "text" },
      ],
      ["request", `repos/${REPOSITORY}/issues/comments/9`],
    ]);
  });

  it("keeps the GitHub Bot claim identity and human-hold source", async () => {
    const { api } = recordingApi();
    const tracker = githubTracker(api, REPOSITORY);
    expect(await tracker.isManagedActor({ id: 456, type: "Bot" })).toBe(true);
    expect(await tracker.isManagedActor({ id: 456, type: "User" })).toBe(false);
    expect(await tracker.isManagedActor({ id: 457, type: "Bot" })).toBe(false);
    expect(
      trustedHumanActorIds({
        tracker: "github",
        github: { trustedHumanActorIds: ["7"] },
      })
    ).toEqual(["7"]);
    expect(trustedHumanActorIds({ tracker: "github", github: {} })).toEqual([]);
    expect(
      trustedHumanActorIds({
        tracker: "linear",
        github: { trustedHumanActorIds: ["7"] },
        linear: { trustedHumanActorIds: ["u-1"] },
      })
    ).toEqual(["u-1"]);
    expect(trustedHumanActorIds({ tracker: "jira", jira: {} })).toEqual([]);
  });

  it("renders the GitHub leaf draft byte-identically to the pre-seam HEAD", () => {
    const draft = buildDraft(
      {
        key: "a".repeat(64),
        selectionKey: "e".repeat(64),
        parent: "b".repeat(40),
        directory: ".",
        updates: [
          {
            name: "is-number",
            section: "dependencies",
            from: "6.0.0",
            to: "7.0.0",
          },
        ],
        hashes: {
          "package.json": "c".repeat(64),
          "package-lock.json": "d".repeat(64),
        },
      },
      { repository: REPOSITORY, maintainer: "maintainer" },
      {
        tracker: "github",
        github: { org: "acme", repo: "widgets" },
        deploy: { branches: { production: "main" } },
      },
      {
        history: { command: "git log", result: "none" },
        search: {
          query: "repo:acme/widgets npm is:issue in:title,body",
          total: 0,
        },
        registry: [{ name: "is-number", version: "7.0.0" }],
        labels: ["type:Task"],
        main: "b".repeat(40),
      }
    );
    expect(
      createHash("sha256").update(JSON.stringify(draft)).digest("hex")
    ).toBe(GOLDEN_DRAFT);
  });
});
