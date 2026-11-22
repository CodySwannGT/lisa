/**
 * The real CLI, third CodeRabbit round (CodySwannGT/lisa#5065): a GitHub
 * dependency read that fails holds only its own row, never the whole queue;
 * every read-change-write of the stale-link state runs under the project
 * root's lock, so a held lock writes nothing; `stale-links-posted` settles one
 * owed comment by ref and removed set; and every stale-links command in the
 * manager's skill names the project root.
 * @module tests/unit/session-manager/cli-stale-links-state
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const POSTED = "stale-links-posted";

/**
 * A REST issue row for the backlog list.
 * @param number - Issue number
 * @param extra - Extra fields
 * @returns Row
 */
const row = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `issue ${number}`,
  body: "",
  labels: [],
  created_at: CREATED,
  updated_at: CREATED,
  user: { login: "author" },
  ...extra,
});

describe("the GitHub queue", () => {
  it("holds only the row whose dependency read failed", () => {
    const sandbox = makeSandbox();
    const config = path.join(sandbox.root, ".lisa.config.json");
    const parsed = JSON.parse(readFileSync(config, "utf8"));
    writeJson(config, {
      ...parsed,
      sessionManager: {
        ...parsed.sessionManager,
        operatorIds: ["op-login"],
        backlogPickup: true,
      },
    });
    const routes = path.join(sandbox.root, "routes.json");
    // No route for #5's dependencies: that read exits 1.
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues?state=open&labels=status%3Aready&per_page=100`,
        body: [[]],
      },
      {
        match: `repos/${REPO}/issues?state=open&per_page=100`,
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
      {
        env: { STUB_GH_ROUTES: routes },
      }
    );
    expect(queue.status).toBe(0);
    expect(
      queue.json.backlogOrdered.map((entry: { ref: string }) => entry.ref)
    ).toEqual([`${REPO}#6`]);
    // Held for its unread list, by name, not as an ordinary open blocker.
    expect(queue.json.backlogExcluded).toEqual([
      { ref: `${REPO}#5`, reason: "blockers-unreadable" },
    ]);
  });
});

describe("stale-links state", () => {
  /**
   * A sandbox owing two comments for one item.
   * @returns Sandbox and its pending file
   */
  function owing() {
    const sandbox = makeSandbox({ extraConfig: { tracker: "jira" } });
    const dir = path.join(sandbox.root, ".lisa/session-manager");
    const pending = path.join(dir, "stale-links-pending.json");
    const entry = (removed: string) => ({
      ref: "ABC-1",
      removed: [removed],
      comment: removed,
      commentAdf: null,
      since: CREATED,
      attempts: 0,
    });
    mkdirSync(dir, { recursive: true });
    writeJson(pending, [entry("ABC-9"), entry("ABC-8")]);
    return { sandbox, dir, pending };
  }

  it("settles one comment and keeps the other owed for the same item", () => {
    const { sandbox, pending } = owing();
    const result = run(sandbox, [
      POSTED,
      "--ref",
      "ABC-1",
      "--removed",
      "ABC-9",
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(pending, "utf8"))).toMatchObject([
      { removed: ["ABC-8"], attempts: 0 },
    ]);
  });

  it("writes nothing while another process holds the lock", () => {
    const { sandbox, dir, pending } = owing();
    const before = readFileSync(pending, "utf8");
    // A live holder: this test process.
    writeFileSync(
      path.join(dir, "stale-links-state.lock"),
      JSON.stringify({ token: "held", pid: process.pid, createdAt: Date.now() })
    );
    const result = run(sandbox, [
      POSTED,
      "--ref",
      "ABC-1",
      "--removed",
      "ABC-9",
    ]);
    expect(result.status).not.toBe(0);
    expect(readFileSync(pending, "utf8")).toBe(before);
  });
});

describe("the session-manager skill", () => {
  it("passes the project root to every stale-links command", () => {
    const skill = readFileSync(
      path.join(
        __dirname,
        "../../../plugins/src/base/skills/lisa-session-manager/SKILL.md"
      ),
      "utf8"
    );
    const start = skill.indexOf("**Stale blocker links**");
    const section = skill.slice(
      start,
      skill.indexOf("A failure anywhere in this sweep", start)
    );
    const commands = [
      ...section.matchAll(
        /`(?:node "\$SM\/session-manager\.mjs" )?stale-links-[a-z]+ [^`]*`/gu
      ),
    ].map(match => match[0]);
    expect(commands.length).toBeGreaterThanOrEqual(8);
    expect(
      commands.filter(cmd => !cmd.includes('--project-root "$ROOT"'))
    ).toEqual([]);
  });
});

describe("stale-links-verify reads each removed blocker again", () => {
  it("puts back a GitHub link whose blocker reopened, with no marker", () => {
    const sandbox = makeSandbox();
    const routes = path.join(sandbox.root, "routes.json");
    writeJson(routes, [
      {
        match: `repos/${REPO}/issues/1`,
        body: row(1, {
          body: "Context.",
          labels: [{ name: "status:ready" }],
          issue_dependencies_summary: { total_blocked_by: 0 },
        }),
      },
      { match: `repos/${REPO}/issues/1/comments?per_page=100`, body: [[]] },
      { match: `repos/${REPO}/issues/7`, body: { state: "open", labels: [] } },
    ]);
    const entry = path.join(sandbox.root, "entry.json");
    writeJson(entry, {
      ref: `${REPO}#1`,
      removed: [`${REPO}#7`],
      links: [{ blockerRef: `${REPO}#7`, source: "github-body", actionId: "" }],
      render: { stale: [{ blockerRef: `${REPO}#7`, verdict: "closed" }] },
    });
    const result = run(
      sandbox,
      ["stale-links-verify", "--tracker", "github", "--plan", entry],
      { env: { STUB_GH_ROUTES: routes } }
    );
    expect(result.status).toBe(0);
    expect(result.calls.map(call => call.argv.at(-1))).toContain(
      `repos/${REPO}/issues/7`
    );
    expect(result.json).toMatchObject({
      confirmed: [],
      restored: [{ blockerRef: `${REPO}#7`, verdict: "open" }],
      restore: [{ op: "body", body: "Blocked by #7\n\nContext." }],
      comment: null,
      pending: false,
    });
  });

  it("refuses a Jira verify without --blockers", () => {
    const sandbox = makeSandbox({ extraConfig: { tracker: "jira" } });
    const entry = path.join(sandbox.root, "entry.json");
    writeJson(entry, { ref: "ABC-1", removed: ["ABC-9"] });
    const after = path.join(sandbox.root, "after.json");
    writeJson(after, {
      key: "ABC-1",
      fields: { status: { name: "Ready" }, issuelinks: [] },
    });
    const result = run(sandbox, [
      "stale-links-verify",
      "--plan",
      entry,
      "--input",
      after,
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--blockers");
  });
});
