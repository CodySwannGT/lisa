/**
 * Fifth CodeRabbit round on the stale "blocked by" clean-up
 * (CodySwannGT/lisa#5065), the in-flight record through the real CLI:
 *
 * - a second confirm for an item whose earlier plan is still unverified is
 *   refused, so the earlier removed links stay recoverable;
 * - the queue holds an item while its removals are unverified
 *   (`removal-unverified`), and every other item is still offered;
 * - verify settles the in-flight entry last, so a failed write of any other
 *   record leaves it for the next cycle.
 * @module tests/unit/session-manager/cli-stale-links-inflight
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  writeJson,
} from "./support/cli-harness.js";
import { runStubOnly as run } from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const ITEM = "ABC-1";
const INPUT = "--input";
const INFLIGHT = "stale-links-inflight.json";
const STATE_DIR = ".lisa/session-manager";
const DONE = { name: "Done", statusCategory: { key: "done" } };

/**
 * A raw Jira ABC-1 blocked by the given finished keys.
 * @param keys - Blocker keys, one link each
 * @returns Raw issue
 */
function jira(keys: string[]) {
  return {
    key: ITEM,
    fields: {
      summary: "one",
      status: { name: "Ready" },
      issuelinks: keys.map((key, index) => ({
        id: String(index + 1),
        type: { inward: "is blocked by" },
        inwardIssue: { key, fields: { status: DONE } },
      })),
    },
    comments: [],
  };
}

/**
 * A Jira sandbox with file helpers.
 * @returns Sandbox, writer, state reader and a plan-and-confirm step
 */
function jiraSandbox() {
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
  const statePath = (name: string) => path.join(sandbox.root, STATE_DIR, name);
  const state = (name: string) =>
    existsSync(statePath(name))
      ? JSON.parse(readFileSync(statePath(name), "utf8"))
      : {};
  const confirm = (keys: string[]) => {
    const plan = run(sandbox, [
      "stale-links-plan",
      INPUT,
      file("links.json", { complete: true, items: [jira(keys)] }),
    ]);
    const confirmed = run(sandbox, [
      "stale-links-confirm",
      "--plan",
      file("planned.json", plan.json.plans[0]),
      INPUT,
      file("fresh.json", jira(keys)),
    ]);
    return { plan, confirmed };
  };
  return { sandbox, file, statePath, state, confirm };
}

describe("a second confirm while an earlier plan is unverified", () => {
  it("is refused, and the earlier removed links stay recoverable", () => {
    const { state, confirm } = jiraSandbox();
    expect(confirm(["ABC-9"]).confirmed.status).toBe(0);
    // ABC-9's delete ran but was never read back; the next cycle plans the
    // remaining finished link.
    const second = confirm(["ABC-8"]);
    expect(second.plan.json.plans[0].removed).toEqual(["ABC-8"]);
    expect(second.confirmed.status).not.toBe(0);
    expect(state(INFLIGHT)).toMatchObject({
      [ITEM]: { plan: { removed: ["ABC-9"] } },
    });
  });
});

describe("an item whose removals are not yet read back", () => {
  it("is held from the queue while every other item is offered", () => {
    const { sandbox, file, confirm } = jiraSandbox();
    expect(confirm(["ABC-9"]).confirmed.status).toBe(0);
    const queue = run(sandbox, [
      "queue",
      "--tracker",
      "jira",
      INPUT,
      file("queue.json", {
        complete: true,
        pages: 1,
        items: [
          jira([]),
          {
            key: "ABC-2",
            fields: {
              summary: "two",
              status: { name: "Ready" },
              created: "2026-01-01T00:00:00Z",
            },
          },
        ],
      }),
    ]);
    expect(queue.status).toBe(0);
    expect(queue.json.ordered.map((one: { ref: string }) => one.ref)).toEqual([
      "ABC-2",
    ]);
    expect(queue.json.excluded).toContainEqual({
      ref: ITEM,
      reason: "removal-unverified",
    });
  });
});

describe("a verify whose other records cannot be written", () => {
  it("keeps the in-flight entry for the next cycle", () => {
    const { sandbox, file, statePath, state, confirm } = jiraSandbox();
    const confirmed = confirm(["ABC-9"]).confirmed;
    expect(confirmed.status).toBe(0);
    // The owed-restores record cannot be read or replaced.
    mkdirSync(statePath("stale-links-restores.json"), { recursive: true });
    writeFileSync(path.join(statePath("stale-links-restores.json"), "x"), "");
    const verify = run(sandbox, [
      "stale-links-verify",
      "--plan",
      file("entry.json", confirmed.json.plan),
      INPUT,
      file("after.json", jira([])),
      "--blockers",
      file("blockers.json", {
        "ABC-9": { key: "ABC-9", fields: { status: DONE } },
      }),
    ]);
    expect(verify.status).not.toBe(0);
    expect(Object.keys(state(INFLIGHT))).toEqual([ITEM]);
  });
});
