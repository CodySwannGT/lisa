/**
 * A replacement answer is never cleared unseen (CodySwannGT/lisa#4624,
 * CodeRabbit on PR #4723).
 *
 * `answer` and a Telegram reply replace a queued answer. When that happens
 * after `answer-plan` ran, the manager has posted the OLD answer on the item;
 * a plain `ledger clear-question` would then delete the replacement without
 * it ever reaching the item. `answer-plan` returns the queued answer's `at`
 * (`answerAt`), and `ledger clear-question --expect-answer-at` refuses (exit 2,
 * nothing changed) when the pending answer is no longer that one. Runs the
 * real CLI as a process with a stub-only PATH.
 * @module tests/unit/session-manager/cli-answer-record-replaced
 */
import { afterEach, describe, expect, it } from "vitest";

import { removeSandboxes, type Sandbox } from "./support/cli-harness.js";
import { readLedgerFile } from "./support/cli-fixtures.js";
import {
  ask,
  githubSandbox,
  REF,
  runStubOnly,
} from "./support/human-sandbox.js";

afterEach(removeSandboxes);

const ANSWER_PLAN = "answer-plan";
const CLEAR = ["ledger", "clear-question", REF, "--expect-answer-at"];

/**
 * A FAILED worker's pending question with a terminal answer queued.
 * @param sandbox - Project sandbox
 * @param text - Answer text
 */
function answeredAfterFailure(sandbox: Sandbox, text: string): void {
  runStubOnly(sandbox, ["ledger", "record-spawn", REF, "--worker", "wk-a"]);
  ask(sandbox);
  runStubOnly(sandbox, ["ledger", "finish", REF, "--status", "FAILED"], {
    input: "stopped by the operator",
  });
  expect(runStubOnly(sandbox, ["answer", REF], { input: text }).status).toBe(0);
}

describe("clear-question --expect-answer-at", () => {
  it("keeps a replacement answer that arrived after answer-plan, and clears the recorded one", () => {
    const sandbox = githubSandbox();
    answeredAfterFailure(sandbox, "use the v2 endpoint");
    const plan = runStubOnly(sandbox, [ANSWER_PLAN, REF]);
    expect(plan.json.answerAt).toBe(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer.at
    );
    const replacement = "no, use the v3 endpoint";
    runStubOnly(sandbox, ["answer", REF], { input: replacement });

    const stale = runStubOnly(sandbox, [...CLEAR, plan.json.answerAt]);
    expect(stale.status).toBe(2);
    expect(stale.stderr).toMatch(/answer changed since it was planned/);
    expect(
      readLedgerFile(sandbox).items[REF].pendingQuestion.answer
    ).toMatchObject({ text: replacement });

    const replan = runStubOnly(sandbox, [ANSWER_PLAN, REF]);
    expect(replan.json.comment.endsWith(`: ${replacement}`)).toBe(true);
    const cleared = runStubOnly(sandbox, [...CLEAR, replan.json.answerAt]);
    expect(cleared.status).toBe(0);
    expect(readLedgerFile(sandbox).items[REF].pendingQuestion).toBeNull();
  });

  it("leaves a plain clear-question unchanged", () => {
    const sandbox = githubSandbox();
    answeredAfterFailure(sandbox, "use the v2 endpoint");
    runStubOnly(sandbox, ["answer", REF], { input: "use v3" });
    expect(runStubOnly(sandbox, ["ledger", "clear-question", REF]).status).toBe(
      0
    );
    expect(readLedgerFile(sandbox).items[REF].pendingQuestion).toBeNull();
  });
});
