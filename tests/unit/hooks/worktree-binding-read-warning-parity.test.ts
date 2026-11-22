/**
 * Every shipped copy of the worktree-binding guard warns on reads and refuses
 * writes the same way (CodySwannGT/lisa#4816), and the warning's reach per
 * agent is pinned rather than implied.
 *
 * The non-blocking warning travels on two channels. stderr reaches a
 * transcript; PreToolUse JSON `hookSpecificOutput.additionalContext` reaches
 * the model — but only Claude Code was measured reading that shape on
 * PreToolUse, so the guard prints it only where `CLAUDECODE` is set. On Codex
 * (through the repository dispatcher), Cursor and Copilot the read is allowed
 * with the warning on stderr only. That is a gap in the WARNING, never in the
 * BLOCK: every copy refuses the write identically.
 * @module tests/unit/hooks/worktree-binding-read-warning-parity
 */
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../support/git-executable.js";
import {
  ALLOWED,
  BLOCKED,
  buildFixture,
  type Fixture,
  SESSION,
  trackTempDir,
  WRITE_COMMAND,
} from "./support/worktree-binding.js";

const GUARD = "worktree-binding-guard";

/** The marker the read warning carries and no refusal does. */
const READ_WARNING = "allowed a READ-ONLY command";

/** The dispatcher a host project runs every guard through. */
const DISPATCHER = "lisa-enforcement-fallback.sh";

/** Every tree the build ships the guard into, by the agent it serves. */
const SHIPPED_COPIES = [
  ["Claude Code plugin", "plugins/lisa/hooks"],
  ["Cursor plugin", "plugins/lisa-cursor/hooks"],
  ["Copilot plugin", "plugins/lisa-copilot/hooks"],
  ["Devin plugin", "plugins/lisa-devin/hooks"],
  [
    "host tree (Codex and every dispatcher)",
    "all/copy-overwrite/scripts/lisa-hooks",
  ],
] as const;

/** Variables that name the runtime; stripped so each case chooses its own. */
const RUNTIME_KEYS = ["CLAUDECODE", "AI_AGENT", "CLAUDE_CODE_EXECPATH"];

/**
 * Environment for one run: the outer runtime removed, the case's put in.
 * @param state - Guard state home
 * @param runtime - Runtime variables this case sets
 * @returns Spawn environment
 */
function environment(
  state: string,
  runtime: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...cleanGitEnv(), LISA_STATE_HOME: state };
  for (const key of RUNTIME_KEYS) delete env[key];
  return { ...env, ...runtime };
}

/**
 * The hook envelope for one Bash call.
 * @param cwd - Directory the call runs in
 * @param command - The Bash command
 * @returns Serialized payload
 */
function envelope(cwd: string, command: string): string {
  return JSON.stringify({
    session_id: SESSION,
    cwd,
    tool_name: "Bash",
    tool_input: { command },
  });
}

/**
 * Run one copy of the guard's classifier directly.
 * @param dir - Tree holding the copy
 * @param fixture - Repository under test
 * @param cwd - Directory the call runs in
 * @param command - The Bash command
 * @returns The completed spawn
 */
function runCopy(dir: string, fixture: Fixture, cwd: string, command: string) {
  return boundedSpawnSync({
    label: GUARD,
    command: process.execPath,
    args: [path.resolve(dir, `${GUARD}.mjs`)],
    cwd,
    env: environment(fixture.state),
    input: envelope(cwd, command),
  });
}

describe("worktree-binding read warning across shipped copies", () => {
  it.each(SHIPPED_COPIES)(
    "the %s copy allows a read with a stderr warning and refuses a write",
    (_agent, dir) => {
      const fixture = buildFixture();
      expect(runCopy(dir, fixture, fixture.a, WRITE_COMMAND).status).toBe(
        ALLOWED
      );
      const read = runCopy(dir, fixture, fixture.b, "git status");
      expect(read.status).toBe(ALLOWED);
      expect(read.stderr).toContain(READ_WARNING);
      // Gap, pinned: without CLAUDECODE no context JSON is emitted, because no
      // other runtime was measured reading it on PreToolUse.
      expect(read.stdout).toBe("");
      const write = runCopy(dir, fixture, fixture.b, WRITE_COMMAND);
      expect(write.status).toBe(BLOCKED);
      expect(write.stderr).toContain("changed underneath it");
    }
  );

  it("ships no copy where the guard has nothing to reconcile", () => {
    // OpenCode and Antigravity manage their own worktrees; Codex receives the
    // guard only through the repository dispatcher's host tree above. Absence
    // is the documented parity statement in the wrapper, not an omission.
    expect(existsSync(`plugins/lisa-agy/hooks/${GUARD}.mjs`)).toBe(false);
    expect(existsSync(`src/codex/scripts/${GUARD}.mjs`)).toBe(false);
    expect(existsSync(`src/opencode/plugin-templates/${GUARD}.mjs`)).toBe(
      false
    );
  });
});

describe("worktree-binding read warning through the repository dispatcher", () => {
  /**
   * A host checkout as `lisa apply` leaves it: dispatcher plus host guards.
   * @returns Host root
   */
  function hostProject(): string {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-wtb-host-"));
    const scripts = path.join(root, "scripts");
    const dispatcher = path.join(scripts, DISPATCHER);
    trackTempDir(root);
    mkdirSync(scripts, { recursive: true });
    cpSync(
      "all/copy-overwrite/scripts/lisa-hooks",
      path.join(scripts, "lisa-hooks"),
      { recursive: true }
    );
    cpSync(`all/copy-overwrite/scripts/${DISPATCHER}`, dispatcher);
    chmodSync(dispatcher, 0o755);
    return root;
  }

  /**
   * Run the dispatcher the way Claude Code or Codex fires it.
   * @param host - Host checkout
   * @param fixture - Repository under test
   * @param cwd - Directory the call runs in
   * @param command - The Bash command
   * @param runtime - Runtime variables to set
   * @returns The completed spawn
   */
  function dispatch(
    host: string,
    fixture: Fixture,
    cwd: string,
    command: string,
    runtime: Readonly<Record<string, string>> = {}
  ) {
    return boundedSpawnSync({
      label: DISPATCHER,
      command: "/bin/bash",
      args: [path.join(host, "scripts", DISPATCHER)],
      cwd,
      env: {
        ...environment(fixture.state, runtime),
        CLAUDE_PROJECT_DIR: host,
        CLAUDE_CONFIG_DIR: "/nonexistent-claude-config",
      },
      input: envelope(cwd, command),
    });
  }

  it("passes the context JSON through on Claude Code and refuses the write", () => {
    const fixture = buildFixture();
    const host = hostProject();
    const claude = { CLAUDECODE: "1" };
    expect(
      dispatch(host, fixture, fixture.a, WRITE_COMMAND, claude).status
    ).toBe(ALLOWED);
    const read = dispatch(host, fixture, fixture.b, "rg foo", claude);
    expect(read.status).toBe(ALLOWED);
    const context = JSON.parse(read.stdout).hookSpecificOutput
      .additionalContext;
    expect(context).toContain(READ_WARNING);
    expect(
      dispatch(host, fixture, fixture.b, "git commit -m x", claude).status
    ).toBe(BLOCKED);
  });

  it("allows the read with no context JSON where the runtime is not Claude Code", () => {
    const fixture = buildFixture();
    const host = hostProject();
    expect(dispatch(host, fixture, fixture.a, WRITE_COMMAND).status).toBe(
      ALLOWED
    );
    const read = dispatch(host, fixture, fixture.b, "git status");
    expect(read.status).toBe(ALLOWED);
    expect(read.stdout).toBe("");
    expect(read.stderr).toContain(READ_WARNING);
    expect(dispatch(host, fixture, fixture.b, "bun install").status).toBe(
      BLOCKED
    );
  });
});
