/**
 * Contract tests for the short labels an operator types on a phone.
 *
 * The Telegram channel plugin does not say which message a reply answers, so
 * with two questions open the operator's leading label is the only routing
 * signal. A GitHub ref `owner/repo#12` therefore also answers to `repo#12` and
 * `#12` — but only while that short form names exactly one ledger item, so a
 * `#12` shared by two repos is never resolved to either.
 * @module tests/unit/session-manager/telegram-route-short-forms
 */
import { describe, expect, it } from "vitest";

import { routeInbound } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/telegram-route.mjs";

/**
 * A ledger item waiting on a question.
 * @param worker - Worker session name
 * @param telegramMessageId - Message id of the question
 * @returns A ledger item
 */
const waiting = (worker: string, telegramMessageId: number) => ({
  worker,
  pendingQuestion: {
    text: "q",
    askedAt: "",
    lastPingAt: "",
    telegramMessageId,
  },
});

/** The first sandbox issue. */
const SANDBOX_1 = "owner/sandbox#1";

/** The second sandbox issue. */
const SANDBOX_2 = "owner/sandbox#2";

/** Two questions open in one repo. */
const ONE_REPO = {
  items: {
    [SANDBOX_1]: waiting("wk-sandbox-1-1012-1910", 6),
    [SANDBOX_2]: waiting("wk-sandbox-2-1012-1910", 7),
  },
};

/** The same issue number open in two repos. */
const TWO_REPOS = {
  items: {
    "owner/api#5": waiting("wk-api-5-1012-1910", 6),
    "owner/web#5": waiting("wk-web-5-1012-1910", 7),
  },
};

describe("routeInbound short labels", () => {
  it.each([
    ["#N", "#1 1", SANDBOX_1, "1"],
    [
      "bracketed #N",
      "[#2] stop and report FAILED",
      SANDBOX_2,
      "stop and report FAILED",
    ],
    ["repo#N", "sandbox#1 1", SANDBOX_1, "1"],
    ["full ref", "owner/sandbox#2 retry", SANDBOX_2, "retry"],
  ])("routes %s", (_label, text, ref, body) => {
    expect(routeInbound({ text, ledger: ONE_REPO })).toEqual({
      kind: "answer",
      ref,
      body,
    });
  });

  it("is ambiguous for a bare answer with two questions open", () => {
    expect(routeInbound({ text: "1", ledger: ONE_REPO })).toEqual({
      kind: "ambiguous",
      candidates: [SANDBOX_1, SANDBOX_2],
    });
  });

  it("never resolves a #N that two repos share", () => {
    expect(routeInbound({ text: "#5 yes", ledger: TWO_REPOS })).toEqual({
      kind: "ambiguous",
      candidates: ["owner/api#5", "owner/web#5"],
    });
  });

  it("resolves repo#N when #N is shared", () => {
    expect(routeInbound({ text: "web#5 yes", ledger: TWO_REPOS })).toEqual({
      kind: "answer",
      ref: "owner/web#5",
      body: "yes",
    });
  });

  it("does not let #1 match #12", () => {
    const ledger = {
      items: {
        "owner/sandbox#12": waiting("wk-sandbox-12-1012-1910", 6),
        [SANDBOX_2]: waiting("wk-sandbox-2-1012-1910", 7),
      },
    };
    expect(routeInbound({ text: "#1 yes", ledger })).toMatchObject({
      kind: "ambiguous",
    });
  });
});
