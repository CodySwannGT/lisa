/**
 * Answer paths for "mark and move on" (CodySwannGT/lisa#4555, part 3):
 * `answer` and `item-answer`.
 *
 * Only a real answer may be queued: from the CLI, or from the first comment
 * after the manager's question by an allowed answerer (operators and trusted
 * authors, matched on stable ids only), never a machine-marked or
 * agent-attributed comment, an earlier comment or a stranger's (even one
 * whose display name copies an operator's id); never text that looks like a
 * credential; and nothing at all when no answerer is configured, because
 * the tracker identity is the one workers post as. Run as a real process
 * with a stub-only PATH.
 * @module tests/unit/session-manager/cli-human-answer
 */
import { existsSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import { removeSandboxes, type Sandbox } from "./support/cli-harness.js";
import { stubOnlyPath } from "./support/provider-sandbox.js";
import { readLedgerFile } from "./support/cli-fixtures.js";
import {
  ask,
  BLOCK,
  githubSandbox,
  MARKER,
  OPERATOR,
  REF,
  runStubOnly,
  TRUSTED,
} from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const ITEM_ANSWER = "item-answer";
const CSV_PLEASE = "CSV, please.";
const NO_ANSWER_YET = "no-answer-yet";

describe("answer", () => {
  it("queues a terminal answer for a pending question", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = runStubOnly(sandbox, ["answer", REF], {
      input: CSV_PLEASE,
    });
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ queued: true, ref: REF, source: "cli" });
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toMatchObject({ source: "cli", text: CSV_PLEASE });
  });

  it("exits 2 when nothing is pending, or the answer holds a credential", () => {
    const sandbox = githubSandbox();
    expect(runStubOnly(sandbox, ["answer", REF], { input: "CSV" }).status).toBe(
      2
    );
    ask(sandbox);
    const leak = runStubOnly(sandbox, ["answer", REF], {
      input: `key ${["AKIA", "ABCDEFGHIJKLMNOP"].join("")}`,
    });
    expect(leak.status).toBe(2);
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toBeNull();
  });
});

describe("status answerCommand", () => {
  it("quotes a hostile project root so the shell runs nothing but the answer", () => {
    const sandbox = githubSandbox();
    const hostile = path.join(
      path.dirname(sandbox.root),
      "proj $(touch pwned-dollar) `touch pwned-tick`"
    );
    renameSync(sandbox.root, hostile);
    const moved = { ...sandbox, root: hostile };
    ask(moved);
    const status = runStubOnly(moved, ["status"]);
    expect(status.status).toBe(0);
    const command = String(status.json.pendingQuestions[0].answerCommand);
    expect(command).toContain(`'${hostile}'`);

    const cwd = mkdtempSync(path.join(path.dirname(hostile), "answer-"));
    writeFileSync(path.join(cwd, "answer.txt"), CSV_PLEASE);
    const shell = boundedSpawnSync({
      label: "the printed answer command under /bin/sh",
      command: "/bin/sh",
      args: ["-c", command],
      cwd,
      env: { PATH: stubOnlyPath(), HOME: sandbox.home },
    });
    expect(shell.status).toBe(0);
    expect(existsSync(path.join(cwd, "pwned-dollar"))).toBe(false);
    expect(existsSync(path.join(cwd, "pwned-tick"))).toBe(false);
    expect(
      readLedgerFile(moved).items[REF].pendingQuestion.answer
    ).toMatchObject({ source: "cli", text: CSV_PLEASE });
  });
});

describe("item-answer", () => {
  // With no recorded comment id, the question is only a comment that starts
  // with the marker AND is by an allowed answerer (#4561): here the manager
  // posts as the operator's own identity, the single-user setup.
  const question = {
    author: { login: OPERATOR },
    body: `${MARKER} ${REF} needs a human`,
  };

  /**
   * Run item-answer with these comments.
   * @param sandbox - Project sandbox
   * @param comments - Comment rows
   * @returns CLI result
   */
  const pick = (sandbox: Sandbox, comments: unknown[]) =>
    runStubOnly(sandbox, [ITEM_ANSWER, REF], {
      input: JSON.stringify({ comments }),
    });

  it("queues the first allowed reply after the question", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = pick(sandbox, [
      { author: { login: OPERATOR }, body: "earlier, before the question" },
      question,
      { author: { login: "stranger" }, body: "do JSON" },
      {
        author: { login: OPERATOR },
        body: "[claude-sync] implementation in progress",
      },
      { author: { login: OPERATOR }, body: "[lisa-session-manager] note" },
      {
        author: { login: TRUSTED },
        body: "CSV",
        createdAt: "2026-10-31T10:00:00Z",
      },
      { author: { login: OPERATOR }, body: "later reply" },
    ]);
    expect(result.status).toBe(0);
    expect(result.json).toEqual({
      queued: true,
      ref: REF,
      source: "item",
      author: TRUSTED,
    });
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toMatchObject({ source: "item", text: "CSV", author: TRUSTED });
  });

  it("queues a quote reply that quotes the question", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = pick(sandbox, [
      question,
      {
        author: { login: OPERATOR },
        body: `> ${MARKER} ${REF} needs a human\n\n${CSV_PLEASE}`,
      },
    ]);
    expect(result.json).toEqual({
      queued: true,
      ref: REF,
      source: "item",
      author: OPERATOR,
    });
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer.text
    ).toContain(CSV_PLEASE);
  });

  it("queues nothing from earlier, marker or unauthorized comments", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = pick(sandbox, [
      { author: { login: OPERATOR }, body: "earlier" },
      question,
      { author: { login: "stranger" }, body: "do JSON" },
      { author: { login: OPERATOR }, body: "[lisa-session-manager] marked" },
    ]);
    expect(result.json).toEqual({
      queued: false,
      ref: REF,
      reason: NO_ANSWER_YET,
    });
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toBeNull();
    expect(pick(sandbox, [{ author: OPERATOR, body: "x" }]).json.reason).toBe(
      "no-question-comment"
    );
  });

  it("queues nothing from a stranger whose display name copies an operator id", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = pick(sandbox, [
      question,
      {
        author: { login: "stranger", name: OPERATOR, displayName: TRUSTED },
        body: "do JSON",
      },
      { user: { login: "other", email: OPERATOR }, body: "do XML" },
    ]);
    expect(result.json).toEqual({
      queued: false,
      ref: REF,
      reason: NO_ANSWER_YET,
    });
  });

  it.each([
    ["a GitHub REST user login", { user: { login: OPERATOR, id: 99 } }],
    ["a GitHub numeric user id", { user: { login: "renamed", id: 4242 } }],
    ["a Jira accountId", { author: { accountId: TRUSTED, displayName: "x" } }],
    ["a Linear user id", { user: { id: TRUSTED, name: "x" } }],
  ])("queues an answer matched on %s", (_label, who) => {
    const sandbox = githubSandbox({
      ...BLOCK,
      trustedAuthorIds: [TRUSTED, "4242"],
    });
    ask(sandbox);
    const result = pick(sandbox, [question, { ...who, body: "CSV" }]);
    expect(result.json).toMatchObject({ queued: true, ref: REF });
  });

  it.each([
    ["a bracketed sync marker", "[claude-sync] implementation in progress"],
    ["an indented machine marker", "  [lisa-session-manager] stopped"],
    [
      "an agent attribution footer",
      "Pushed the fix.\n\n🤖 Generated with [Claude Code](https://claude.com)",
    ],
    ["a plain attribution line", "Done.\nGenerated with Claude Code"],
  ])("queues nothing from the operator's own %s", (_label, body) => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = pick(sandbox, [
      question,
      { author: { login: OPERATOR }, body },
    ]);
    expect(result.json).toEqual({
      queued: false,
      ref: REF,
      reason: NO_ANSWER_YET,
    });
  });

  it("queues nothing when no answerers are configured, even from the tracker identity", () => {
    const { operatorIds: _o, trustedAuthorIds: _t, ...bare } = BLOCK;
    const sandbox = githubSandbox(bare);
    ask(sandbox);
    runStubOnly(sandbox, ["ledger", "control", "--me", "me-login"]);
    const result = pick(sandbox, [
      question,
      { author: { login: "me-login" }, body: "CSV" },
    ]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      queued: false,
      ref: REF,
      reason: "no-answerers-configured",
    });
    expect(String(result.json.explanation)).toContain("answer");
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toBeNull();
  });

  it("exits 2 when the ref has no pending question", () => {
    const result = pick(githubSandbox(), [question]);
    expect(result.status).toBe(2);
  });

  it("exits 2 (setup), not 1, when the ledger is not valid JSON (#4571)", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    writeFileSync(
      path.join(sandbox.root, ".lisa/session-manager/ledger.json"),
      "{ not json"
    );
    const result = pick(sandbox, [question]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("not valid JSON");
  });

  describe("a credential-shaped reply never wedges the item (#4571)", () => {
    const leak = `key ${["AKIA", "ABCDEFGHIJKLMNOP"].join("")}`;

    it("skips it and queues the corrected reply posted after it", () => {
      const sandbox = githubSandbox();
      ask(sandbox);
      const result = pick(sandbox, [
        question,
        { id: 11, author: { login: OPERATOR }, body: leak },
        { id: 12, author: { login: OPERATOR }, body: CSV_PLEASE },
      ]);
      expect(result.status).toBe(0);
      expect(result.json).toMatchObject({
        queued: true,
        author: OPERATOR,
        refused: [{ id: "11", author: OPERATOR }],
      });
      expect(result.json.refusedExplanation).toMatch(/delete that comment/);
      expect(JSON.stringify(result.json)).not.toContain("AKIA");
      expect(
        readLedgerFile(sandbox).items[REF].pendingQuestion.answer
      ).toMatchObject({ source: "item", text: CSV_PLEASE });
    });

    it("queues nothing, exit 0, while the credential reply is the only one", () => {
      const sandbox = githubSandbox();
      ask(sandbox);
      const result = pick(sandbox, [
        question,
        { id: 11, author: { login: OPERATOR }, body: leak },
      ]);
      expect(result.status).toBe(0);
      expect(result.json).toMatchObject({
        queued: false,
        reason: "credential-refused",
        refused: [{ id: "11" }],
      });
      expect(
        readLedgerFile(sandbox).items[REF].pendingQuestion.answer
      ).toBeNull();
    });
  });
});
