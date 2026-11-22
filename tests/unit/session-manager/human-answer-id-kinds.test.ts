/**
 * Kind-keyed answerer entries in `pickItemAnswer` (CodySwannGT/lisa#4623).
 *
 * A plain all-digit entry is a numeric id to the answer matcher (#4571) but a
 * login to the queue and the claim, so an operator whose GitHub login is all
 * digits could not answer on the item, and the stranger whose numeric id
 * equals that login could. `login:` matches only a login and `id:` only an
 * `id` / `accountId`; a plain entry keeps exactly its old meaning.
 * @module tests/unit/session-manager/human-answer-id-kinds
 */
import { describe, expect, it } from "vitest";

import { pickItemAnswer } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/human-answer.mjs";

const QUESTION_BODY = "[lisa-session-manager-question] o/r#7 needs a human";
const MANAGER = { login: "agent-account", id: 1 };

/** The question, posted by the manager and recorded by id. */
const QUESTION = { id: 10, user: MANAGER, body: QUESTION_BODY };

/** The two replies from the ticket's reproduction. */
const OPERATOR_REPLY = {
  id: 11,
  user: { login: "583231", id: 99999 },
  body: "operator says CSV",
};
const STRANGER_REPLY = {
  id: 12,
  user: { login: "someone", id: 583231 },
  body: "stranger says JSON",
};

/**
 * Pick from the question then `replies`, with the question's id recorded.
 * @param allowed - Answerer entries
 * @param replies - Replies after the question
 * @returns The pick
 */
function pick(allowed: string[], replies: Record<string, unknown>[]) {
  return pickItemAnswer({
    allowed,
    comments: [QUESTION, ...replies],
    managerCommentIds: [10],
  });
}

describe("Scenario: A login entry admits only that login", () => {
  it("takes the operator's reply and never the account whose numeric id is 583231", () => {
    const picked = pick(["login:583231"], [STRANGER_REPLY, OPERATOR_REPLY]);
    expect(picked).toMatchObject({
      reason: "answered",
      answer: { text: "operator says CSV", author: "583231" },
    });
  });

  it("never takes the stranger's reply, even alone", () => {
    expect(pick(["login:583231"], [STRANGER_REPLY])).toMatchObject({
      answer: null,
      reason: "no-answer-yet",
    });
  });
});

describe("Scenario: An id entry admits only that numeric id", () => {
  it("does not take a reply by login 99999 whose numeric id is 12345", () => {
    const reply = { id: 11, user: { login: "99999", id: 12345 }, body: "x" };
    expect(pick(["id:99999"], [reply])).toMatchObject({
      answer: null,
      reason: "no-answer-yet",
    });
  });

  it("takes a reply whose numeric id or accountId is the entry", () => {
    expect(pick(["id:99999"], [OPERATOR_REPLY]).answer?.author).toBe("99999");
    const jira = {
      id: 11,
      author: { accountId: "557058:abc-def", displayName: "Op" },
      body: "yes",
    };
    expect(pick(["id:557058:abc-def"], [jira]).answer?.author).toBe(
      "557058:abc-def"
    );
  });
});

describe("plain entries keep their meaning (#4571)", () => {
  it("reads a plain all-digit entry as a numeric id only", () => {
    const picked = pick(["583231"], [OPERATOR_REPLY, STRANGER_REPLY]);
    expect(picked.answer?.text).toBe("stranger says JSON");
  });

  it("reads a plain named entry as a login or an id", () => {
    expect(pick(["someone"], [STRANGER_REPLY]).answer?.author).toBe("someone");
  });

  it("treats a Jira accountId holding a colon as plain", () => {
    const accountId = "557058:abc";
    const jira = { id: 11, author: { accountId }, body: "yes" };
    expect(pick([accountId], [jira]).answer?.author).toBe(accountId);
  });
});

describe("malformed entries admit nobody", () => {
  it.each([["user:583231"], ["login:"], ["id:"]])(
    "%j matches no reply",
    entry => {
      const picked = pick([entry], [OPERATOR_REPLY, STRANGER_REPLY]);
      expect(picked.answer).toBeNull();
    }
  );
});
