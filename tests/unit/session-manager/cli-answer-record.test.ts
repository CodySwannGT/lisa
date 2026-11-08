/**
 * Answers to a finished or exhausted item end up on the item
 * (CodySwannGT/lisa#4624): `answer-plan`, `channel-answer`, and the Clearing
 * order the runbook prescribes for them.
 *
 * Before the fix, an answer given with `answer` or on Telegram to a question
 * whose worker had finished was acknowledged, never written to the item, and
 * deleted from the ledger at clear time, so the next attempt never saw it.
 * `answer-plan` now says which comment to post (it writes nothing), and the
 * Clearing sequence posts it and reads it back BEFORE `ledger clear-question`.
 * A failed post or read-back leaves the question, with its answer, pending.
 * Runs the real CLI as a process with a stub-only PATH; the tracker writer is
 * an in-test stub standing in for `lisa-tracker-write` / `lisa-tracker-read`.
 * @module tests/unit/session-manager/cli-answer-record
 */
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  removeSandboxes,
  writeJson,
  type Sandbox,
} from "./support/cli-harness.js";
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

const ANSWER = "use the v2 endpoint";
const ANSWER_PLAN = "answer-plan";
const LEDGER = "ledger";
const CLEAR_QUESTION = "clear-question";
const SPAWN_A = [LEDGER, "record-spawn", REF, "--worker", "wk-a"];
const RECORD_PREFIX =
  "[lisa-session-manager] The operator answered the question above (by ";
const LEAK = `key ${["AKIA", "ABCDEFGHIJKLMNOP"].join("")}`;

/**
 * Record a worker for REF, ask its question, and finish it.
 * @param sandbox - Project sandbox
 * @param status - Finish status
 * @param kind - Question kind
 */
function finishedWithQuestion(
  sandbox: Sandbox,
  status: "DONE" | "FAILED",
  kind = "worker-question"
): void {
  runStubOnly(sandbox, SPAWN_A);
  ask(sandbox, kind);
  expect(
    runStubOnly(sandbox, [LEDGER, "finish", REF, "--status", status], {
      input: "stopped by the operator",
    }).status
  ).toBe(0);
}

describe("answer-plan", () => {
  it("plans posting a terminal answer to a FAILED (stopped) worker's question", () => {
    const sandbox = githubSandbox();
    finishedWithQuestion(sandbox, "FAILED");
    expect(
      runStubOnly(sandbox, ["answer", REF], { input: ANSWER }).status
    ).toBe(0);
    const plan = runStubOnly(sandbox, [ANSWER_PLAN, REF]);
    expect(plan.status).toBe(0);
    expect(plan.json).toMatchObject({ ref: REF, record: true, source: "cli" });
    expect(plan.json.comment.startsWith(`${RECORD_PREFIX}answer, `)).toBe(true);
    expect(plan.json.comment.endsWith(`: ${ANSWER}`)).toBe(true);
  });

  it("plans posting a Telegram answer (channel-answer) to a DONE worker's question", () => {
    const sandbox = githubSandbox();
    finishedWithQuestion(sandbox, "DONE");
    const queued = runStubOnly(sandbox, ["channel-answer", REF], {
      input: ANSWER,
    });
    expect(queued.status).toBe(0);
    expect(queued.json).toEqual({ queued: true, ref: REF, source: "channel" });
    const plan = runStubOnly(sandbox, [ANSWER_PLAN, REF]);
    expect(plan.json).toMatchObject({ record: true, source: "channel" });
    expect(plan.json.comment.startsWith(`${RECORD_PREFIX}Telegram, `)).toBe(
      true
    );
  });

  it("plans posting an answer to an exhausted item", () => {
    const sandbox = githubSandbox();
    runStubOnly(sandbox, SPAWN_A);
    ask(sandbox, "exhausted");
    runStubOnly(sandbox, ["answer", REF], { input: ANSWER });
    expect(runStubOnly(sandbox, [ANSWER_PLAN, REF]).json).toMatchObject({
      record: true,
      source: "cli",
    });
  });

  it("posts nothing for a live worker or an answer taken from the item", () => {
    const live = githubSandbox();
    runStubOnly(live, SPAWN_A);
    ask(live);
    runStubOnly(live, ["answer", REF], { input: ANSWER });
    expect(runStubOnly(live, [ANSWER_PLAN, REF]).json).toEqual({
      ref: REF,
      record: false,
      reason: "worker-not-finished",
    });

    const onItem = githubSandbox();
    finishedWithQuestion(onItem, "FAILED");
    const picked = runStubOnly(onItem, ["item-answer", REF], {
      input: JSON.stringify({
        comments: [
          {
            author: { login: OPERATOR },
            body: `${MARKER} ${REF} needs a human`,
          },
          { author: { login: OPERATOR }, body: ANSWER },
        ],
      }),
    });
    expect(picked.json).toMatchObject({ queued: true, source: "item" });
    expect(runStubOnly(onItem, [ANSWER_PLAN, REF]).json).toEqual({
      ref: REF,
      record: false,
      reason: "answered-on-item",
    });
  });

  it("refuses a credential-shaped answer: exit 2, nothing to post", () => {
    const sandbox = githubSandbox();
    finishedWithQuestion(sandbox, "FAILED");
    const leak = runStubOnly(sandbox, ["channel-answer", REF], {
      input: LEAK,
    });
    expect(leak.status).toBe(2);
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toBeNull();
  });

  it("refuses a credential-shaped answer already in the ledger", () => {
    const sandbox = githubSandbox();
    finishedWithQuestion(sandbox, "FAILED");
    runStubOnly(sandbox, ["answer", REF], { input: ANSWER });
    const ledgerFile = readLedgerFile(sandbox);
    ledgerFile.items[REF].pendingQuestion.answer.text = LEAK;
    writeJson(
      path.join(sandbox.root, ".lisa/session-manager/ledger.json"),
      ledgerFile
    );
    const plan = runStubOnly(sandbox, [ANSWER_PLAN, REF]);
    expect(plan.status).toBe(2);
    expect(plan.stdout).toBe("");
  });
});

/** What the stub tracker writer was asked to do, in order. */
interface Step {
  readonly step: string;
  readonly detail?: string;
}

/**
 * A stand-in for `lisa-tracker-write` and `lisa-tracker-read`: it posts into
 * an in-memory list of comments, or fails at the post or the read-back.
 * @param fail - Which call fails, if any
 * @returns The stub and the steps it saw
 */
function stubTracker(fail: "none" | "post" | "read-back") {
  const comments: string[] = [];
  const steps: Step[] = [];
  return {
    steps,
    post(body: string): boolean {
      steps.push({ step: "post", detail: body });
      if (fail === "post") return false;
      comments.push(body);
      return true;
    },
    readBack(body: string): boolean {
      steps.push({ step: "read-back" });
      return fail !== "read-back" && comments.includes(body);
    },
  };
}

/**
 * The runbook's Clearing for a finished worker (SKILL.md "Clearing"):
 * `answer-plan`, post its comment, read it back, and only then remove the
 * marker and `ledger clear-question`. A failed post or read-back stops
 * before clearing, leaving the question pending (the cycle ends
 * recovery-required).
 * @param sandbox - Project sandbox
 * @param tracker - Stub tracker
 * @returns Whether the question was cleared
 */
function clearing(
  sandbox: Sandbox,
  tracker: ReturnType<typeof stubTracker>
): boolean {
  const plan = runStubOnly(sandbox, [ANSWER_PLAN, REF]);
  expect(plan.status).toBe(0);
  if (plan.json.record) {
    if (!tracker.post(plan.json.comment)) return false;
    if (!tracker.readBack(plan.json.comment)) return false;
  }
  tracker.steps.push({ step: "remove-marker" });
  expect(runStubOnly(sandbox, [LEDGER, CLEAR_QUESTION, REF]).status).toBe(0);
  tracker.steps.push({ step: CLEAR_QUESTION });
  return true;
}

describe("Clearing a finished worker's question", () => {
  it("posts the answer and reads it back before clear-question", () => {
    const sandbox = githubSandbox();
    finishedWithQuestion(sandbox, "FAILED");
    runStubOnly(sandbox, ["answer", REF], { input: ANSWER });
    const tracker = stubTracker("none");

    expect(clearing(sandbox, tracker)).toBe(true);
    expect(tracker.steps.map(step => step.step)).toEqual([
      "post",
      "read-back",
      "remove-marker",
      CLEAR_QUESTION,
    ]);
    expect(tracker.steps[0]?.detail).toContain(ANSWER);
    expect(readLedgerFile(sandbox).items[REF].pendingQuestion).toBeNull();
  });

  it.each(["post", "read-back"] as const)(
    "keeps the question and its answer pending when the %s fails",
    fail => {
      const sandbox = githubSandbox();
      finishedWithQuestion(sandbox, "FAILED");
      runStubOnly(sandbox, ["answer", REF], { input: ANSWER });
      const tracker = stubTracker(fail);

      expect(clearing(sandbox, tracker)).toBe(false);
      expect(tracker.steps.map(step => step.step)).not.toContain(
        CLEAR_QUESTION
      );
      const pending = readLedgerFile(sandbox).items[REF].pendingQuestion;
      expect(pending).not.toBeNull();
      expect(pending.answer).toMatchObject({ source: "cli", text: ANSWER });
    }
  );
});
