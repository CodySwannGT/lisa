/**
 * `classifyWorker`'s `blocked-on-prompt` class (lisa#4522): a worker whose
 * `claude agents --json` row reports `waitingFor` (e.g. "permission prompt")
 * can never proceed, because nobody is attached to answer. It used to read
 * `working` until the no-output stall timer, since its log hash kept moving.
 * A parent waiting on its own subagent is normal work and stays `working`.
 * Resume must also carry the same permission flags as spawn, or a resumed
 * worker may fall back to default permissions and prompt on its next call.
 * @module tests/unit/session-manager/workers-blocked-on-prompt
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALL,
  WORKER_PERMISSION_ARGS,
  WORKER_SETTINGS,
  buildWorkerResume,
  buildWorkerSpawn,
  classifyWorker,
  isBlockingWait,
  normalizeAgents,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";

const WORKER = "wk-DEMO-12-1024-1707";
const PERMISSION_PROMPT = "permission prompt";
const NOW = new Date("2026-10-24T17:22:00Z");
const startedAt = new Date(NOW.getTime() - 15 * 60_000).toISOString();
const [blocked] = normalizeAgents([
  {
    pid: 7,
    name: WORKER,
    status: "waiting",
    state: "blocked",
    waitingFor: PERMISSION_PROMPT,
  },
]);
const [onSubagent] = normalizeAgents([
  {
    pid: 7,
    name: WORKER,
    status: "waiting",
    state: "blocked",
    waitingFor: "subagent",
  },
]);
const [stopped] = normalizeAgents([
  {
    id: "1a2b3c4d",
    name: WORKER,
    state: "stopped",
    waitingFor: PERMISSION_PROMPT,
  },
]);
const entry = {
  status: "running",
  startedAt,
  lastProgressAt: startedAt,
  logsHash: "h1",
  pendingQuestion: null,
  attempts: 1,
};

/**
 * Classify `entry` against `agent` with a changed log hash, the case that
 * used to read as progress.
 * @param agent - Normalized agent row
 * @param override - Ledger fields to change
 * @param extra - Extra classifier inputs
 * @returns Classification
 */
function classify(
  agent: ReturnType<typeof normalizeAgents>[number] | undefined,
  override: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) {
  return classifyWorker({
    agent: agent ?? null,
    entry: { ...entry, ...override },
    logsHash: "h2",
    now: NOW,
    ...extra,
  });
}

describe("normalizeAgents waitingFor", () => {
  it("keeps a string waitingFor and nulls anything else", () => {
    expect(blocked?.waitingFor).toBe(PERMISSION_PROMPT);
    const [row] = normalizeAgents([{ pid: 1, name: "x", waitingFor: 3 }]);
    expect(row?.waitingFor).toBeNull();
  });
});

describe("isBlockingWait", () => {
  it.each([
    [PERMISSION_PROMPT, true],
    ["user input", true],
    ["subagent", false],
    ["Sub-agent: lisa:linear-agent", false],
    ["waiting on SubAgent", false],
    ["", false],
    ["   ", false],
    [null, false],
    [undefined, false],
  ])("%j -> %s", (value, expected) => {
    expect(isBlockingWait(value)).toBe(expected);
  });
});

describe("classifyWorker blocked-on-prompt", () => {
  it("reports blocked-on-prompt even while the log hash changes", () => {
    expect(classify(blocked)).toBe("blocked-on-prompt");
  });

  it("keeps a parent waiting on its subagent working", () => {
    expect(classify(onSubagent)).toBe("working");
  });

  it("keeps an inactive row dead", () => {
    expect(classify(stopped)).toBe("dead");
  });

  it("becomes exhausted at maxAttempts", () => {
    expect(classify(blocked, { attempts: DEFAULT_STALL.maxAttempts })).toBe(
      "exhausted"
    );
  });

  it("lets a finish, a pending question and a setup gap win", () => {
    expect(classify(blocked, { status: "FAILED" })).toBe("finished");
    expect(classify(blocked, { pendingQuestion: { askedAt: startedAt } })).toBe(
      "waiting"
    );
    expect(
      classify(
        blocked,
        {},
        { firstPromptFailure: { kind: "prompt-blocked", detail: "no" } }
      )
    ).toBe("setup-gap");
  });
});

describe("worker permission flags", () => {
  const spawn = buildWorkerSpawn({
    ref: "DEMO-12",
    name: WORKER,
    manager: "lisa-sm",
    repoDir: "/work",
    env: {},
  });
  const resume = buildWorkerResume({
    sessionId: "00000000-0000-4000-8000-000000000001",
    text: "--answer: yes",
    repoDir: "/work",
    env: {},
  });

  it("is the bypass flag plus the worker settings", () => {
    expect(WORKER_PERMISSION_ARGS).toEqual([
      "--dangerously-skip-permissions",
      "--settings",
      WORKER_SETTINGS,
    ]);
  });

  it("is shared verbatim by spawn and resume", () => {
    const run = (args: string[]) => {
      const start = args.indexOf(WORKER_PERMISSION_ARGS[0] ?? "");
      return args.slice(start, start + WORKER_PERMISSION_ARGS.length);
    };
    expect(run(spawn.args)).toEqual(WORKER_PERMISSION_ARGS);
    expect(run(resume.args)).toEqual(run(spawn.args));
  });

  it("keeps the worker name at spawn args[2] and the message after --", () => {
    expect(spawn.args[2]).toBe(WORKER);
    expect(resume.args.slice(-2)).toEqual(["--", "--answer: yes"]);
  });
});
