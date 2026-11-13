/**
 * `spawn` and `classify` for a worker in a repository checked out so deep
 * that Claude Code truncates its project-directory name (lisa#4821).
 *
 * The first-prompt failure #4503 detects must be reported whatever the
 * checkout depth: `spawn` exits 2 with the setup-gap message and `classify`
 * says `setup-gap`. Two matching truncated directories are ambiguous, so
 * `spawn` proceeds exactly as with no transcript.
 * @module tests/unit/session-manager/cli-first-prompt-long-path
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { activeAgent, readLedgerFile } from "./support/cli-fixtures.js";
import {
  PROJECT_DIR_LIMIT,
  claudeProjectDirName,
} from "./support/claude-project-dir.js";

afterEach(removeSandboxes);

const REF = "DEMO-12";
const IMPLEMENT = "/lisa:implement";
const WORKER = "wk-DEMO-12-1023-1417";
/** The stub's `claude --bg` prints short id 1a2b3c4d; this is its full id. */
const FULL_ID = "1a2b3c4d-0000-4000-8000-000000000001";
/** A child repo key long enough that its checkout path exceeds the limit. */
const LONG_REPO = `deep-${"r".repeat(200)}`;
const SPAWN = ["spawn", REF, "--meminfo", MEMINFO, "--repo", LONG_REPO];
const FIXTURES = path.resolve(
  import.meta.dirname,
  "../../fixtures/session-manager/transcripts"
);

/**
 * The long child repo's checkout dir in a sandbox.
 * @param sandbox - Project sandbox
 * @returns Absolute path
 */
function repoDir(sandbox: Sandbox): string {
  return path.join(sandbox.root, "projects", LONG_REPO);
}

/**
 * Plant the unknown-command transcript under a project directory name.
 * @param sandbox - Project sandbox
 * @param dirName - Directory name under `<HOME>/.claude/projects/`
 */
function plantIn(sandbox: Sandbox, dirName: string): void {
  const dir = path.join(sandbox.home, ".claude/projects", dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${FULL_ID}.jsonl`),
    readFileSync(path.join(FIXTURES, "unknown-command.jsonl"))
  );
}

/**
 * A sandbox with the long child repo and its transcript planted where Claude
 * Code 2.1.319 files it.
 * @returns Sandbox
 */
function longSandbox(): Sandbox {
  const sandbox = makeSandbox({ repos: [LONG_REPO] });
  const name = claudeProjectDirName(repoDir(sandbox));
  expect(name.length).toBeGreaterThan(PROJECT_DIR_LIMIT);
  plantIn(sandbox, name);
  return sandbox;
}

describe("first-prompt failure in a deep checkout", () => {
  it("spawn exits 2 with the setup-gap message", () => {
    const sandbox = longSandbox();
    const result = runCli(sandbox, SPAWN);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(IMPLEMENT);
    expect(result.stderr).toContain(repoDir(sandbox));
    expect(result.stderr).toMatch(/no attempt was counted/i);
    const ledger = readLedgerFile(sandbox);
    expect(ledger.items).toEqual({});
    expect(Object.values(ledger.control.setupGaps)).toEqual([
      expect.objectContaining({
        kind: "unknown-command",
        detail: IMPLEMENT,
      }),
    ]);
  });

  it("classify reports setup-gap", () => {
    const sandbox = longSandbox();
    const at = new Date().toISOString();
    const stateDir = path.join(sandbox.root, ".lisa/session-manager");
    mkdirSync(stateDir, { recursive: true });
    writeJson(path.join(stateDir, "ledger.json"), {
      version: 1,
      items: {
        [REF]: {
          repo: LONG_REPO,
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
    });
    const result = runCli(sandbox, ["classify", REF], {
      agents: [{ ...activeAgent(WORKER), status: "idle", state: "blocked" }],
    });
    expect(result.status).toBe(0);
    expect(result.json).toEqual([
      expect.objectContaining({
        ref: REF,
        classification: "setup-gap",
        setupGap: { kind: "unknown-command", detail: IMPLEMENT },
      }),
    ]);
  });

  it("spawn proceeds unconfirmed when two truncated directories match", () => {
    const sandbox = longSandbox();
    const prefix = claudeProjectDirName(repoDir(sandbox)).slice(
      0,
      PROJECT_DIR_LIMIT
    );
    plantIn(sandbox, `${prefix}-zzzzzz`);
    const result = runCli(sandbox, SPAWN);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ ref: REF, firstPrompt: "unconfirmed" });
    expect(readLedgerFile(sandbox).items[REF].attempts).toBe(1);
  });
});
