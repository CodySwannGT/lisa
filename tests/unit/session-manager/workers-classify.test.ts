/**
 * Stall-matrix tests for the session manager's worker classifier, plus the
 * session-id parser that feeds `resume`.
 *
 * A classifier that never says `exhausted` retries one broken item forever; one
 * that calls a worker `dead` while it waits on the operator retries work that
 * was only paused for an answer. Every classification has a row here.
 * @module tests/unit/session-manager/workers-classify
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALL,
  classifyWorker,
  normalizeAgents,
  parseSessionId,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";

import {
  ACTIVE_FIXTURE,
  ALL_FIXTURE,
  HOUR,
  LIVE_SESSION_ID,
  MINUTE,
  NOW,
} from "./workers-fixtures.js";

describe("parseSessionId", () => {
  it.each([
    ["Started 11111111-1111-4111-8111-111111111111\n", LIVE_SESSION_ID],
    ["Background session beee57d9 started\n", "beee57d9"],
    ["nothing useful", null],
    ["", null],
  ])("parses %j", (stdout, expected) => {
    expect(parseSessionId(stdout)).toBe(expected);
  });
});

/**
 * One normalized row of a fixture, failing loudly when the fixture lacks it.
 * @param fixture - Parsed `claude agents` output
 * @param index - Row to take
 * @returns The normalized row
 */
function rowOf(fixture: unknown, index: number) {
  const row = normalizeAgents(fixture)[index];
  if (!row) throw new Error(`fixture has no agent row ${index}`);
  return row;
}

describe("classifyWorker", () => {
  const active = rowOf(ACTIVE_FIXTURE, 0);
  const done = rowOf(ALL_FIXTURE, 2);
  const startedAt = new Date(NOW.getTime() - 3 * HOUR).toISOString();
  const base = {
    status: "running",
    startedAt,
    lastProgressAt: startedAt,
    logsHash: "h1",
    pendingQuestion: null,
    attempts: 1,
  };
  const stall = { noOutputMinutes: 60, requestionHours: 4, maxAttempts: 3 };

  it.each([
    [
      "finished on DONE",
      { agent: done, entry: { ...base, status: "DONE" } },
      "finished",
    ],
    [
      "finished on FAILED",
      { agent: active, entry: { ...base, status: "FAILED" } },
      "finished",
    ],
    [
      "waiting with a fresh question",
      {
        agent: done,
        entry: {
          ...base,
          pendingQuestion: {
            text: "q",
            askedAt: startedAt,
            lastPingAt: new Date(NOW.getTime() - HOUR).toISOString(),
            telegramMessageId: 7,
          },
        },
      },
      "waiting",
    ],
    [
      "requestion when the last ping is older than requestionHours",
      {
        agent: active,
        entry: {
          ...base,
          pendingQuestion: {
            text: "q",
            askedAt: startedAt,
            lastPingAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
            telegramMessageId: 7,
          },
        },
      },
      "requestion",
    ],
    [
      "requestion falls back to askedAt when never pinged",
      {
        agent: active,
        entry: {
          ...base,
          pendingQuestion: {
            text: "q",
            askedAt: new Date(NOW.getTime() - 5 * HOUR).toISOString(),
            lastPingAt: null,
            telegramMessageId: 7,
          },
        },
      },
      "requestion",
    ],
    [
      "working when the logs hash changed",
      { agent: active, entry: base, logsHash: "h2" },
      "working",
    ],
    [
      "working within noOutputMinutes",
      {
        agent: active,
        entry: {
          ...base,
          lastProgressAt: new Date(NOW.getTime() - 30 * MINUTE).toISOString(),
        },
        logsHash: "h1",
      },
      "working",
    ],
    [
      "stalled past noOutputMinutes with an unchanged hash",
      { agent: active, entry: base, logsHash: "h1" },
      "stalled",
    ],
    [
      "stalled when the hash is unknown and progress is old",
      { agent: active, entry: base, logsHash: null },
      "stalled",
    ],
    ["dead when absent", { agent: null, entry: base }, "dead"],
    [
      "dead when the row is done without DONE",
      { agent: done, entry: base },
      "dead",
    ],
    [
      "exhausted when stalled at maxAttempts",
      { agent: active, entry: { ...base, attempts: 3 }, logsHash: "h1" },
      "exhausted",
    ],
    [
      "exhausted when dead at maxAttempts",
      { agent: null, entry: { ...base, attempts: 4 } },
      "exhausted",
    ],
    [
      "working is never exhausted",
      { agent: active, entry: { ...base, attempts: 3 }, logsHash: "h2" },
      "working",
    ],
  ])("%s", (_label, input, expected) => {
    expect(
      classifyWorker({ logsHash: undefined, now: NOW, stall, ...input })
    ).toBe(expected);
  });

  it("uses the default stall policy when none is passed", () => {
    expect(DEFAULT_STALL).toEqual({
      noOutputMinutes: 60,
      requestionHours: 4,
      maxAttempts: 3,
    });
    expect(
      classifyWorker({ agent: active, entry: base, logsHash: "h1", now: NOW })
    ).toBe("stalled");
  });
});
