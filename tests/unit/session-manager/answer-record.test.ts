/**
 * An acknowledged answer reaches the next attempt (CodySwannGT/lisa#4624).
 *
 * When the worker that asked a question has finished (`DONE` or `FAILED`,
 * including one the operator stopped with `stop REF`), or the item is
 * `exhausted`, no worker receives an answer given with `answer` or on
 * Telegram: the next attempt can only read it on the item. `planAnswerRecord`
 * decides whether the manager must write the answer onto the item before it
 * clears the question, and builds that comment. An answer that came from the
 * item is already there, and a live worker receives the answer directly, so
 * both are left exactly as before. A credential-shaped answer is refused.
 * Pure: no I/O, no clock.
 * @module tests/unit/session-manager/answer-record
 */
import { describe, expect, it } from "vitest";

import { planAnswerRecord } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/answer-record.mjs";
import { MANAGER_COMMENT_PREFIX } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/human-needed.mjs";

const REF = "o/r#7";
const AT = "2026-11-08T12:00:00.000Z";
const ANSWER = "use the v2 endpoint";
const WORKER_QUESTION = "worker-question";
const FAILED = "FAILED";

/**
 * A pending question with a queued answer.
 * @param source - Where the answer came from
 * @param text - Answer text
 * @param kind - Question kind
 * @returns Pending question
 */
function pending(source: string, text = ANSWER, kind = WORKER_QUESTION) {
  return {
    text: "Which endpoint should the export call?",
    kind,
    answer: { source, text, author: null, at: AT },
  };
}

/**
 * The comment of a plan that records, failing the test when it does not.
 * @param plan - Plan
 * @returns Comment body
 */
function commentOf(plan: ReturnType<typeof planAnswerRecord>): string {
  if (!plan.record) throw new Error(`expected a record, got ${plan.reason}`);
  return plan.comment;
}

describe("planAnswerRecord", () => {
  it("records a terminal answer to a FAILED (stopped) worker's question", () => {
    expect(
      planAnswerRecord({ ref: REF, status: FAILED, pending: pending("cli") })
    ).toEqual({
      ref: REF,
      record: true,
      source: "cli",
      comment: `[lisa-session-manager] The operator answered the question above (by answer, ${AT}): ${ANSWER}`,
    });
  });

  it("records a Telegram answer to a DONE worker's question", () => {
    const plan = planAnswerRecord({
      ref: REF,
      status: "DONE",
      pending: pending("channel"),
    });
    expect(plan).toMatchObject({ ref: REF, record: true, source: "channel" });
    expect(commentOf(plan)).toBe(
      `[lisa-session-manager] The operator answered the question above (by Telegram, ${AT}): ${ANSWER}`
    );
  });

  it("records an answer to an exhausted item, whatever its status", () => {
    const plan = planAnswerRecord({
      ref: REF,
      status: "running",
      pending: pending("cli", ANSWER, "exhausted"),
    });
    expect(plan.record).toBe(true);
    expect(commentOf(plan)).toContain(ANSWER);
  });

  it("does not re-post an answer that came from the item", () => {
    expect(
      planAnswerRecord({ ref: REF, status: FAILED, pending: pending("item") })
    ).toEqual({ ref: REF, record: false, reason: "answered-on-item" });
  });

  it.each(["running", "question"])(
    "leaves an answer to a worker that has not finished (%s) unchanged",
    status => {
      expect(
        planAnswerRecord({ ref: REF, status, pending: pending("cli") })
      ).toEqual({ ref: REF, record: false, reason: "worker-not-finished" });
    }
  );

  it("records nothing when no question or no answer is pending", () => {
    expect(
      planAnswerRecord({ ref: REF, status: FAILED, pending: null })
    ).toEqual({ ref: REF, record: false, reason: "no-pending-question" });
    expect(
      planAnswerRecord({
        ref: REF,
        status: FAILED,
        pending: { ...pending("cli"), answer: null },
      })
    ).toEqual({ ref: REF, record: false, reason: "no-answer-queued" });
  });

  it("refuses a credential-shaped answer, so nothing is posted", () => {
    const leak = `key ${["AKIA", "ABCDEFGHIJKLMNOP"].join("")}`;
    expect(() =>
      planAnswerRecord({
        ref: REF,
        status: FAILED,
        pending: pending("cli", leak),
      })
    ).toThrow(/credential/);
  });

  it("keeps a multi-line answer verbatim as a quote under the first line", () => {
    const plan = planAnswerRecord({
      ref: REF,
      status: FAILED,
      pending: pending("cli", "use v2\n\n[lisa-session-manager-question] x"),
    });
    expect(commentOf(plan)).toBe(
      [
        `[lisa-session-manager] The operator answered the question above (by answer, ${AT}):`,
        "",
        "> use v2",
        ">",
        "> [lisa-session-manager-question] x",
      ].join("\n")
    );
    expect(commentOf(plan).startsWith(`${MANAGER_COMMENT_PREFIX} `)).toBe(true);
  });
});
