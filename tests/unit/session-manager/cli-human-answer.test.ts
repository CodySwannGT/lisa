/**
 * Answer paths for "mark and move on" (CodySwannGT/lisa#4555, part 3):
 * `answer` and `item-answer`.
 *
 * Only a real answer may be queued: from the CLI, or from the first comment
 * after the manager's question by an allowed answerer (operators and trusted
 * authors, else the tracker identity), never a Lisa marker comment, an
 * earlier comment or a stranger's; and never text that looks like a
 * credential. Run as a real process with a stub-only PATH.
 * @module tests/unit/session-manager/cli-human-answer
 */
import { afterEach, describe, expect, it } from "vitest";

import { removeSandboxes, type Sandbox } from "./support/cli-harness.js";
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

describe("answer", () => {
  it("queues a terminal answer for a pending question", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = runStubOnly(sandbox, ["answer", REF], {
      input: "CSV, please.",
    });
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ queued: true, ref: REF, source: "cli" });
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toMatchObject({ source: "cli", text: "CSV, please." });
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

describe("item-answer", () => {
  const question = {
    author: { login: "bot" },
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
      { author: { login: "bot" }, body: "[lisa-tracker-sync] progress" },
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
      reason: "no-answer-yet",
    });
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toBeNull();
    expect(pick(sandbox, [{ author: OPERATOR, body: "x" }]).json.reason).toBe(
      "no-question-comment"
    );
  });

  it("falls back to the tracker identity when no answerers are configured", () => {
    const { operatorIds: _o, trustedAuthorIds: _t, ...bare } = BLOCK;
    const sandbox = githubSandbox(bare);
    ask(sandbox);
    expect(
      pick(sandbox, [question, { author: "me-login", body: "CSV" }]).status
    ).toBe(2);
    runStubOnly(sandbox, ["ledger", "control", "--me", "me-login"]);
    const result = pick(sandbox, [
      question,
      { author: { login: OPERATOR }, body: "not allowed now" },
      { author: "me-login", body: "CSV" },
    ]);
    expect(result.json).toMatchObject({ queued: true, author: "me-login" });
  });

  it("exits 2 when the ref has no pending question", () => {
    const result = pick(githubSandbox(), [question]);
    expect(result.status).toBe(2);
  });
});
