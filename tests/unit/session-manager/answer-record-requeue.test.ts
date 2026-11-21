/**
 * A FAILED worker's item goes back to Ready once its answer is recorded
 * (CodySwannGT/lisa#4643, item 11).
 *
 * A worker's `FAILED` moves its item to the `blocked` role, and the blocked
 * pass keeps an item with no dependency edges, so nothing else ever returns
 * it to Ready. When the operator then answers that worker's question, the
 * answer is recorded on the item for "the next attempt", which would never
 * be dispatched. `planAnswerRecord` now says so explicitly with
 * `requeue: true`, whether the answer still has to be posted or is already
 * on the item, so the manager moves the item to the `ready` role in the same
 * update that removes its hold. A `DONE` worker's item, a live worker and a
 * repo-routing answer are left as they were. Pure: no I/O, no clock.
 * @module tests/unit/session-manager/answer-record-requeue
 */
import { afterEach, describe, expect, it } from "vitest";

import { planAnswerRecord } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/answer-record.mjs";
import { removeSandboxes } from "./support/cli-harness.js";
import {
  ask,
  githubSandbox,
  REF as SANDBOX_REF,
  runStubOnly,
} from "./support/human-sandbox.js";

const REF = "o/r#7";
const AT = "2026-11-08T12:00:00.000Z";

afterEach(removeSandboxes);

/**
 * A pending question with a queued answer.
 * @param source - Where the answer came from
 * @param kind - Question kind
 * @returns Pending question
 */
function pending(source: string, kind = "worker-question") {
  return {
    text: "Which endpoint should the export call?",
    kind,
    answer: { source, text: "use v2", author: null, at: AT },
  };
}

describe("planAnswerRecord requeue", () => {
  it.each(["cli", "channel", "item"])(
    "asks for the move to ready for a FAILED worker's answer from %s",
    source => {
      const plan = planAnswerRecord({
        ref: REF,
        status: "FAILED",
        worker: "wk-a",
        pending: pending(source),
      });
      expect(plan).toMatchObject({ ref: REF, requeue: true });
    }
  );

  it("asks for the move for a FAILED worker's decision too", () => {
    expect(
      planAnswerRecord({
        ref: REF,
        status: "FAILED",
        pending: pending("cli", "decision"),
      })
    ).toMatchObject({ record: true, requeue: true });
  });

  it("leaves a human's move to blocked in place after the answer", () => {
    const sandbox = githubSandbox();
    runStubOnly(sandbox, [
      "ledger",
      "record-spawn",
      SANDBOX_REF,
      "--worker",
      "wk-a",
    ]);
    ask(sandbox, "decision");
    expect(
      runStubOnly(
        sandbox,
        ["ledger", "finish", SANDBOX_REF, "--status", "FAILED"],
        {
          input: "left the claimed role outside the manager",
        }
      ).status
    ).toBe(0);
    expect(
      runStubOnly(sandbox, ["answer", SANDBOX_REF], { input: "use v2" }).status
    ).toBe(0);
    expect(
      runStubOnly(sandbox, ["answer-plan", SANDBOX_REF]).json
    ).toMatchObject({
      record: true,
      requeue: false,
    });
  });

  it.each([
    ["a DONE worker", "DONE", "wk-a", pending("cli")],
    ["a live worker", "running", "wk-a", pending("cli")],
    ["a repo-routing answer", "FAILED", "wk-a", pending("cli", "repo-route")],
    ["no queued answer", "FAILED", "wk-a", { kind: "worker-question" }],
    ["no pending question", "FAILED", "wk-a", null],
  ])("leaves %s where it is", (_label, status, worker, question) => {
    const plan = planAnswerRecord({
      ref: REF,
      status,
      worker,
      pending: question,
    });
    expect(plan).not.toHaveProperty("requeue");
  });
});
