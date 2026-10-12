/**
 * Integration tests for the session-manager CLI's worker commands: capacity,
 * spawn and resume, run as a real process against stub `claude`, `tmux` and
 * `vm_stat` executables.
 *
 * These pin the contract the manager skill branches on: exit 2 for a bad repo
 * or config, 3 for no capacity, 4 for a live worker; the exact `claude --bg`
 * argv; the worker's cwd; and that no `TELEGRAM_*` variable reaches a worker.
 * @module tests/unit/session-manager/cli
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGER,
  MEMINFO,
  makeSandbox,
  removeSandboxes,
  runCli,
} from "./support/cli-harness.js";
import {
  activeAgent,
  callsOf,
  finishedAgent,
  readLedgerFile,
} from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const REF = "DEMO-12";
const WORKER_NAME = /^wk-DEMO-12-\d{4}-\d{4}$/;
const WORKER_SETTINGS = '{"crossSessionInbound":"accept"}';
const MEM = ["--meminfo", MEMINFO];
const LIVE_WORKER = "wk-DEMO-12-1012-0900";
const TELEGRAM_KEYS = ["TELEGRAM_STATE_DIR", "TELEGRAM_BOT_TOKEN"];

describe("capacity", () => {
  it("prints every capacity key and counts only active wk- sessions", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["capacity", ...MEM], {
      agents: [
        activeAgent("wk-A-1-1012-0900"),
        activeAgent("wk-B-2-1012-0901"),
        finishedAgent("wk-C-3-1012-0902"),
        activeAgent("someone-else"),
      ],
    });
    expect(result.status).toBe(0);
    expect(Object.keys(result.json)).toEqual(
      expect.arrayContaining([
        "running",
        "cap",
        "free_slots",
        "avail_gb",
        "load1",
        "cores",
        "overloaded",
        "can_spawn",
      ])
    );
    expect(result.json.running).toBe(2);
    expect(result.json.avail_gb).toBe(20);
    expect(result.json.mem_source).toBe("/proc/meminfo");
    expect(callsOf(result.calls, "claude", "agents")[0]?.argv).toEqual([
      "agents",
      "--json",
    ]);
  });

  it("works with no sessionManager block, using the documented defaults", () => {
    const sandbox = makeSandbox({ sessionManager: null });
    const result = runCli(sandbox, ["capacity", ...MEM]);
    expect(result.status).toBe(0);
    expect(result.json.running).toBe(0);
    expect(typeof result.json.can_spawn).toBe("boolean");
  });

  it("honours --max-workers 0 with can_spawn false", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["capacity", ...MEM, "--max-workers", "0"]);
    expect(result.status).toBe(0);
    expect(result.json.cap).toBe(0);
    expect(result.json.can_spawn).toBe(false);
  });

  it.runIf(process.platform === "darwin")(
    "reads macOS memory from vm_stat on PATH",
    () => {
      const sandbox = makeSandbox();
      const result = runCli(sandbox, ["capacity"]);
      expect(result.status).toBe(0);
      expect(result.json.mem_source).toBe("vm_stat");
      expect(result.calls.some(call => call.bin === "vm_stat")).toBe(true);
    }
  );
});

describe("spawn", () => {
  it("starts one worker with the exact argv, the repo cwd and no TELEGRAM_* env", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["spawn", REF, ...MEM]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.json.name).toMatch(WORKER_NAME);
    expect(result.json.sessionId).toBe("1a2b3c4d");

    const [bg] = callsOf(result.calls, "claude", "--bg");
    expect(bg?.argv).toEqual([
      "--bg",
      "-n",
      result.json.name,
      "--dangerously-skip-permissions",
      "--settings",
      WORKER_SETTINGS,
      `/lisa:implement ${REF} managedBy=${MANAGER}`,
    ]);
    expect(bg?.cwd).toBe(sandbox.root);
    for (const key of TELEGRAM_KEYS) expect(bg?.envKeys).not.toContain(key);
    expect(bg?.envKeys).toContain("HOME");
  });

  it("records the spawn in the ledger and sessions.jsonl", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["spawn", REF, ...MEM]);
    const item = readLedgerFile(sandbox).items[REF];
    expect(item).toMatchObject({
      worker: result.json.name,
      sessionId: "1a2b3c4d",
      repo: ".",
      attempts: 1,
      status: "running",
    });
    const events = readFileSync(
      path.join(sandbox.root, ".lisa/session-manager/sessions.jsonl"),
      "utf8"
    );
    expect(events).toContain(`"worker":"${result.json.name}"`);
  });

  it("starts a multi-repo worker in the routed child repo", () => {
    const sandbox = makeSandbox({ repos: ["api", "web"] });
    const result = runCli(sandbox, ["spawn", REF, "--repo", "api", ...MEM]);
    expect(result.status).toBe(0);
    const [bg] = callsOf(result.calls, "claude", "--bg");
    expect(bg?.cwd).toBe(path.join(sandbox.root, "projects/api"));
    expect(readLedgerFile(sandbox).items[REF].repo).toBe("api");
  });

  it("names a retry differently from a known worker name", () => {
    const sandbox = makeSandbox();
    const first = runCli(sandbox, ["spawn", REF, ...MEM]);
    const second = runCli(sandbox, ["spawn", REF, ...MEM], {
      agents: [finishedAgent(first.json.name)],
    });
    expect(second.status).toBe(0);
    expect(second.json.name).not.toBe(first.json.name);
    expect(readLedgerFile(sandbox).items[REF].attempts).toBe(2);
  });

  describe("exit 2: bad repo or config", () => {
    it("refuses a repo dir with no .lisa.config.json", () => {
      const sandbox = makeSandbox({ repos: ["api"], bareRepos: ["web"] });
      const result = runCli(sandbox, ["spawn", REF, "--repo", "web", ...MEM]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(".lisa.config.json");
      expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
    });

    it("refuses an unknown repo key", () => {
      const sandbox = makeSandbox({ repos: ["api"] });
      const result = runCli(sandbox, ["spawn", REF, "--repo", "nope", ...MEM]);
      expect(result.status).toBe(2);
      expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
    });

    it("refuses a project with no sessionManager block", () => {
      const sandbox = makeSandbox({ sessionManager: null });
      const result = runCli(sandbox, ["spawn", REF, ...MEM]);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("sessionManager");
    });

    it("refuses an invalid sessionManager block", () => {
      const sandbox = makeSandbox({
        sessionManager: { name: "Bad Name", notify: { provider: "telegram" } },
      });
      const result = runCli(sandbox, ["spawn", REF, ...MEM]);
      expect(result.status).toBe(2);
      expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
    });

    it("refuses a missing ref", () => {
      const sandbox = makeSandbox();
      expect(runCli(sandbox, ["spawn", ...MEM]).status).toBe(2);
    });
  });

  it("exits 3 with the capacity report when there is no capacity", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, [
      "spawn",
      REF,
      ...MEM,
      "--max-workers",
      "0",
    ]);
    expect(result.status).toBe(3);
    expect(result.json.can_spawn).toBe(false);
    expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
  });

  it("exits 4 when a live worker already holds the ref", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["spawn", REF, ...MEM], {
      agents: [activeAgent(LIVE_WORKER)],
    });
    expect(result.status).toBe(4);
    expect(result.json.worker).toBe(LIVE_WORKER);
    expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
  });

  it("does not treat a worker for a longer ref as live (exact token)", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["spawn", "DEMO-1", ...MEM], {
      agents: [activeAgent(LIVE_WORKER)],
    });
    expect(result.status).toBe(0);
  });

  it("exits 1 and records nothing when claude --bg fails", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["spawn", REF, ...MEM], {
      env: { STUB_BG_EXIT: "1" },
    });
    expect(result.status).toBe(1);
    expect(() => readLedgerFile(sandbox)).toThrow();
  });
});

describe("resume", () => {
  const ANSWER = "Option 2, please: $(touch pwned) `id` 'quoted' \"double\"";

  it("passes stdin text as one argv element in the worker's repo, env scrubbed", () => {
    const sandbox = makeSandbox({ repos: ["api"] });
    runCli(sandbox, ["spawn", REF, "--repo", "api", ...MEM]);
    const result = runCli(sandbox, ["resume", REF], { input: ANSWER });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const [bg] = callsOf(result.calls, "claude", "--bg");
    expect(bg?.argv).toEqual(["--bg", "--resume", "1a2b3c4d", "--", ANSWER]);
    expect(bg?.cwd).toBe(path.join(sandbox.root, "projects/api"));
    for (const key of TELEGRAM_KEYS) expect(bg?.envKeys).not.toContain(key);
    expect(result.json).toMatchObject({ ref: REF, sessionId: "1a2b3c4d" });
  });

  it("exits 2 on empty stdin", () => {
    const sandbox = makeSandbox();
    runCli(sandbox, ["spawn", REF, ...MEM]);
    const result = runCli(sandbox, ["resume", REF], { input: "  \n" });
    expect(result.status).toBe(2);
    expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
  });

  it("exits 2 for a ref the ledger has no session for", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["resume", "OTHER-1"], { input: "yes" });
    expect(result.status).toBe(2);
  });
});
