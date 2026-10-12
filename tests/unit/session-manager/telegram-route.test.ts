/**
 * Contract tests for routing an inbound Telegram message to a worker.
 *
 * A misrouted answer is worse than none: the wrong worker acts on it with
 * permissions skipped, and the right one keeps waiting. So routing is strict
 * — an explicit ref, then a reply to the question, then the only pending
 * question — and anything else comes back `ambiguous` for the manager to ask
 * about. The text itself is data throughout and is never evaluated.
 * @module tests/unit/session-manager/telegram-route
 */
import { describe, expect, it } from "vitest";

import {
  formatAnswer,
  parseCommand,
  routeInbound,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/telegram-route.mjs";

/** A ref for a GitHub item, whose worker token is `lisa-12`. */
const GITHUB_REF = "owner/lisa#12";

/** The worker serving TEAM-1. */
const TEAM_1_WORKER = "wk-TEAM-1-1012-0900";

/**
 * Build a ledger item, optionally waiting on a question.
 * @param worker - Worker session name
 * @param telegramMessageId - Message id of the pending question, or null for none
 * @returns A ledger item
 */
const item = (worker: string, telegramMessageId: number | null) => ({
  worker,
  pendingQuestion:
    telegramMessageId === null
      ? null
      : { text: "q", askedAt: "", lastPingAt: "", telegramMessageId },
});

/** Two items both waiting, one GitHub item idle. */
const TWO_PENDING = {
  items: {
    "TEAM-1": item(TEAM_1_WORKER, 7),
    "TEAM-12": item("wk-TEAM-12-1012-0901", 8),
    [GITHUB_REF]: item("wk-lisa-12-1012-0902", null),
  },
};

/** Only TEAM-12 waiting. */
const ONE_PENDING = {
  items: {
    "TEAM-1": item(TEAM_1_WORKER, null),
    "TEAM-12": item("wk-TEAM-12-1012-0901", 8),
  },
};

/** Nobody waiting. */
const NONE_PENDING = {
  items: { "TEAM-1": item(TEAM_1_WORKER, null) },
};

describe("routeInbound precedence", () => {
  it.each([
    [
      "[REF] prefix",
      { text: "[TEAM-1] use option 2" },
      "TEAM-1",
      "use option 2",
    ],
    ["REF: prefix", { text: "TEAM-12: 3" }, "TEAM-12", "3"],
    ["REF space prefix", { text: "TEAM-12 go ahead" }, "TEAM-12", "go ahead"],
    ["case-insensitive ref", { text: "team-1: yes" }, "TEAM-1", "yes"],
    [
      "worker token for a GitHub ref",
      { text: "lisa-12: ship it" },
      GITHUB_REF,
      "ship it",
    ],
    [
      "bracketed worker token",
      { text: "[LISA-12] ship it" },
      GITHUB_REF,
      "ship it",
    ],
    [
      "prefix beats reply-to",
      { text: "TEAM-1: 2", replyToMessageId: 8 },
      "TEAM-1",
      "2",
    ],
    [
      "reply-to a pending question",
      { text: "2", replyToMessageId: 8 },
      "TEAM-12",
      "2",
    ],
    [
      "reply-to beats no prefix",
      { text: "the second one", replyToMessageId: 7 },
      "TEAM-1",
      "the second one",
    ],
  ])("routes by %s", (_label, input, ref, body) => {
    expect(routeInbound({ ledger: TWO_PENDING, ...input })).toEqual({
      kind: "answer",
      ref,
      body,
    });
  });

  it("does not let TEAM-1 match a TEAM-12 prefix", () => {
    expect(
      routeInbound({ text: "TEAM-12: 3", ledger: TWO_PENDING })
    ).toMatchObject({
      ref: "TEAM-12",
    });
    expect(routeInbound({ text: "TEAM-123: 3", ledger: TWO_PENDING })).toEqual({
      kind: "ambiguous",
      candidates: ["TEAM-1", "TEAM-12"],
    });
  });

  it("falls back to the only pending question", () => {
    expect(routeInbound({ text: "  option 2 ", ledger: ONE_PENDING })).toEqual({
      kind: "answer",
      ref: "TEAM-12",
      body: "option 2",
    });
  });

  it("ignores a reply to a message that is not a pending question", () => {
    expect(
      routeInbound({ text: "2", replyToMessageId: 99, ledger: ONE_PENDING })
    ).toEqual({ kind: "answer", ref: "TEAM-12", body: "2" });
  });

  it("is ambiguous with two or more pending questions", () => {
    expect(routeInbound({ text: "2", ledger: TWO_PENDING })).toEqual({
      kind: "ambiguous",
      candidates: ["TEAM-1", "TEAM-12"],
    });
  });

  it("is ambiguous with no pending question", () => {
    expect(routeInbound({ text: "2", ledger: NONE_PENDING })).toEqual({
      kind: "ambiguous",
      candidates: [],
    });
  });

  it("does not treat a bare ref with no body as an answer", () => {
    expect(routeInbound({ text: "[TEAM-1]", ledger: TWO_PENDING })).toEqual({
      kind: "ambiguous",
      candidates: ["TEAM-1", "TEAM-12"],
    });
  });

  it("tolerates an empty ledger", () => {
    expect(routeInbound({ text: "hi", ledger: { items: {} } })).toEqual({
      kind: "ambiguous",
      candidates: [],
    });
    expect(routeInbound({ text: "hi", ledger: undefined as never })).toEqual({
      kind: "ambiguous",
      candidates: [],
    });
  });
});

describe("routeInbound commands", () => {
  it("routes a command when no ref or reply targets a worker", () => {
    expect(routeInbound({ text: "pause", ledger: ONE_PENDING })).toEqual({
      kind: "command",
      name: "pause",
    });
  });

  it("resolves the ref of stop to the ledger key", () => {
    expect(routeInbound({ text: "stop lisa-12", ledger: TWO_PENDING })).toEqual(
      {
        kind: "command",
        name: "stop",
        ref: GITHUB_REF,
      }
    );
  });

  it("lets a reply-to answer win over command words", () => {
    expect(
      routeInbound({ text: "pause", replyToMessageId: 8, ledger: TWO_PENDING })
    ).toEqual({ kind: "answer", ref: "TEAM-12", body: "pause" });
  });
});

describe("parseCommand", () => {
  it.each([
    ["status", { kind: "command", name: "status" }],
    ["  STATUS ", { kind: "command", name: "status" }],
    ["/pause", { kind: "command", name: "pause" }],
    ["resume", { kind: "command", name: "resume" }],
    ["cap 0", { kind: "command", name: "cap", value: 0 }],
    ["cap 32", { kind: "command", name: "cap", value: 32 }],
    ["Cap   4", { kind: "command", name: "cap", value: 4 }],
    ["stop TEAM-12", { kind: "command", name: "stop", ref: "TEAM-12" }],
    ["stop owner/lisa#12", { kind: "command", name: "stop", ref: GITHUB_REF }],
  ])("parses %j", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it.each([
    "cap 33",
    "cap -1",
    "cap 1.5",
    "cap",
    "cap two",
    "stop",
    "stop A B",
    "pause now",
    "statuses",
    "please status",
    "",
  ])("rejects %j", text => {
    expect(parseCommand(text)).toMatchObject({ kind: "not-a-command" });
  });
});

describe("formatAnswer", () => {
  it("attributes the answer to its owner", () => {
    expect(formatAnswer("Operator", "use option 2")).toBe(
      "Operator's answer: use option 2"
    );
  });

  it("rejects an empty owner", () => {
    expect(() => formatAnswer("", "x")).toThrow(/owner/);
  });
});

describe("untrusted text", () => {
  it.each(["$(rm -rf /)", "`id`", "${process.exit(1)}", "'; DROP TABLE x; --"])(
    "returns %j verbatim as data",
    payload => {
      expect(
        routeInbound({ text: `TEAM-1: ${payload}`, ledger: TWO_PENDING })
      ).toEqual({
        kind: "answer",
        ref: "TEAM-1",
        body: payload,
      });
      expect(formatAnswer("Operator", payload)).toBe(
        `Operator's answer: ${payload}`
      );
    }
  );
});
