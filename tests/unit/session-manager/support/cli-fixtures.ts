/**
 * Fixtures and read-backs for the session-manager CLI tests: `claude agents
 * --json` rows in the two shapes Claude Code 2.1.296 prints (an active row
 * with `pid` and `status`; a finished `--all` row with `id` and `state` of
 * done or stopped), plus helpers that read back what a run left behind.
 * @module tests/unit/session-manager/support/cli-fixtures
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** The stub's `claude --bg` prints short id 1a2b3c4d; this is its full id. */
export const STUB_FULL_SESSION_ID = "1a2b3c4d-0000-4000-8000-000000000001";

const TRANSCRIPTS = path.resolve(
  import.meta.dirname,
  "../../../fixtures/session-manager/transcripts"
);

/**
 * Plant a transcript fixture where Claude Code files the stub session started
 * in `cwd`, under `configDir` (default: the sandbox HOME's `.claude`).
 * @param sandbox - Project sandbox
 * @param name - Fixture basename (healthy, unknown-command, prompt-blocked)
 * @param options - cwd and config dir overrides
 * @param options.cwd - Session cwd
 * @param options.configDir - Claude config dir
 */
export function plantTranscript(
  sandbox: Sandbox,
  name: string,
  {
    cwd = sandbox.root,
    configDir = path.join(sandbox.home, ".claude"),
  }: { cwd?: string; configDir?: string } = {}
): void {
  const dir = path.join(
    configDir,
    "projects",
    cwd.replace(/[^A-Za-z0-9]/g, "-")
  );
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${STUB_FULL_SESSION_ID}.jsonl`),
    readFileSync(path.join(TRANSCRIPTS, `${name}.jsonl`))
  );
}
