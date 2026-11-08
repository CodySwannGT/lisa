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
import {
  MANAGER_COMMENT_PREFIX,
  findCredentialShape,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/human-needed.mjs";

const REF = "o/r#7";
const AT = "2026-11-08T12:00:00.000Z";
const ANSWER = "use the v2 endpoint";
const WORKER_QUESTION = "worker-question";
const FAILED = "FAILED";
const DECISION = "decision";
/** A made-up value, assembled so secret scanners do not flag the fixture. */
const FAKE = ["not", "real", "value9"].join("-");

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
      answerAt: AT,
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

  it.each([
    ["running", WORKER_QUESTION],
    ["question", WORKER_QUESTION],
    ["running", DECISION],
  ])(
    "leaves an answer to a worker that has not finished (%s, %s) unchanged",
    (status, kind) => {
      expect(
        planAnswerRecord({
          ref: REF,
          status,
          worker: "wk-a",
          pending: pending("cli", ANSWER, kind),
        })
      ).toEqual({ ref: REF, record: false, reason: "worker-not-finished" });
    }
  );

  it.each(["cli", "channel"])(
    "records a %s answer to a decision no worker has picked up yet",
    source => {
      const plan = planAnswerRecord({
        ref: REF,
        status: "question",
        worker: null,
        pending: pending(source, ANSWER, DECISION),
      });
      expect(plan).toMatchObject({ record: true, source });
      expect(commentOf(plan)).toContain(ANSWER);
    }
  );

  it.each(["DONE", FAILED])(
    "leaves a repo-route answer to the repo stamp even after the worker reported %s",
    status => {
      expect(
        planAnswerRecord({
          ref: REF,
          status,
          worker: "wk-a",
          pending: pending("cli", "backend", "repo-route"),
        })
      ).toEqual({ ref: REF, record: false, reason: "routed-by-repo-stamp" });
    }
  );

  it("leaves a repo-route answer with no worker to the repo stamp", () => {
    expect(
      planAnswerRecord({
        ref: REF,
        status: "question",
        worker: null,
        pending: pending("cli", "backend", "repo-route"),
      })
    ).toEqual({ ref: REF, record: false, reason: "routed-by-repo-stamp" });
  });

  it("says the time is unknown when the queued answer has none", () => {
    const base = pending("cli");
    const plan = planAnswerRecord({
      ref: REF,
      status: FAILED,
      pending: { ...base, answer: { ...base.answer, at: undefined } },
    });
    expect(commentOf(plan)).toBe(
      `[lisa-session-manager] The operator answered the question above (by answer, time unknown): ${ANSWER}`
    );
  });

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

  it.each([
    ["a URI with a password", `use postgres://app:${FAKE}@db.internal/x`],
    ["a password assignment", `password=${["hunter", "2x9"].join("")}`],
    ["a token assignment", `Token: ${FAKE}`],
    ["a secret assignment", `SECRET = ${FAKE}`],
    ["an env-style token", `GITHUB_TOKEN=${["abcd1234", "efgh5678"].join("")}`],
    ["a prefixed secret", `client_secret: ${["abcd", "1234efgh"].join("")}`],
    ["a prefixed password", `DB_PASSWORD=${["hunter2", "hunter2"].join("")}`],
    [
      "a long digit-free password",
      `password=${["correct", "horse", "battery"].join("")}`,
    ],
    ["a URI with a password and a port", `postgres://admin:${FAKE}@db:5432/x`],
  ])("refuses %s", (_label, text) => {
    expect(findCredentialShape(text)).not.toBeNull();
  });

  it.each([
    "use the v2 endpoint at https://api.example.com/v2",
    "the token expires daily, so refresh it",
    "https://ops@example.com/runbook",
    "secret: yes",
    "token: expires daily",
    "password: changeme",
    "token=abc12",
    "mailto:ops@example.com",
    "http://localhost:3000/search?owner=a@b.com",
    "https://host:8080/path/@user",
    "the tokenizer: expires daily",
  ])("does not refuse ordinary prose: %s", text => {
    expect(findCredentialShape(text)).toBeNull();
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
