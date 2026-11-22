/**
 * `classifyWorker`'s `setup-gap` class (lisa#4503): a worker whose first
 * prompt never ran is a machine setup gap, not a stall, so it is reported as
 * soon as the transcript shows it — never `working` until the stall timer,
 * and never `exhausted`, since the attempts it would exhaust were not the
 * item's fault.
 * @module tests/unit/session-manager/workers-setup-gap
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALL,
  classifyWorker,
  normalizeAgents,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";

const NOW = new Date("2026-10-23T15:00:00Z");
const startedAt = new Date(NOW.getTime() - 5 * 60_000).toISOString();
const [active] = normalizeAgents([
  { pid: 1, name: "wk-DEMO-12-1023-1417", status: "idle", state: "blocked" },
]);
const [stopped] = normalizeAgents([
  { id: "1a2b3c4d", name: "wk-DEMO-12-1023-1417", state: "stopped" },
]);
const entry = {
  status: "running",
  startedAt,
  lastProgressAt: startedAt,
  logsHash: "h1",
  pendingQuestion: null,
  attempts: 1,
};
const failure = { kind: "unknown-command", detail: "/lisa:implement" };

describe("classifyWorker setup-gap", () => {
  it("reports setup-gap for an active worker inside the stall window", () => {
    expect(
      classifyWorker({
        agent: active ?? null,
        entry,
        logsHash: "h2",
        now: NOW,
        firstPromptFailure: failure,
      })
    ).toBe("setup-gap");
  });

  it("reports setup-gap rather than dead for a stopped worker", () => {
    expect(
      classifyWorker({
        agent: stopped ?? null,
        entry,
        now: NOW,
        firstPromptFailure: failure,
      })
    ).toBe("setup-gap");
  });

  it("never converts setup-gap to exhausted", () => {
    expect(
      classifyWorker({
        agent: active ?? null,
        entry: { ...entry, attempts: DEFAULT_STALL.maxAttempts },
        now: NOW,
        firstPromptFailure: failure,
      })
    ).toBe("setup-gap");
  });

  it("lets a recorded finish and a pending question win", () => {
    expect(
      classifyWorker({
        agent: active ?? null,
        entry: { ...entry, status: "DONE" },
        now: NOW,
        firstPromptFailure: failure,
      })
    ).toBe("finished");
    expect(
      classifyWorker({
        agent: active ?? null,
        entry: { ...entry, pendingQuestion: { askedAt: startedAt } },
        now: NOW,
        firstPromptFailure: failure,
      })
    ).toBe("waiting");
  });

  it("classifies as before with no failure", () => {
    expect(
      classifyWorker({
        agent: active ?? null,
        entry,
        logsHash: "h2",
        now: NOW,
        firstPromptFailure: null,
      })
    ).toBe("working");
  });
});
