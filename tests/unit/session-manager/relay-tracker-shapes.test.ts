/**
 * What the queue makes of a relayed hold release as each tracker really
 * stores it (CodySwannGT/lisa#5190).
 *
 * Jira stores a comment as a structured document, and flattening it to text
 * erases the difference between a statement and a quotation: a quoted line, a
 * code block, a list item and a panel all become a plain first line. The
 * queue keeps that difference for comments, so a relay that only repeats the
 * line releases nothing, while a person's comment reads exactly as before.
 *
 * GitHub resolves a `login:` entry to an account id at run time, which is the
 * one way an account can end up listed both as a person and as a relay
 * without validation seeing it. It is then a relay and nothing else.
 * @module tests/unit/session-manager/relay-tracker-shapes
 */
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { adfCommentText } from "../../../plugins/src/base/scripts/ready-queue-order.mjs";
import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
} from "./support/cli-harness.js";

afterEach(() => removeSandboxes());

const PERSON = "4242";
const RELAY = "9001";
const AUTHOR = "trusted-author";
const REASON = "recurring-spend";
const MARKER = "[lisa-human-gate-release]";
const HOLD = `Waiting on a spend decision.\n<!-- [lisa-human-gate] reason=${REASON} -->`;
const RELAYED = `${MARKER} relayed-for=${PERSON} reason=${REASON}`;
const DIRECT = `${MARKER} reason=${REASON}`;
const HELD = "human-gated";
const PARAGRAPH = "paragraph";
const KEY = "DEMO-1";
const SECOND_PARAGRAPH = "a second paragraph";
const CARD_FIRST = "a paragraph holding only a link card, before it";
const WITH_RELAY = { trustedReleaseIds: [`id:${PERSON}`, `relay:${RELAY}`] };

/**
 * A plain text node.
 * @param text - The text
 * @param code - Whether it carries the inline-code mark
 * @returns Document node
 */
const textNode = (text: string, code = false) => ({
  type: "text",
  text,
  ...(code ? { marks: [{ type: "code" }] } : {}),
});

/**
 * A paragraph holding one line.
 * @param text - The line
 * @param code - Whether it is marked as inline code
 * @returns Document node
 */
const paragraph = (text: string, code = false) => ({
  type: PARAGRAPH,
  content: [textNode(text, code)],
});

/**
 * A comment document.
 * @param blocks - Top-level blocks
 * @returns Jira comment body
 */
const doc = (...blocks: unknown[]) => ({ type: "doc", content: blocks });

/** The relayed line as a plain first paragraph, then an explanation. */
const PLAIN = doc(paragraph(RELAYED), paragraph("Approved in chat."));

/** Every way Jira can hold the line without the relay having stated it. */
const QUOTED: readonly [string, unknown][] = [
  ["a quote", doc({ type: "blockquote", content: [paragraph(RELAYED)] })],
  ["a code block", doc({ type: "codeBlock", content: [textNode(RELAYED)] })],
  ["inline code", doc(paragraph(RELAYED, true))],
  [
    "a list item",
    doc({
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph(RELAYED)] }],
    }),
  ],
  ["a panel", doc({ type: "panel", content: [paragraph(RELAYED)] })],
  [
    "struck-out text",
    doc({
      type: PARAGRAPH,
      content: [{ ...textNode(RELAYED), marks: [{ type: "strike" }] }],
    }),
  ],
  [SECOND_PARAGRAPH, doc(paragraph("The form is:"), paragraph(RELAYED))],
  [
    CARD_FIRST,
    doc(
      {
        type: PARAGRAPH,
        content: [
          { type: "inlineCard", attrs: { url: "https://example.com" } },
        ],
      },
      paragraph(RELAYED)
    ),
  ],
  [
    "a paragraph that starts with a mention",
    doc({
      type: PARAGRAPH,
      content: [
        { type: "mention", attrs: { id: "someone", text: "@someone" } },
        textNode(RELAYED),
      ],
    }),
  ],
];

describe("queue on Jira", () => {
  /**
   * Run the real queue CLI with one held Jira issue carrying one comment.
   * @param body - The comment's document
   * @param author - The comment's author
   * @returns CLI result
   */
  function queue(body: unknown, author: Record<string, unknown>) {
    const sandbox = makeSandbox({
      sessionManager: {
        name: "relay-queue-jira",
        operatorIds: [PERSON],
        trustedAuthorIds: [AUTHOR],
        ...WITH_RELAY,
      },
      extraConfig: {
        humanGate: { mode: "strict" },
        github: { org: "example-org", repo: "demo-repo" },
      },
    });
    const input = path.join(sandbox.root, "jira-queue.json");
    writeJson(input, {
      complete: true,
      pages: 1,
      items: [
        {
          key: KEY,
          fields: {
            description: HOLD,
            reporter: { accountId: AUTHOR },
            comment: { comments: [{ body, author }] },
          },
        },
      ],
    });
    return runCli(sandbox, ["queue", "--tracker", "jira", "--input", input]);
  }

  const relay = { accountId: RELAY, accountType: "app" };
  const person = { accountId: PERSON, accountType: "atlassian" };

  it("dispatches an item the relay released in a plain first paragraph", () => {
    const result = queue(PLAIN, relay);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([
      expect.objectContaining({ ref: KEY }),
    ]);
  });

  it.each(QUOTED)(
    "keeps the hold when the relay's line is in %s",
    (_n, body) => {
      const result = queue(body, relay);
      expect(result.status, result.stderr).toBe(0);
      expect(result.json.ordered).toEqual([]);
      expect(result.json.excluded).toEqual([{ ref: KEY, reason: HELD }]);
    }
  );

  it.each([
    ["a plain paragraph", doc(paragraph(DIRECT))],
    ["a quote", doc({ type: "blockquote", content: [paragraph(DIRECT)] })],
    ["inline code", doc(paragraph(DIRECT, true))],
    [SECOND_PARAGRAPH, doc(paragraph("Approved."), paragraph(DIRECT))],
  ])("still reads a person's own release in %s", (_name, body) => {
    const result = queue(body, person);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([
      expect.objectContaining({ ref: KEY }),
    ]);
  });
});

describe("adfCommentText", () => {
  it("leaves plain paragraphs as they are and marks every other block as quoted", () => {
    expect(adfCommentText(PLAIN)).toBe(`${RELAYED}\nApproved in chat.`);
    for (const [, body] of QUOTED.filter(
      ([n]) => n !== SECOND_PARAGRAPH && n !== CARD_FIRST
    ))
      expect(adfCommentText(body)).toBe(`> ${RELAYED}`);
  });

  it("passes text some access paths return straight through", () => {
    expect(adfCommentText(RELAYED)).toBe(RELAYED);
    expect(adfCommentText(null)).toBe("");
  });
});

describe("queue on GitHub, when a login resolves to the relay's own account", () => {
  const ISSUES =
    "repos/example-org/demo-repo/issues?state=open&labels=status%3Aready&per_page=100";
  const COMMENTS = "repos/example-org/demo-repo/issues/1/comments?per_page=100";
  const LOGIN = "agent-machine";

  /**
   * Run the queue with the relay's account also listed by login, the comment
   * coming from that account with no bot flag.
   * @param body - The comment text
   * @returns CLI result
   */
  function queue(body: string) {
    const sandbox = makeSandbox({
      sessionManager: {
        name: "relay-queue-login",
        operatorIds: [PERSON],
        trustedAuthorIds: ["123"],
        trustedReleaseIds: [`login:${LOGIN}`, `id:${PERSON}`, `relay:${RELAY}`],
      },
      extraConfig: {
        humanGate: { mode: "strict" },
        github: { org: "example-org", repo: "demo-repo" },
      },
    });
    const account = { id: Number(RELAY), login: LOGIN, type: "User" };
    const routes = path.join(sandbox.root, "gh-routes.json");
    writeJson(routes, [
      {
        match: ISSUES,
        body: [[{ number: 1, title: "Held", body: HOLD, user: { id: 123 } }]],
      },
      { match: COMMENTS, body: [[{ body, user: account }]] },
      { match: `users/${LOGIN}`, body: account },
    ]);
    return runCli(
      sandbox,
      ["queue", "--tracker", "github", "--label", "status:ready"],
      { env: { STUB_GH_ROUTES: routes } }
    );
  }

  it.each([
    ["a release in its own name", DIRECT],
    [
      "a release naming itself",
      `${MARKER} relayed-for=${RELAY} reason=${REASON}`,
    ],
    ["a quoted relayed line", `> ${RELAYED}`],
  ])("keeps the hold on %s", (_name, body) => {
    const result = queue(body);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toEqual([]);
  });

  it("still relays for the trusted person", () => {
    const result = queue(RELAYED);
    expect(result.status, result.stderr).toBe(0);
    expect(result.json.ordered).toHaveLength(1);
  });
});
