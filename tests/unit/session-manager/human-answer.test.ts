/**
 * The one predicate that decides a comment is a machine's, never a human's
 * answer (CodySwannGT/lisa#4555, part 3), and how `pickItemAnswer` applies it
 * before the stable-id author match.
 *
 * In a single-user setup the operator's tracker identity is also the one the
 * workers and the manager post as, so an operator-id match alone proves
 * nothing: the predicate runs first. It excludes, one row per marker, a
 * leading bracketed machine tag, any `[lisa-` occurrence, a `<!-- lisa:`
 * comment, "Written by Claude", and the Claude Code attribution footer; and
 * any comment whose id the manager recorded as its own, with no marker at
 * all. Pure: no I/O.
 * @module tests/unit/session-manager/human-answer
 */
import { describe, expect, it } from "vitest";

import {
  isMachineAuthoredComment,
  pickItemAnswer,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/human-answer.mjs";

const OPERATOR = "op-login";
const SYNC_TAG = "[claude-sync] implementation in progress";
const QUESTION = {
  id: 1,
  user: { login: OPERATOR },
  body: "[lisa-session-manager-question] o/r#7 needs a human",
};

describe("isMachineAuthoredComment", () => {
  it.each([
    ["a leading sync tag", SYNC_TAG],
    ["an indented leading lisa tag", "  [lisa-tracker-claim] Claimed by Lisa."],
    ["the manager's question prefix", "[lisa-session-manager-question] x"],
    ["the manager's own prefix", "[lisa-session-manager] Released: done"],
    ["a [lisa- marker mid-body", "Context first, then [LISA-retirement] tag"],
    ["a lisa HTML marker", "Plain text\n<!-- lisa:usage-ledger -->"],
    ["a lisa HTML marker with no space", "x <!--lisa:evidence -->"],
    ["Written by Claude", "Summary of the fix.\n\n_Written by Claude_"],
    ["the attribution footer", "Done.\n\nGenerated with Claude Code"],
    [
      "the emoji attribution footer",
      "Done.\n\n🤖 Generated with [Claude Code](https://claude.com)",
    ],
  ])("excludes %s", (_label, body) => {
    expect(isMachineAuthoredComment({ user: { login: OPERATOR }, body })).toBe(
      true
    );
  });

  it.each([
    ["a numeric id", { id: 9001 }, ["9001"]],
    ["a string node id", { id: "IC_kwDOabc" }, ["IC_kwDOabc"]],
    ["a REST node_id", { id: 5, node_id: "IC_node" }, ["IC_node"]],
  ])(
    "excludes a manager-posted comment by %s, with no marker",
    (_label, ids, managerCommentIds) => {
      const comment = { ...ids, user: { login: OPERATOR }, body: "CSV." };
      expect(isMachineAuthoredComment(comment, { managerCommentIds })).toBe(
        true
      );
      expect(isMachineAuthoredComment(comment)).toBe(false);
    }
  );

  it("accepts a clean operator comment", () => {
    expect(
      isMachineAuthoredComment(
        { id: 2, user: { login: OPERATOR }, body: "Use CSV, please." },
        { managerCommentIds: ["1"] }
      )
    ).toBe(false);
  });
});

describe("pickItemAnswer runs the predicate before the author match", () => {
  it("skips an operator's marked comment and a manager-posted id, then takes the clean reply", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      managerCommentIds: ["3"],
      comments: [
        QUESTION,
        {
          id: 2,
          user: { login: OPERATOR },
          body: SYNC_TAG,
        },
        { id: 3, user: { login: OPERATOR }, body: "Posted by the manager." },
        { id: 4, user: { login: OPERATOR }, body: "Use CSV." },
      ],
    });
    expect(picked).toMatchObject({
      reason: "answered",
      answer: { text: "Use CSV.", author: OPERATOR },
    });
  });

  it("queues nothing when only machine comments follow, operator id or not", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      managerCommentIds: ["3"],
      comments: [
        QUESTION,
        { id: 3, user: { login: OPERATOR }, body: "Posted by the manager." },
        { id: 4, user: { login: OPERATOR }, body: "x\n_Written by Claude_" },
      ],
    });
    expect(picked).toEqual({ answer: null, reason: "no-answer-yet" });
  });
});

const STRANGER = "stranger-login";
const QUOTED_QUESTION = [
  "> [lisa-session-manager-question] o/r#7 needs a human",
  ">",
  "> How to answer: reply here.",
  "",
  "Use CSV.",
].join("\n");

describe("a human's reply is never mistaken for a machine's or for the question", () => {
  it.each([
    ["an ordinary checkbox reply", "[x] go with option 1"],
    ["a reply that only quotes the question", QUOTED_QUESTION],
    [
      "a reply that quotes a machine comment",
      `> ${SYNC_TAG}\n\nGo with option 1.`,
    ],
    [
      "a reply that quotes an attribution footer",
      "> 🤖 Generated with Claude Code\n\nShip it.",
    ],
  ])("accepts %s", (_label, body) => {
    expect(isMachineAuthoredComment({ user: { login: OPERATOR }, body })).toBe(
      false
    );
  });

  it.each([
    ["a leading sync tag", SYNC_TAG],
    ["a leading lisa tag after a quote", "> quoted\n[lisa-tracker-claim] x"],
    ["a [lisa- marker outside the quote", "> fine\n\nsee [lisa-retirement]"],
    [
      "a footer outside the quote",
      "> fine\n\nDone.\n\nGenerated with Claude Code",
    ],
  ])("still excludes %s", (_label, body) => {
    expect(isMachineAuthoredComment({ user: { login: OPERATOR }, body })).toBe(
      true
    );
  });

  it.each([
    ["no recorded ids", []],
    ["the question's recorded id", ["1"]],
  ])(
    "takes a quote reply of the question as the answer (%s)",
    (_label, managerCommentIds) => {
      const picked = pickItemAnswer({
        allowed: [OPERATOR],
        managerCommentIds,
        comments: [
          QUESTION,
          { id: 2, user: { login: OPERATOR }, body: QUOTED_QUESTION },
        ],
      });
      expect(picked).toMatchObject({
        reason: "answered",
        answer: { author: OPERATOR },
      });
      expect(picked.answer?.text).toContain("Use CSV.");
    }
  );

  it.each([
    ["no recorded ids", []],
    ["the question's recorded id", ["1"]],
  ])(
    "does not let a stranger's later marker comment hide the answer (%s)",
    (_label, managerCommentIds) => {
      const picked = pickItemAnswer({
        allowed: [OPERATOR],
        managerCommentIds,
        comments: [
          QUESTION,
          { id: 2, user: { login: OPERATOR }, body: "Use CSV." },
          {
            id: 3,
            user: { login: STRANGER },
            body: "[lisa-session-manager-question] o/r#7 needs a human",
          },
        ],
      });
      expect(picked).toMatchObject({
        reason: "answered",
        answer: { text: "Use CSV.", author: OPERATOR },
      });
    }
  );

  it("anchors on the latest recorded id only, not on a later marker from an allowed author", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      managerCommentIds: ["1"],
      comments: [
        QUESTION,
        { id: 2, user: { login: OPERATOR }, body: "Use CSV." },
        {
          id: 3,
          user: { login: OPERATOR },
          body: "[lisa-session-manager-question] pasted again by hand",
        },
      ],
    });
    expect(picked.answer?.text).toBe("Use CSV.");
  });

  it("finds no question when the recorded id is not among the comments", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      managerCommentIds: ["99"],
      comments: [QUESTION, { id: 2, user: { login: OPERATOR }, body: "CSV" }],
    });
    expect(picked).toEqual({ answer: null, reason: "no-question-comment" });
  });

  it("takes an operator's [x] reply as the answer", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      comments: [
        QUESTION,
        { id: 2, user: { login: OPERATOR }, body: "[x] option 1" },
      ],
    });
    expect(picked.answer?.text).toBe("[x] option 1");
  });

  it("takes a reply quoting a machine comment, and still skips the machine comment itself", () => {
    const picked = pickItemAnswer({
      allowed: [OPERATOR],
      comments: [
        QUESTION,
        { id: 2, user: { login: OPERATOR }, body: "[claude-sync] in progress" },
        {
          id: 3,
          user: { login: OPERATOR },
          body: "> [claude-sync] in progress\n\nGo with option 1.",
        },
      ],
    });
    expect(picked.answer?.text).toContain("Go with option 1.");
  });
});
