/**
 * The question comment's id is how `item-answer` finds the question
 * (CodySwannGT/lisa#4561): `ledger marked` requires `--comment-id`, the
 * recorded id anchors the answer search whoever the tracker says posted the
 * question (a bot identity outside the answerer set included), the
 * manager's own comment is never taken as the answer, and a question that
 * cannot be found is reported with the fix rather than silently left. Run
 * as a real process with a stub-only PATH; split from cli-human-answer.
 * @module tests/unit/session-manager/cli-human-answer-question-id
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

const CSV_PLEASE = "CSV, please.";
const NO_ANSWER_YET = "no-answer-yet";
const LABEL = "custom:needs-person";
const COMMENT_ID_FLAG = "--comment-id";

/** The question as the manager posts it, before any id is known. */
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
  runStubOnly(sandbox, ["item-answer", REF], {
    input: JSON.stringify({ comments }),
  });

/**
 * Run `ledger marked` for REF with a label marker.
 * @param sandbox - Project sandbox
 * @param marker - Label value
 * @param commentId - Question comment id; omitted to test the refusal
 * @returns CLI result
 */
const mark = (sandbox: Sandbox, marker: string, commentId?: string) =>
  runStubOnly(sandbox, [
    "ledger",
    "marked",
    REF,
    "--marker-type",
    "label",
    "--marker",
    marker,
    ...(commentId === undefined ? [] : [COMMENT_ID_FLAG, commentId]),
  ]);

describe("item-answer and the recorded question id", () => {
  it("never takes a comment the manager recorded as its own, even an operator's with no marker", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const marked = mark(sandbox, LABEL, "77");
    expect(marked.status).toBe(0);
    // A re-ask (a Telegram re-ping) keeps the manager's comment ids.
    ask(sandbox);
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.managerCommentIds
    ).toEqual(["77"]);
    const result = pick(sandbox, [
      question,
      { id: 77, user: { login: OPERATOR }, body: "Marked; waiting on you." },
    ]);
    expect(result.json).toEqual({
      queued: false,
      ref: REF,
      reason: NO_ANSWER_YET,
    });
    const answered = pick(sandbox, [
      question,
      { id: 77, user: { login: OPERATOR }, body: "Marked; waiting on you." },
      { id: 78, user: { login: OPERATOR }, body: "CSV" },
    ]);
    expect(answered.json).toMatchObject({ queued: true, author: OPERATOR });
  });

  it("refuses (exit 2) a --comment-id that is not an id", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = mark(sandbox, "x", "two words");
    expect(result.status).toBe(2);
  });

  it("queues an operator reply to a bot-authored question whose id was recorded", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    expect(mark(sandbox, LABEL, "501").status).toBe(0);
    const result = pick(sandbox, [
      {
        id: 501,
        author: { login: "bot" },
        body: `${MARKER} ${REF} needs a human`,
      },
      { id: 502, author: { login: OPERATOR }, body: CSV_PLEASE },
    ]);
    expect(result.json).toEqual({
      queued: true,
      ref: REF,
      source: "item",
      author: OPERATOR,
    });
  });

  it("explains no-question-comment: the question must be re-posted and its id recorded", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = pick(sandbox, [
      {
        id: 601,
        author: { login: "bot" },
        body: `${MARKER} ${REF} needs a human`,
      },
      { id: 602, author: { login: OPERATOR }, body: CSV_PLEASE },
    ]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      queued: false,
      ref: REF,
      reason: "no-question-comment",
    });
    expect(String(result.json.explanation)).toContain(COMMENT_ID_FLAG);
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toBeNull();
  });

  it("refuses (exit 2) ledger marked with no --comment-id, naming the flag", () => {
    const sandbox = githubSandbox();
    ask(sandbox);
    const result = mark(sandbox, LABEL);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(COMMENT_ID_FLAG);
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.markedAt
    ).toBeNull();
  });
});
