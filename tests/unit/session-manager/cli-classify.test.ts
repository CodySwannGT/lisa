/**
 * Integration test for `classify` on a ledger item that has no worker yet.
 *
 * A placeholder item (asked about, never dispatched) carries `worker: null`,
 * and `claude agents --json` can list sessions with no name. Comparing the two
 * by `===` once paired them, so an unrelated unnamed session was read as the
 * item's worker and its logs hashed as the item's progress.
 * @module tests/unit/session-manager/cli-classify
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
} from "./support/cli-harness.js";
import {
  activeAgent,
  callsOf,
  readLedgerFile,
} from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

describe("classify with a worker-less ledger item", () => {
  it("matches no agent and skips the logs hash", () => {
    const sandbox = makeSandbox();
    const dir = path.join(sandbox.root, ".lisa/session-manager");
    mkdirSync(dir, { recursive: true });
    writeJson(path.join(dir, "ledger.json"), {
      version: 1,
      items: {
        "DEMO-9": {
          repo: null,
          worker: null,
          sessionId: null,
          status: "question",
          startedAt: null,
          lastProgressAt: null,
          logsHash: null,
          pendingQuestion: null,
          attempts: 0,
          history: [],
        },
      },
    });
    const result = runCli(sandbox, ["classify", "DEMO-9"], {
      agents: [{ ...activeAgent("unused"), name: null }],
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.json).toEqual([
      expect.objectContaining({
        ref: "DEMO-9",
        worker: null,
        agentStatus: null,
      }),
    ]);
    expect(callsOf(result.calls, "claude", "logs")).toEqual([]);
    expect(readLedgerFile(sandbox).items["DEMO-9"].logsHash).toBeNull();
  });
});
