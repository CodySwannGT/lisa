/**
 * `pickItemAnswer` hardening from CodySwannGT/lisa#4571: an all-digit allowed
 * entry is a numeric id and never matches a login (which its owner chooses),
 * and a reply the caller refuses (credential-shaped) is skipped and reported
 * rather than returned, so it cannot wedge the item. Pure: no I/O.
 * @module tests/unit/session-manager/human-answer-ids-and-refusals
 */
import { describe, expect, it } from "vitest";

import { pickItemAnswer } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/human-answer.mjs";

const OPERATOR = "op-login";
const QUESTION_BODY = "[lisa-session-manager-question] o/r#7 needs a human";
const QUESTION = { id: 1, user: { login: OPERATOR }, body: QUESTION_BODY };

describe("an all-digit allowed id is a numeric id, never a login (#4571)", () => {
  const NUMERIC_OPERATOR = "583231";
  const question = {
    id: 1,
    user: { login: OPERATOR, id: 583231 },
    body: QUESTION_BODY,
  };

  it("does not accept a stranger whose login is the operator's numeric id", () => {
    const picked = pickItemAnswer({
      allowed: [NUMERIC_OPERATOR],
      comments: [
        question,
        { id: 2, user: { login: NUMERIC_OPERATOR, id: 999 }, body: "JSON" },
      ],
    });
    expect(picked).toMatchObject({ answer: null, reason: "no-answer-yet" });
  });

  it("still accepts the operator by numeric id", () => {
    const picked = pickItemAnswer({
      allowed: [NUMERIC_OPERATOR],
      comments: [
        question,
        { id: 2, user: { login: NUMERIC_OPERATOR, id: 999 }, body: "JSON" },
        { id: 3, user: { login: OPERATOR, id: 583231 }, body: "CSV" },
      ],
    });
    expect(picked).toMatchObject({
      reason: "answered",
      answer: { text: "CSV", author: NUMERIC_OPERATOR },
    });
  });

  it("does not anchor the question on a stranger's all-digit login", () => {
    const picked = pickItemAnswer({
      allowed: [NUMERIC_OPERATOR],
      comments: [
        {
          id: 1,
          user: { login: NUMERIC_OPERATOR, id: 999 },
          body: "[lisa-session-manager-question] fake",
        },
      ],
    });
    expect(picked.reason).toBe("no-question-comment");
  });

  it("still matches a named login, as before", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      comments: [question, { id: 2, user: { login: OPERATOR }, body: "CSV" }],
    });
    expect(picked.answer?.author).toBe(OPERATOR);
  });
});

describe("a refused reply is skipped and reported, never returned (#4571)", () => {
  const refuses = (text: string) =>
    text.includes("SECRET") ? "a secret" : null;

  it("skips the refused reply and takes the next one", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      refuses,
      comments: [
        QUESTION,
        { id: 2, user: { login: OPERATOR }, body: "SECRET=1" },
        { id: 3, user: { login: OPERATOR }, body: "Use CSV." },
      ],
    });
    expect(picked).toMatchObject({
      reason: "answered",
      answer: { text: "Use CSV." },
      refused: [{ id: "2", author: OPERATOR, why: "a secret" }],
    });
  });

  it("says credential-refused when nothing else answers", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      refuses,
      comments: [
        QUESTION,
        { id: 2, user: { login: OPERATOR }, body: "SECRET" },
      ],
    });
    expect(picked).toMatchObject({
      answer: null,
      reason: "credential-refused",
    });
  });
});
