/**
 * Fixtures and read-backs for the session-manager CLI tests: `claude agents
 * --json` rows in the two shapes Claude Code 2.1.296 prints (an active row
 * with `pid` and `status`; a finished `--all` row with `id` and `state` of
 * done or stopped), plus helpers that read back what a run left behind.
 * @module tests/unit/session-manager/support/cli-fixtures
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Sandbox, StubCall } from "./cli-harness.js";

/**
 * An active `claude agents --json` row.
 * @param name - Session name
 * @param cwd - Session cwd
 * @returns Row
 */
export function activeAgent(name: string, cwd = "/work") {
  return {
    pid: 4242,
    cwd,
    kind: "bg",
    startedAt: 1_760_000_000_000,
    sessionId: "00000000-0000-4000-8000-000000000001",
    name,
    status: "busy",
  };
}

/**
 * A completed `claude agents --json --all` row.
 * @param name - Session name
 * @returns Row
 */
export function finishedAgent(name: string) {
  return {
    id: "9f9f9f9f",
    cwd: "/work",
    kind: "bg",
    name,
    sessionId: "00000000-0000-4000-8000-000000000002",
    startedAt: 1_760_000_000_000,
    state: "done",
  };
}

/**
 * The stub calls for one binary whose first argument matches.
 * @param calls - Recorded calls
 * @param bin - Stub name
 * @param first - Expected first argument
 * @returns Matching calls
 */
export function callsOf(
  calls: readonly StubCall[],
  bin: string,
  first: string
): StubCall[] {
  return calls.filter(call => call.bin === bin && call.argv[0] === first);
}

/**
 * Read the ledger the CLI wrote.
 * @param sandbox - Project sandbox
 * @returns Parsed ledger
 */
export function readLedgerFile(
  sandbox: Sandbox
): ReturnType<typeof JSON.parse> {
  return JSON.parse(
    readFileSync(
      path.join(sandbox.root, ".lisa/session-manager/ledger.json"),
      "utf8"
    )
  );
}
