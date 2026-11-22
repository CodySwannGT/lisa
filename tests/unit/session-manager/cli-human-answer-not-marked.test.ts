/**
 * `item-answer` reads replies only for a question whose mark was read back
 * (CodySwannGT/lisa#4643, item 10).
 *
 * When a new question replaces a pending one, `ledger set-question` resets
 * `markedAt` to null but keeps the manager's comment ids, because those ids
 * also keep the manager's own comments out of the answer candidates. The
 * answer search anchors on the last recorded id, which is still the OLD
 * question's comment until `ledger marked` records the new one. Before the
 * fix, `item-answer` never looked at `markedAt`, so the operator's reply to
 * the old question was queued as the answer to the new one. Run as a real
 * process with a stub-only PATH.
 * @module tests/unit/session-manager/cli-human-answer-not-marked
 */
import { afterEach, describe, expect, it } from "vitest";

import { removeSandboxes, type Sandbox } from "./support/cli-harness.js";
import { readLedgerFile } from "./support/cli-fixtures.js";
import {
  ask,
  githubSandbox,
  MARKER,
  OPERATOR,
  REF,
  runStubOnly,
} from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const LABEL = "custom:needs-person";
const NEW_QUESTION = "Should the export include archived rows?";

/** The first question's comment, recorded by `ledger marked`. */
const oldQuestion = {
  id: 100,
  user: { login: OPERATOR },
  body: `${MARKER} ${REF} needs a human`,
};

/** The operator's reply to the first question. */
const oldReply = { id: 101, user: { login: OPERATOR }, body: "CSV, please." };

/**
 * Run item-answer with these comments.
 * @param sandbox - Project sandbox
 * @param comments - Comment rows
 * @returns CLI result
 */
const pick = (sandbox: Sandbox, comments: unknown[]) =>
  runStubOnly(sandbox, ["item-answer", REF], {
    input: JSON.stringify({ comments }),
  });

/**
 * Record the mark for REF with this question comment id.
 * @param sandbox - Project sandbox
 * @param commentId - Question comment id
 * @returns CLI result
 */
const mark = (sandbox: Sandbox, commentId: string) =>
  runStubOnly(sandbox, [
    "ledger",
    "marked",
    REF,
    "--marker-type",
    "label",
    "--marker",
    LABEL,
    "--comment-id",
    commentId,
  ]);

/**
 * Replace REF's pending question with new text, as a worker re-asking does.
 * @param sandbox - Project sandbox
 * @returns CLI result
 */
const reask = (sandbox: Sandbox) =>
  runStubOnly(
    sandbox,
    ["ledger", "set-question", REF, "--kind", "worker-question"],
    { input: NEW_QUESTION }
  );

describe("item-answer on a question not yet marked", () => {
  it("refuses, not-marked, a reply to the replaced question", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    expect(mark(sandbox, "100").status).toBe(0);
    expect(reask(sandbox).status).toBe(0);
    const pending = readLedgerFile(sandbox).items[REF].pendingQuestion;
    expect(pending.markedAt).toBeNull();
    // The ids are kept: they filter the manager's own comments out.
    expect(pending.managerCommentIds).toEqual(["100"]);

    const result = pick(sandbox, [oldQuestion, oldReply]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      queued: false,
      ref: REF,
      reason: "not-marked",
    });
    expect(String(result.json.explanation)).toContain("ledger marked");
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toBeNull();
  });

  it("queues only a reply to the new question once it is marked", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    expect(mark(sandbox, "100").status).toBe(0);
    expect(reask(sandbox).status).toBe(0);
    expect(mark(sandbox, "102").status).toBe(0);
    const newQuestion = {
      id: 102,
      user: { login: OPERATOR },
      body: `${MARKER} ${REF} needs a human`,
    };
    const result = pick(sandbox, [
      oldQuestion,
      oldReply,
      newQuestion,
      { id: 103, user: { login: OPERATOR }, body: "Yes, include them." },
    ]);
    expect(result.json).toMatchObject({ queued: true, author: OPERATOR });
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toMatchObject({ source: "item", text: "Yes, include them." });
  });
});
