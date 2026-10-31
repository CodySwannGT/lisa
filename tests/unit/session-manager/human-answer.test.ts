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
const QUESTION = {
  id: 1,
  user: { login: OPERATOR },
  body: "[lisa-session-manager-question] o/r#7 needs a human",
};

describe("isMachineAuthoredComment", () => {
  it.each([
    ["a leading sync tag", "[claude-sync] implementation in progress"],
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
          body: "[claude-sync] implementation in progress",
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
