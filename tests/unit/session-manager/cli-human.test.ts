/**
 * "Mark and move on" CLI paths (CodySwannGT/lisa#4555, part 3): `mark-plan`
 * and the ledger's `set-question --kind`, `marked` and
 * `clear-question --reset-attempts`.
 *
 * `mark-plan` must take the human-needed marker from config (a custom label,
 * Jira's own default), add a move to the configured `blocked` role for an
 * `exhausted` item only, post a comment carrying the question marker and every
 * way to answer, and refuse credential-shaped text. Run as a real process
 * against the stub harness with a stub-only PATH, so no real `gh`, `bws` or
 * `claude` can be reached. The answer paths live in cli-human-answer.test.ts.
 * @module tests/unit/session-manager/cli-human
 */
import { afterEach, describe, expect, it } from "vitest";

import { makeSandbox, removeSandboxes } from "./support/cli-harness.js";
import { readLedgerFile } from "./support/cli-fixtures.js";
import {
  ask,
  BLOCK,
  CUSTOM_BLOCKED,
  CUSTOM_LABEL,
  githubSandbox,
  MARKER,
  QUESTION,
  REF,
  runStubOnly,
  WORKER_QUESTION,
} from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const KINDS = [WORKER_QUESTION, "repo-route", "exhausted", "decision"];
const SET_QUESTION = "set-question";
const MARK_PLAN = "mark-plan";
const KIND = "--kind";
const DECISION = "decision";

describe("mark-plan", () => {
  it.each(KINDS)("marks a %s with the configured custom label", kind => {
    const result = runStubOnly(githubSandbox(), [MARK_PLAN, REF, KIND, kind], {
      input: QUESTION,
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.json.marker).toEqual({
      type: "label",
      value: CUSTOM_LABEL,
    });
    expect(
      result.json.comment.startsWith(`${MARKER} ${REF} needs a human`)
    ).toBe(true);
    expect(result.json.comment).toContain(QUESTION);
    expect(result.json.comment).toContain("Reply in a comment on this item");
    expect(result.json.comment).toContain(CUSTOM_LABEL);
  });

  it("tells a reader how to answer in plain English, with nothing to paste", () => {
    const { comment } = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, DECISION],
      { input: QUESTION }
    ).json;
    expect(comment).not.toContain("$SM");
    expect(comment).not.toContain('node "');
    expect(comment).toContain(
      "On the machine running the session manager, run `session-manager.mjs status`"
    );
    expect(comment).toContain("`answerCommand`");
  });

  it("does not invite replies on the item when no answerer is configured", () => {
    const { operatorIds: _o, trustedAuthorIds: _t, ...bare } = BLOCK;
    const result = runStubOnly(
      githubSandbox(bare),
      [MARK_PLAN, REF, KIND, DECISION],
      { input: QUESTION }
    );
    expect(result.status).toBe(0);
    expect(result.json.comment).not.toContain("Reply in a comment");
    expect(result.json.comment).toContain(
      "Replies on this item are not picked up"
    );
    expect(result.json.answerWith.item).toBeNull();
  });

  it("moves only an exhausted item to the configured blocked role", () => {
    const exhausted = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, "exhausted"],
      {
        input: "Three attempts stalled with no output.",
      }
    );
    expect(exhausted.json.move).toEqual({
      role: "blocked",
      value: CUSTOM_BLOCKED,
    });
    const question = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, DECISION],
      {
        input: QUESTION,
      }
    );
    expect(question.json).not.toHaveProperty("move");
  });

  it("uses Jira's own default label when none is configured", () => {
    const sandbox = makeSandbox({
      sessionManager: BLOCK,
      extraConfig: {
        tracker: "jira",
        jira: { workflow: { ready: "Ready", blocked: "Blocked" } },
      },
    });
    const result = runStubOnly(sandbox, [MARK_PLAN, "DEMO-1", KIND, DECISION], {
      input: QUESTION,
    });
    expect(result.status).toBe(0);
    expect(result.json.marker).toEqual({
      type: "label",
      value: "Human Needed",
    });
  });

  it("offers the Telegram answer line only when Telegram is the channel", () => {
    const none = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, DECISION],
      {
        input: QUESTION,
      }
    );
    expect(none.json.answerWith.channel).toBeNull();
    expect(none.json.comment).not.toContain("Telegram");
    const telegram = runStubOnly(
      makeSandbox(),
      [MARK_PLAN, REF, KIND, DECISION],
      {
        input: QUESTION,
      }
    );
    expect(telegram.json.answerWith.channel).toBe(
      "Answer with: #7 <your answer>"
    );
    expect(telegram.json.comment).toContain("Answer with: #7 <your answer>");
  });

  it("refuses credential-shaped text and writes nothing", () => {
    const fakeToken = ["ghp", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("_");
    const result = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, DECISION],
      {
        input: `Use ${fakeToken} to push?`,
      }
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("GitHub token");
    expect(result.stderr).not.toContain(fakeToken);
  });

  it("exits 2 for an unknown kind", () => {
    const result = runStubOnly(
      githubSandbox(),
      [MARK_PLAN, REF, KIND, "whim"],
      {
        input: QUESTION,
      }
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(WORKER_QUESTION);
  });
});

describe("ledger set-question --kind, marked and clear-question", () => {
  it("records the kind and keeps the marker fields on a re-ping", () => {
    const sandbox = githubSandbox();
    expect(ask(sandbox, DECISION).status).toBe(0);
    const marked = runStubOnly(sandbox, [
      "ledger",
      "marked",
      REF,
      "--marker-type",
      "label",
      "--marker",
      CUSTOM_LABEL,
      "--comment-id",
      "41",
    ]);
    expect(marked.status).toBe(0);
    expect(marked.json.pendingQuestion.markedAt).toEqual(expect.any(String));
    expect(
      runStubOnly(
        sandbox,
        ["ledger", SET_QUESTION, REF, "--telegram-message-id", "9"],
        {
          input: QUESTION,
        }
      ).status
    ).toBe(0);
    const pending = readLedgerFile(sandbox).items[REF].pendingQuestion;
    expect(pending).toMatchObject({
      kind: DECISION,
      markerType: "label",
      marker: CUSTOM_LABEL,
      telegramMessageId: 9,
    });
    expect(pending.markedAt).toBe(marked.json.pendingQuestion.markedAt);

    // A changed question has not been posted or read back yet (#4570): it
    // reads as unmarked, so the next cycle finishes the mark instead of
    // reading replies to the old question comment. The marker to remove stays.
    expect(
      runStubOnly(sandbox, ["ledger", SET_QUESTION, REF], {
        input: "A different wording",
      }).status
    ).toBe(0);
    const reasked = readLedgerFile(sandbox).items[REF].pendingQuestion;
    expect(reasked).toMatchObject({
      kind: DECISION,
      markerType: "label",
      marker: CUSTOM_LABEL,
      markedAt: null,
    });
  });

  it("refuses an unknown kind and a mark with no pending question", () => {
    const sandbox = githubSandbox();
    expect(ask(sandbox, "whim").status).toBe(2);
    expect(
      runStubOnly(sandbox, [
        "ledger",
        "marked",
        "other#1",
        "--marker-type",
        "label",
        "--marker",
        "x",
        "--comment-id",
        "42",
      ]).status
    ).toBe(2);
  });

  it("clears the question and, with --reset-attempts, the attempt count", () => {
    const sandbox = githubSandbox();
    runStubOnly(sandbox, ["ledger", "record-spawn", REF, "--worker", "wk-a"]);
    runStubOnly(sandbox, ["ledger", "record-spawn", REF, "--worker", "wk-b"]);
    ask(sandbox, "exhausted");
    const cleared = runStubOnly(sandbox, [
      "ledger",
      "clear-question",
      REF,
      "--reset-attempts",
    ]);
    expect(cleared.status).toBe(0);
    expect(cleared.json).toMatchObject({ pendingQuestion: null, attempts: 0 });
  });
});
