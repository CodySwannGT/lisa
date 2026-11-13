/**
 * Edges of the per-repo setup gap (lisa#4820): `classify` records a gap it
 * finds without moving an existing one's `at` or undoing an operator's
 * clear; a ledger that cannot be written still yields spawn's setup message;
 * and a mixed-case repo key matches its lowercased `repo:` label.
 * @module tests/unit/session-manager/cli-setup-gap-edges
 */
import { chmodSync, mkdirSync } from "node:fs";
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
  plantTranscript,
  readLedgerFile,
} from "./support/cli-fixtures.js";
import { linearNode, offered, queue } from "./support/setup-gap-queue.js";

afterEach(removeSandboxes);

const MEM = ["--meminfo", MEMINFO];
const REF = "DEMO-12";
const WORKER = "wk-DEMO-12-1023-1417";
const UNKNOWN = "unknown-command";
const IMPLEMENT = "/lisa:implement";
const OLD_AT = "2026-01-01T00:00:00.000Z";

/**
 * Seed a ledger with one running item (started now) and optional control.
 * @param sandbox - Project sandbox
 * @param control - Control block to write, if any
 */
function seedRunning(sandbox: Sandbox, control?: object): void {
  const dir = path.join(sandbox.root, ".lisa/session-manager");
  const at = new Date().toISOString();
  mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "ledger.json"), {
    version: 1,
    items: {
      [REF]: {
        repo: ".",
        worker: WORKER,
        sessionId: "1a2b3c4d",
        status: "running",
        startedAt: at,
        lastProgressAt: at,
        logsHash: null,
        pendingQuestion: null,
        attempts: 1,
        history: [],
      },
    },
    ...(control ? { control } : {}),
  });
}

/**
 * Classify the seeded item against an idle agent row.
 * @param sandbox - Project sandbox
 * @returns The CLI result
 */
const classify = (sandbox: Sandbox) =>
  runCli(sandbox, ["classify", REF], {
    agents: [{ ...activeAgent(WORKER), status: "idle", state: "blocked" }],
  });

describe("classify and a recorded setup gap", () => {
  it("records the running worker's repo gap so the next queue skips it", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox);
    plantTranscript(sandbox, UNKNOWN);
    expect(classify(sandbox).json[0].classification).toBe("setup-gap");
    expect(readLedgerFile(sandbox).control.setupGaps["."]).toMatchObject({
      kind: UNKNOWN,
      detail: IMPLEMENT,
    });
    expect(offered(queue(sandbox, [linearNode("DEMO-13", null)]))).toEqual([]);
  });

  it("leaves an existing gap's at unchanged", () => {
    const sandbox = makeSandbox();
    const gap = { kind: UNKNOWN, detail: IMPLEMENT, at: OLD_AT };
    seedRunning(sandbox, { setupGaps: { ".": gap } });
    plantTranscript(sandbox, UNKNOWN);
    classify(sandbox);
    classify(sandbox);
    expect(readLedgerFile(sandbox).control.setupGaps["."]).toEqual(gap);
  });

  it("never re-records a gap the operator cleared from a worker that started before the clear", () => {
    const sandbox = makeSandbox();
    seedRunning(sandbox);
    plantTranscript(sandbox, UNKNOWN);
    classify(sandbox);
    const cleared = runCli(sandbox, ["ledger", "clear-setup-gap", "."]);
    expect(cleared.json).toEqual({ repo: ".", cleared: true });
    expect(classify(sandbox).json[0].classification).toBe("setup-gap");
    const { control } = readLedgerFile(sandbox);
    expect(control.setupGaps).toEqual({});
    expect(control.setupGapsClearedAt["."]).toEqual(expect.any(String));
    expect(offered(queue(sandbox, [linearNode("DEMO-13", null)]))).toEqual([
      "DEMO-13",
    ]);
  });
});

describe("spawn when the gap cannot be recorded", () => {
  const isRoot = process.getuid?.() === 0;

  it.skipIf(isRoot)(
    "warns and still exits 2 with the setup message, status not-recorded",
    () => {
      const sandbox = makeSandbox();
      const lisaDir = path.join(sandbox.root, ".lisa");
      mkdirSync(lisaDir);
      plantTranscript(sandbox, UNKNOWN);
      chmodSync(lisaDir, 0o555);
      try {
        const result = runCli(sandbox, ["spawn", REF, ...MEM]);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain(IMPLEMENT);
        expect(result.stderr).toMatch(/could not record the setup gap/i);
        expect(result.json).toMatchObject({
          repo: ".",
          setupGapStatus: "not-recorded",
        });
      } finally {
        chmodSync(lisaDir, 0o755);
      }
    }
  );
});

describe("a mixed-case repo key", () => {
  it("matches its lowercased repo: label in queue", () => {
    const sandbox = makeSandbox({ repos: ["API", "web"] });
    plantTranscript(sandbox, UNKNOWN, {
      cwd: path.join(sandbox.root, "projects/API"),
    });
    const spawned = runCli(sandbox, [
      "spawn",
      "API-1",
      "--repo",
      "API",
      ...MEM,
    ]);
    expect(spawned.status).toBe(2);
    const json = queue(sandbox, [
      linearNode("API-1", "api"),
      linearNode("WEB-1", "web"),
    ]);
    expect(offered(json)).toEqual(["WEB-1"]);
    expect(json.excluded).toContainEqual({
      ref: "API-1",
      reason: "setup-gap:API",
    });
  });
});
