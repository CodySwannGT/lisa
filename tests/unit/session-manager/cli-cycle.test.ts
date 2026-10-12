/**
 * Integration tests for the session-manager CLI's per-cycle commands: queue,
 * ledger, classify, route, blocked-plan and record-cycle, run as a real
 * process against stub `gh` and `claude` executables.
 *
 * Untrusted text (questions, answers, Telegram messages, finish reasons, the
 * cycle summary) arrives on stdin in every case, so these feed it there.
 * @module tests/unit/session-manager/cli-cycle
 */
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMINFO,
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";
import {
  activeAgent,
  callsOf,
  readLedgerFile,
} from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const GH_REPO = "example-org/demo-repo";
const READY = "status:ready";

/**
 * A GitHub REST issue row.
 * @param number - Issue number
 * @param assignee - Assignee login, or null
 * @returns Row
 */
function ghIssue(number: number, assignee: string | null) {
  return {
    number,
    title: `Issue ${number}`,
    body: "",
    user: { id: 100 + number, login: "author" },
    assignee: assignee === null ? null : { login: assignee },
    labels: [{ name: READY }],
    created_at: `2026-01-0${number}T00:00:00Z`,
    repository_url: `https://api.github.com/repos/${GH_REPO}`,
  };
}

/**
 * Write a queue input file into the sandbox.
 * @param sandbox - Project sandbox
 * @param envelope - File contents
 * @returns Path
 */
function queueInput(sandbox: Sandbox, envelope: unknown): string {
  const file = path.join(sandbox.root, "queue-input.json");
  writeJson(file, envelope);
  return file;
}

describe("queue --tracker github", () => {
  it("pages with gh api --paginate --slurp and orders mine first", () => {
    const sandbox = makeSandbox();
    const pages = path.join(sandbox.root, "pages.json");
    writeJson(pages, [
      [ghIssue(1, "someone-else"), ghIssue(2, null)],
      [ghIssue(3, "me"), { number: 4, pull_request: {} }],
    ]);
    const result = runCli(
      sandbox,
      ["queue", "--tracker", "github", "--me", "me"],
      {
        env: { STUB_GH_FILE: pages },
      }
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const [gh] = result.calls.filter(call => call.bin === "gh");
    expect(gh?.argv).toEqual([
      "api",
      "--paginate",
      "--slurp",
      `repos/${GH_REPO}/issues?state=open&labels=status%3Aready&per_page=100`,
    ]);
    expect(result.json.ordered.map((item: any) => item.ref)).toEqual([
      `${GH_REPO}#3`,
      `${GH_REPO}#2`,
    ]);
    expect(result.json.excluded).toEqual([
      { ref: `${GH_REPO}#1`, reason: "assigned-to-other" },
    ]);
  });

  it("exits 2 when no ready label is configured or given", () => {
    const sandbox = makeSandbox({
      extraConfig: { github: { org: "o", repo: "r" } },
    });
    expect(runCli(sandbox, ["queue", "--tracker", "github"]).status).toBe(2);
  });
});

describe("queue --tracker jira|linear (paging guard)", () => {
  const jiraIssue = {
    key: "DEMO-1",
    fields: {
      summary: "One",
      assignee: null,
      priority: { name: "High" },
      created: "2026-01-01T00:00:00Z",
      labels: [],
      issuetype: { name: "Story", hierarchyLevel: 0 },
    },
  };

  it("exits 2 without --input", () => {
    expect(runCli(makeSandbox(), ["queue", "--tracker", "jira"]).status).toBe(
      2
    );
  });

  it("exits 2 when the envelope is not complete:true", () => {
    const sandbox = makeSandbox();
    const file = queueInput(sandbox, {
      complete: false,
      pages: 1,
      items: [jiraIssue],
    });
    const result = runCli(sandbox, [
      "queue",
      "--tracker",
      "jira",
      "--input",
      file,
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("paged to completion");
  });

  it("normalizes and orders a complete envelope", () => {
    const sandbox = makeSandbox();
    const file = queueInput(sandbox, {
      complete: true,
      pages: 1,
      items: [jiraIssue],
    });
    const result = runCli(sandbox, [
      "queue",
      "--tracker",
      "jira",
      "--input",
      file,
    ]);
    expect(result.status).toBe(0);
    expect(result.json.ordered.map((item: any) => item.ref)).toEqual([
      "DEMO-1",
    ]);
  });

  it("exits 2 for an unknown tracker", () => {
    expect(runCli(makeSandbox(), ["queue", "--tracker", "trello"]).status).toBe(
      2
    );
  });
});

describe("ledger", () => {
  it("sets and clears a question from stdin, and finishes with a reason", () => {
    const sandbox = makeSandbox();
    const asked = runCli(
      sandbox,
      ["ledger", "set-question", "DEMO-3", "--telegram-message-id", "77"],
      { input: "Which schema? 1) A 2) B" }
    );
    expect(asked.status).toBe(0);
    expect(
      readLedgerFile(sandbox).items["DEMO-3"].pendingQuestion
    ).toMatchObject({
      text: "Which schema? 1) A 2) B",
      telegramMessageId: 77,
    });
    runCli(sandbox, ["ledger", "clear-question", "DEMO-3"]);
    expect(readLedgerFile(sandbox).items["DEMO-3"].pendingQuestion).toBeNull();
    const done = runCli(
      sandbox,
      ["ledger", "finish", "DEMO-3", "--status", "DONE"],
      {
        input: "PR opened",
      }
    );
    expect(done.json).toMatchObject({ status: "DONE", reason: "PR opened" });
  });

  it("control sets cap and pause, and capacity then honours them", () => {
    const sandbox = makeSandbox();
    const control = runCli(sandbox, [
      "ledger",
      "control",
      "--max-workers",
      "0",
      "--paused",
      "true",
      "--me",
      "me",
    ]);
    expect(control.json).toEqual({ paused: true, maxWorkers: 0, me: "me" });
    const capacity = runCli(sandbox, ["capacity", "--meminfo", MEMINFO]);
    expect(capacity.json).toMatchObject({
      cap: 0,
      paused: true,
      can_spawn: false,
    });
    const cleared = runCli(sandbox, [
      "ledger",
      "control",
      "--max-workers",
      "none",
    ]);
    expect(cleared.json.maxWorkers).toBeNull();
  });

  it("get returns the item, or the whole ledger", () => {
    const sandbox = makeSandbox();
    runCli(sandbox, [
      "ledger",
      "record-spawn",
      "DEMO-4",
      "--worker",
      "wk-DEMO-4-1012-0900",
      "--session-id",
      "abcdef12",
    ]);
    expect(runCli(sandbox, ["ledger", "get", "DEMO-4"]).json.attempts).toBe(1);
    expect(Object.keys(runCli(sandbox, ["ledger", "get"]).json.items)).toEqual([
      "DEMO-4",
    ]);
  });

  it("exits 2 on an unknown ledger action", () => {
    expect(runCli(makeSandbox(), ["ledger", "explode"]).status).toBe(2);
  });
});

describe("classify", () => {
  it("hashes claude logs by worker name and classifies live and dead workers", () => {
    const sandbox = makeSandbox();
    const spawned = runCli(sandbox, ["spawn", "DEMO-5", "--meminfo", MEMINFO]);
    const live = runCli(sandbox, ["classify", "DEMO-5"], {
      agents: [activeAgent(spawned.json.name)],
    });
    expect(live.status).toBe(0);
    expect(live.json).toEqual([
      expect.objectContaining({ ref: "DEMO-5", classification: "working" }),
    ]);
    expect(callsOf(live.calls, "claude", "logs")[0]?.argv).toEqual([
      "logs",
      spawned.json.name,
    ]);
    expect(readLedgerFile(sandbox).items["DEMO-5"].logsHash).toMatch(
      /^[0-9a-f]{64}$/
    );

    const dead = runCli(sandbox, ["classify"], { agents: [] });
    expect(dead.json[0].classification).toBe("dead");
  });
});
