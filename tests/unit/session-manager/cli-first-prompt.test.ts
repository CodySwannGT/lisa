/**
 * `spawn` proof of life and `classify` on a worker whose first prompt never
 * ran (lisa#4503).
 *
 * A worker whose transcript ends in `Unknown command: /lisa:implement`, or in
 * a `UserPromptSubmit` hook refusal, with no assistant turn, never started:
 * the machine has a setup gap, and retrying the item cannot fix it. `spawn`
 * once exited 0 and counted an attempt, and `classify` said `working` for an
 * hour. Now `spawn` stops that worker, records no item (only the repo's setup
 * gap, lisa#4820) and exits 2 (setup),
 * and `classify` reports `setup-gap`. A healthy or missing transcript keeps
 * today's behaviour.
 * @module tests/unit/session-manager/cli-first-prompt
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMINFO,
  type Sandbox,
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
} from "./support/cli-harness.js";
import {
  activeAgent,
  callsOf,
  plantTranscript as plant,
  readLedgerFile,
} from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const MEM = ["--meminfo", MEMINFO];
const REF = "DEMO-12";
const SPAWN = ["spawn", REF, ...MEM];
const WORKER = "wk-DEMO-12-1023-1417";
const UNKNOWN = "unknown-command";
const FINISH_FAILED = ["ledger", "finish", REF, "--status", "FAILED"];
const SETUP_GAP = "--setup-gap";
const IMPLEMENT = "/lisa:implement";
const PROMPT_BLOCKED = "prompt-blocked";

describe("spawn proof of life", () => {
  it("exits 2 when the worker's first prompt was an unknown command, recording only the repo's setup gap", () => {
    const sandbox = makeSandbox();
    plant(sandbox, UNKNOWN);
    const result = runCli(sandbox, SPAWN);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(IMPLEMENT);
    expect(result.stderr).toContain(sandbox.root);
    expect(result.stderr).toMatch(/plugin/i);
    expect(result.stderr).toMatch(/no attempt was counted/i);
    const ledger = readLedgerFile(sandbox);
    expect(ledger.items).toEqual({});
    expect(ledger.control.setupGaps["."]).toMatchObject({
      kind: UNKNOWN,
      detail: IMPLEMENT,
    });
    const stops = callsOf(result.calls, "claude", "stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]?.argv[1]).toMatch(/^wk-DEMO-12-/);
  });

  it("exits 2 when a UserPromptSubmit hook rejected the first prompt, recording only the repo's setup gap", () => {
    const sandbox = makeSandbox();
    plant(sandbox, PROMPT_BLOCKED);
    const result = runCli(sandbox, SPAWN);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/UserPromptSubmit hook/);
    expect(result.stderr).toContain(
      "Secret scanning is inactive: not authenticated."
    );
    const ledger = readLedgerFile(sandbox);
    expect(ledger.items).toEqual({});
    expect(ledger.control.setupGaps["."]).toMatchObject({
      kind: PROMPT_BLOCKED,
    });
    expect(callsOf(result.calls, "claude", "stop")).toHaveLength(1);
  });

  it("reads the transcript in the routed child repo and under CLAUDE_CONFIG_DIR", () => {
    const sandbox = makeSandbox({ repos: ["api"] });
    const cwd = path.join(sandbox.root, "projects/api");
    const configDir = path.join(sandbox.home, "alt-claude");
    plant(sandbox, UNKNOWN, { cwd, configDir });
    const result = runCli(sandbox, [...SPAWN, "--repo", "api"], {
      env: { CLAUDE_CONFIG_DIR: configDir },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(cwd);
  });

  it("exits 0 and records the spawn when the worker answered", () => {
    const sandbox = makeSandbox();
    plant(sandbox, "healthy");
    const result = runCli(sandbox, SPAWN);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ ref: REF, firstPrompt: "alive" });
    expect(readLedgerFile(sandbox).items[REF].attempts).toBe(1);
    expect(callsOf(result.calls, "claude", "stop")).toEqual([]);
  });

  it("leaves a re-dispatched item's earlier attempts and worker untouched when its first prompt fails", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER, 1);
    runCli(sandbox, FINISH_FAILED, {
      input: "first attempt failed",
    });
    plant(sandbox, UNKNOWN);
    const result = runCli(sandbox, SPAWN);
    expect(result.status).toBe(2);
    const item = readLedgerFile(sandbox).items[REF];
    expect(item).toMatchObject({
      status: "FAILED",
      attempts: 1,
      worker: WORKER,
    });
    expect(
      item.history.filter((h: { event: string }) => h.event === "spawn")
    ).toEqual([]);
  });

  it("exits 0 as before when no transcript appears within the window", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, SPAWN, {
      env: { LISA_SESSION_MANAGER_FIRST_PROMPT_MS: "300" },
    });
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ ref: REF, firstPrompt: "unconfirmed" });
    expect(readLedgerFile(sandbox).items[REF].attempts).toBe(1);
    expect(callsOf(result.calls, "claude", "stop")).toEqual([]);
  });
});

/**
 * Seed a ledger with one running item whose worker is `worker`.
 * @param sandbox - Project sandbox
 * @param worker - Worker name
 * @param attempts - Attempts so far
 */
function seedRunning(sandbox: Sandbox, worker: string, attempts = 1): void {
  const dir = path.join(sandbox.root, ".lisa/session-manager");
  const at = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "ledger.json"), {
    version: 1,
    items: {
      [REF]: {
        repo: ".",
        worker,
        sessionId: "1a2b3c4d",
        status: "running",
        startedAt: at,
        lastProgressAt: at,
        logsHash: null,
        pendingQuestion: null,
        attempts,
        history: [],
      },
    },
  });
}

describe("classify a worker whose first prompt failed", () => {
  it.each([
    [UNKNOWN, IMPLEMENT],
    [PROMPT_BLOCKED, "Secret scanning is inactive: not authenticated."],
  ])("reports setup-gap for %s", (name, detail) => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER);
    plant(sandbox, name);
    const result = runCli(sandbox, ["classify", REF], {
      agents: [{ ...activeAgent(WORKER), status: "idle", state: "blocked" }],
    });
    expect(result.status).toBe(0);
    expect(result.json).toEqual([
      expect.objectContaining({
        ref: REF,
        classification: "setup-gap",
        setupGap: { kind: name, detail },
      }),
    ]);
  });

  it("never turns a setup gap into exhausted", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER, 3);
    plant(sandbox, UNKNOWN);
    const result = runCli(sandbox, ["classify", REF], {
      agents: [{ ...activeAgent(WORKER), status: "idle", state: "blocked" }],
    });
    expect(result.json[0].classification).toBe("setup-gap");
  });

  it("keeps a healthy worker working", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER);
    plant(sandbox, "healthy");
    const result = runCli(sandbox, ["classify", REF], {
      agents: [activeAgent(WORKER)],
    });
    expect(result.json[0]).toMatchObject({
      classification: "working",
      setupGap: null,
    });
  });
});

describe("ledger finish --setup-gap", () => {
  it("does not count the spawn that hit a setup gap as an attempt", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER, 2);
    const result = runCli(sandbox, [...FINISH_FAILED, SETUP_GAP], {
      input: "setup gap: /lisa:implement unknown in the repo",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const item = readLedgerFile(sandbox).items[REF];
    expect(item.status).toBe("FAILED");
    expect(item.attempts).toBe(1);
    expect(item.history.at(-1)).toMatchObject({
      event: "finish",
      setupGap: true,
    });
  });

  it("refuses --setup-gap with DONE", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER, 2);
    const result = runCli(
      sandbox,
      ["ledger", "finish", REF, "--status", "DONE", SETUP_GAP],
      { input: "x" }
    );
    expect(result.status).toBe(2);
    expect(readLedgerFile(sandbox).items[REF].attempts).toBe(2);
  });

  it("refunds only a running item's attempt, so repeating it changes nothing", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER, 2);
    const gap = [...FINISH_FAILED, SETUP_GAP];
    expect(runCli(sandbox, gap, { input: "gap" }).status).toBe(0);
    expect(runCli(sandbox, gap, { input: "gap again" }).status).toBe(0);
    expect(readLedgerFile(sandbox).items[REF].attempts).toBe(1);
  });

  it("does not refund an item that already finished", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox, WORKER, 2);
    expect(runCli(sandbox, FINISH_FAILED, { input: "stalled" }).status).toBe(0);
    const late = runCli(sandbox, [...FINISH_FAILED, SETUP_GAP], {
      input: "gap",
    });
    expect(late.status).toBe(0);
    expect(readLedgerFile(sandbox).items[REF].attempts).toBe(2);
  });
});

describe("spawn without a session id", () => {
  it("skips the first-prompt wait and reports unconfirmed at once", () => {
    const sandbox = makeSandbox();
    const started = Date.now();
    const result = runCli(sandbox, SPAWN, {
      env: {
        STUB_BG_OUTPUT: "Started a background session\n",
        LISA_SESSION_MANAGER_FIRST_PROMPT_MS: "20000",
      },
    });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      sessionId: null,
      firstPrompt: "unconfirmed",
    });
  });
});
