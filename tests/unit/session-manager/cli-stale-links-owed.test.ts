/**
 * Fourth CodeRabbit round on the stale "blocked by" clean-up
 * (CodySwannGT/lisa#5065), the real CLI:
 *
 * - a confirmed plan is recorded in flight before its deletes, and a failed
 *   read-back leaves it listed as unverified instead of losing it;
 * - links put back after a blocker reopened are owed until a read-back shows
 *   them present, and the queue holds only that item meanwhile;
 * - a Ready item whose blocker list could not be read is held with reason
 *   `blockers-unreadable`, and every other Ready item is still offered;
 * - one failed dependency read never aborts the plan;
 * - the manager's skill holds only the item owed a restore.
 * @module tests/unit/session-manager/cli-stale-links-owed
 */
import { existsSync, readFileSync } from "node:fs";
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
const CREATED = "2026-01-01T00:00:00Z";
const READY = "status:ready";
const VERIFY = "stale-links-verify";
const INPUT = "--input";
const BLOCKERS = "--blockers";
const BLOCKERS_FILE = "blockers.json";
const DONE = { name: "Done", statusCategory: { key: "done" } };
const OPEN = { name: "In Progress", statusCategory: { key: "indeterminate" } };
const STATE_DIR = ".lisa/session-manager";
const ITEM = "ABC-1";
const BLOCKER = "ABC-9";
const INFLIGHT = "stale-links-inflight.json";
const RESTORES = "stale-links-restores.json";

/**
 * A raw Jira item blocked by the given keys, each in `status`.
 * @param keys - Blocker keys, one link each
 * @param status - Their status as embedded in the item read
 * @returns Raw issue
 */
function jira(keys: string[], status: object = DONE) {
  return {
    key: ITEM,
    fields: {
      status: { name: "Ready" },
      issuelinks: keys.map((key, index) => ({
        id: String(index + 1),
        type: { inward: "is blocked by" },
        inwardIssue: { key, fields: { status } },
      })),
    },
    comments: [],
  };
}

/**
 * Blockers as read again after the delete.
 * @param keys - Blocker keys
 * @param status - Their status now
 * @returns `--blockers` map
 */
const now = (keys: string[], status: object = DONE) =>
  Object.fromEntries(keys.map(key => [key, { key, fields: { status } }]));

/**
 * A Jira sandbox and a JSON file writer inside it.
 * @returns Sandbox, writer, and the state file reader
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
  const state = (name: string) => {
    const target = path.join(sandbox.root, STATE_DIR, name);
    return existsSync(target) ? JSON.parse(readFileSync(target, "utf8")) : {};
  };
  return { sandbox, file, state };
}

/**
 * Plan and confirm ABC-1's removal of ABC-9.
 * @param context - From {@link jiraSandbox}
 * @returns The confirmed plan entry's file
 */
function confirmed(context: ReturnType<typeof jiraSandbox>) {
  const { sandbox, file } = context;
  const plan = run(sandbox, [
    "stale-links-plan",
    INPUT,
    file("links.json", { complete: true, items: [jira([BLOCKER])] }),
  ]);
  const confirm = run(sandbox, [
    "stale-links-confirm",
    "--plan",
    file("planned.json", plan.json.plans[0]),
    INPUT,
    file("fresh.json", jira([BLOCKER])),
  ]);
  expect([plan.status, confirm.status]).toEqual([0, 0]);
  return file("entry.json", confirm.json.plan);
}

describe("a confirmed plan whose read-back fails", () => {
  it("stays in flight, listed as unverified, until a verify succeeds", () => {
    const context = jiraSandbox();
    const { sandbox, file, state } = context;
    const entry = confirmed(context);
    expect(Object.keys(state(INFLIGHT))).toEqual([ITEM]);

    // The deletes ran, then the read-back came back without its links.
    const broken = { ...jira([]), fields: { status: { name: "Ready" } } };
    const failed = run(sandbox, [
      VERIFY,
      "--plan",
      entry,
      INPUT,
      file("broken.json", broken),
      BLOCKERS,
      file(BLOCKERS_FILE, now([BLOCKER])),
    ]);
    expect(failed.status).not.toBe(0);
    expect(state(INFLIGHT)).toMatchObject({
      [ITEM]: { attempts: 1, plan: { ref: ITEM, removed: [BLOCKER] } },
    });
    expect(run(sandbox, ["stale-links-pending"]).json).toMatchObject({
      unverified: [{ plan: { ref: ITEM }, attempts: 1 }],
    });

    const retried = run(sandbox, [
      VERIFY,
      "--plan",
      entry,
      INPUT,
      file("after.json", jira([])),
      BLOCKERS,
      file(BLOCKERS_FILE, now([BLOCKER])),
    ]);
    expect(retried.status).toBe(0);
    expect(retried.json.confirmed).toEqual([BLOCKER]);
    expect(state(INFLIGHT)).toEqual({});
  });
});

describe("a link put back after its blocker reopened", () => {
  it("is owed until a read-back shows it, and holds only its item", () => {
    const context = jiraSandbox();
    const { sandbox, file, state } = context;
    const entry = confirmed(context);
    const verify = run(sandbox, [
      VERIFY,
      "--plan",
      entry,
      INPUT,
      file("after.json", jira([])),
      BLOCKERS,
      file(BLOCKERS_FILE, now([BLOCKER], OPEN)),
    ]);
    expect(verify.status).toBe(0);
    expect(verify.json.restored).toMatchObject([{ blockerRef: BLOCKER }]);
    expect(state(RESTORES)).toMatchObject({
      [ITEM]: { links: [{ blockerRef: BLOCKER }] },
    });

    const queue = (name: string) =>
      run(sandbox, [
        "queue",
        "--tracker",
        "jira",
        INPUT,
        file(name, {
          complete: true,
          pages: 1,
          items: [
            { ...jira([]), fields: { ...jira([]).fields, summary: "one" } },
            {
              key: "ABC-2",
              fields: {
                summary: "two",
                status: { name: "Ready" },
                created: CREATED,
              },
            },
          ],
        }),
      ]);
    const held = queue("queue.json");
    expect(held.status).toBe(0);
    expect(held.json.ordered.map((item: { ref: string }) => item.ref)).toEqual([
      "ABC-2",
    ]);
    expect(held.json.excluded).toContainEqual({
      ref: ITEM,
      reason: "restore-owed",
    });

    // The restore failed: the read-back still has no link, so it stays owed
    // with fresh actions to put it back.
    const missing = run(sandbox, [
      "stale-links-restored",
      "--ref",
      ITEM,
      INPUT,
      file("restored.json", jira([])),
    ]);
    expect(missing.status).toBe(0);
    expect(missing.json.restore).toEqual([
      { op: "link", from: BLOCKER, to: ITEM, type: "Blocks" },
    ]);
    expect(state(RESTORES)[ITEM].attempts).toBe(1);

    const back = run(sandbox, [
      "stale-links-restored",
      "--ref",
      ITEM,
      INPUT,
      file("restored.json", jira([BLOCKER], OPEN)),
    ]);
    expect(back.json).toMatchObject({ owed: [], restore: [] });
    expect(state(RESTORES)).toEqual({});
    expect(queue("queue2.json").json.excluded).not.toContainEqual({
      ref: ITEM,
      reason: "restore-owed",
    });
  });
});

/**
 * A REST issue row.
 * @param number - Issue number
 * @param extra - Extra fields
 * @returns Row
 */
const row = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `issue ${number}`,
  body: "",
  labels: [{ name: READY }],
  created_at: CREATED,
  updated_at: CREATED,
  user: { login: "author" },
  ...extra,
});

describe("a GitHub Ready item whose dependencies could not be read", () => {
  it("is held as blockers-unreadable while an unrelated item is offered", () => {
    const sandbox = makeSandbox();
    const routes = path.join(sandbox.root, "routes.json");
    // No route for #5's dependencies: that read exits 1.
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues?state=open&labels=status%3Aready&per_page=100`,
        body: [
          [
            row(5, { issue_dependencies_summary: { total_blocked_by: 1 } }),
            row(6),
          ],
        ],
      },
    ]);
    const queue = run(
      sandbox,
      ["queue", "--tracker", "github", "--me", "agent"],
      { env: { STUB_GH_ROUTES: routes } }
    );
    expect(queue.status).toBe(0);
    expect(
      queue.json.ordered.map((entry: { ref: string }) => entry.ref)
    ).toEqual([`${REPO}#6`]);
    expect(queue.json.excluded).toEqual([
      { ref: `${REPO}#5`, reason: "blockers-unreadable" },
    ]);
  });
});

describe("stale-links-plan with one failed dependency read", () => {
  it("plans the other items and reports the unread one", () => {
    const sandbox = makeSandbox();
    const routes = path.join(sandbox.root, "routes.json");
    const blocked = { issue_dependencies_summary: { total_blocked_by: 1 } };
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues?state=open&per_page=100`,
        body: [[row(1, blocked), row(2, blocked)]],
      },
      {
        match: `repos/${REPO}/issues/2/dependencies/blocked_by?per_page=100`,
        body: [
          [
            {
              id: 802,
              number: 20,
              repository: { full_name: REPO },
              state: "closed",
              labels: [],
            },
          ],
        ],
      },
      { match: `repos/${REPO}/issues/1/comments?per_page=100`, body: [[]] },
      { match: `repos/${REPO}/issues/2/comments?per_page=100`, body: [[]] },
    ]);
    const plan = run(sandbox, ["stale-links-plan", "--tracker", "github"], {
      env: { STUB_GH_ROUTES: routes },
    });
    expect(plan.status).toBe(0);
    expect(plan.json.plans.map((entry: { ref: string }) => entry.ref)).toEqual([
      `${REPO}#2`,
    ]);
    expect(plan.json.report.inaccessible).toContainEqual({
      ref: `${REPO}#1`,
      blocker: "its blocker list",
    });
  });
});

describe("the session manager skill", () => {
  const skill = readFileSync(
    path.join(
      process.cwd(),
      "plugins/src/base/skills/lisa-session-manager/SKILL.md"
    ),
    "utf8"
  );

  it("holds only the item owed a restore, and retries before Dispatch", () => {
    expect(skill).toContain("held with reason `restore-owed`");
    expect(skill).toContain(
      "A failed plan,\nconfirm, verify or comment holds nothing"
    );
    expect(skill).toContain("`stale-links-restored --ref <ref>");
    expect(skill).toContain(
      'Run `stale-links-pending --project-root "$ROOT"`, before Dispatch.'
    );
    expect(skill).not.toContain(
      "never holds dispatch and never makes\nthe cycle `recovery-required`. Other runtimes"
    );
  });
});
