/**
 * The real CLI across cycles (CodySwannGT/lisa#5065): a removal that did not
 * happen is recorded by `stale-links-verify`, and the next `stale-links-plan`
 * puts that item after every other candidate; the GitHub backlog fetch
 * drops lifecycle-labelled issues before it reads any blocker; and GitHub
 * build intake runs the one-item clean-up before its active-blocker skip.
 * @module tests/unit/session-manager/cli-stale-links-cycles
 */
import { mkdirSync, readFileSync } from "node:fs";
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
const DONE = { name: "Done", statusCategory: { key: "done" } };
const PLAN = "stale-links-plan";
const CREATED = "2026-01-01T00:00:00Z";

/**
 * A raw Jira item blocked by one finished ticket.
 * @param key - Item key
 * @param linked - Whether the link is still on the item
 * @returns Raw issue
 */
function jira(key: string, linked = true) {
  return {
    key,
    fields: {
      status: { name: "Ready" },
      issuelinks: linked
        ? [
            {
              id: "1",
              type: { inward: "is blocked by" },
              inwardIssue: { key: `${key}9`, fields: { status: DONE } },
            },
          ]
        : [],
    },
    comments: [],
  };
}

describe("a removal that keeps failing", () => {
  it("is recorded by verify and planned after the other items next cycle", () => {
    const sandbox = makeSandbox({
      extraConfig: {
        tracker: "jira",
        jira: { workflow: { ready: "Ready", blocked: "Blocked" } },
      },
    });
    const file = (name: string, value: unknown) => {
      const target = path.join(sandbox.root, name);
      writeJson(target, value);
      return target;
    };
    const links = file("links.json", {
      complete: true,
      items: [jira("ABC-1"), jira("ABC-2")],
    });
    const first = run(sandbox, [PLAN, "--input", links, "--max", "1"]);
    expect(first.json.plans.map((p: { ref: string }) => p.ref)).toEqual([
      "ABC-1",
    ]);

    // The unlink did not happen: the read-back still has the link.
    const verify = run(sandbox, [
      "stale-links-verify",
      "--plan",
      file("entry.json", first.json.plans[0]),
      "--input",
      file("after.json", jira("ABC-1")),
    ]);
    expect(verify.json).toMatchObject({
      confirmed: [],
      stillPresent: ["ABC-19"],
    });
    const failures = path.join(
      sandbox.root,
      ".lisa/session-manager/stale-links-failures.json"
    );
    expect(JSON.parse(readFileSync(failures, "utf8"))).toMatchObject({
      "ABC-1": { attempts: 1 },
    });

    const second = run(sandbox, [PLAN, "--input", links, "--max", "1"]);
    expect(second.json.plans.map((p: { ref: string }) => p.ref)).toEqual([
      "ABC-2",
    ]);
    expect(second.json.deferred).toEqual(["ABC-1"]);

    // Once its removal lands, the record is cleared.
    run(sandbox, [
      "stale-links-verify",
      "--plan",
      file("entry.json", first.json.plans[0]),
      "--input",
      file("after.json", jira("ABC-1", false)),
    ]);
    expect(JSON.parse(readFileSync(failures, "utf8"))).toEqual({});
  });

  it("refuses a corrupt failure record instead of reading it as empty", () => {
    const sandbox = makeSandbox({ extraConfig: { tracker: "jira" } });
    const failures = path.join(
      sandbox.root,
      ".lisa/session-manager/stale-links-failures.json"
    );
    mkdirSync(path.dirname(failures), { recursive: true });
    writeJson(failures, ["not", "a", "record"]);
    const links = path.join(sandbox.root, "links.json");
    writeJson(links, { complete: true, items: [jira("ABC-1")] });
    expect(run(sandbox, [PLAN, "--input", links]).status).toBe(1);
  });
});

describe("the GitHub backlog fetch", () => {
  it("reads no blocker for an issue it drops for a lifecycle label", () => {
    const sandbox = makeSandbox({
      extraConfig: {
        github: {
          org: "example-org",
          repo: "demo-repo",
          labels: {
            build: { ready: "status:ready", claimed: "status:claimed" },
          },
        },
      },
    });
    const block = path.join(sandbox.root, ".lisa.config.json");
    const config = JSON.parse(readFileSync(block, "utf8"));
    writeJson(block, {
      ...config,
      sessionManager: {
        ...config.sessionManager,
        operatorIds: ["op-login"],
        backlogPickup: true,
      },
    });
    const routes = path.join(sandbox.root, "routes.json");
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues?state=open&labels=status%3Aready&per_page=100`,
        body: [[]],
      },
      {
        match: `repos/${REPO}/issues?state=open&per_page=100`,
        body: [
          [
            {
              number: 5,
              title: "claimed",
              body: "Blocked by #9",
              labels: [{ name: "Status:Claimed" }],
              issue_dependencies_summary: { total_blocked_by: 1 },
              created_at: CREATED,
              updated_at: CREATED,
              user: { login: "author" },
            },
            {
              number: 6,
              title: "open",
              body: "",
              labels: [],
              created_at: CREATED,
              updated_at: CREATED,
              user: { login: "author" },
            },
          ],
        ],
      },
    ]);
    const queue = run(
      sandbox,
      ["queue", "--tracker", "github", "--me", "agent"],
      {
        env: { STUB_GH_ROUTES: routes },
      }
    );
    expect(queue.status).toBe(0);
    const endpoints = queue.calls.map(call => call.argv.at(-1));
    expect(endpoints).not.toContain(
      `repos/${REPO}/issues/5/dependencies/blocked_by?per_page=100`
    );
    expect(endpoints).not.toContain(`repos/${REPO}/issues/9`);
    expect(queue.json.backlogTotal).toBe(1);
  });
});

describe("GitHub build intake", () => {
  it("runs the stale-link clean-up before skipping an actively blocked item", () => {
    const skill = readFileSync(
      path.join(
        __dirname,
        "../../../plugins/src/base/skills/lisa-github-build-intake/SKILL.md"
      ),
      "utf8"
    );
    const cleanup = skill.indexOf(
      "Run the stale-link clean-up below for this candidate FIRST"
    );
    const skip = skill.indexOf("Only then, if any blocker is active, skip");
    expect(cleanup).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(cleanup);
  });
});
