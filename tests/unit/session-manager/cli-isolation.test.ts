/**
 * Per-project isolation of the manager, its bot and its token
 * (CodySwannGT/lisa#4448 review finding S1).
 *
 * Two checkouts of the same repository (or two projects that happen to share a
 * folder name) must never end up sharing one manager session, one Telegram
 * state dir or one bot token. The default slug therefore carries a hash of the
 * project root, `start`/`stop` refuse a tmux session that belongs to another
 * root, and `store-token` refuses to overwrite a token it did not just ask for.
 * @module tests/unit/session-manager/cli-isolation
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGER,
  makeSandbox,
  removeSandboxes,
  runCli,
  type Sandbox,
} from "./support/cli-harness.js";
import { callsOf } from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const TMUX = "tmux";
const TOKEN_FILE = ".env";
const STORE_TOKEN = "store-token";
const INIT_CONFIG = "init-config";
const PLACEHOLDER = "placeholder\n";

/**
 * The 6-hex root hash the default slug must carry.
 * @param root - Project root
 * @returns First six hex characters of sha256(realpath(root))
 */
const rootHash = (root: string): string =>
  createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 6);

/**
 * Put a 0600 token file in the sandbox state dir.
 * @param sandbox - Project sandbox
 */
function plantTokenFile(sandbox: Sandbox): void {
  const file = path.join(sandbox.stateDir, TOKEN_FILE);
  mkdirSync(sandbox.stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(file, PLACEHOLDER);
  chmodSync(file, 0o600);
}

/**
 * Environment that makes the stub tmux report a running manager whose
 * session was started in `sessionPath`.
 * @param sessionPath - What `#{session_path}` prints
 * @returns Stub env
 */
const runningAt = (sessionPath: string) => ({
  env: { STUB_TMUX_HAS_SESSION: "1", STUB_TMUX_SESSION_PATH: sessionPath },
});

describe("init-config default slug", () => {
  it("adds a stable hash of the project root to the repo name", () => {
    const sandbox = makeSandbox({ sessionManager: null });
    const slug = `demo-repo-${rootHash(sandbox.root)}`;
    const result = runCli(sandbox, [INIT_CONFIG]);
    expect(result.status).toBe(0);
    expect(result.json.block.name).toBe(`${slug}-manager`);
    expect(result.json.block.notify.stateDir).toBe(
      `~/.claude/channels/telegram-${slug}`
    );
  });

  it("gives two projects with the same repo name different managers and bots", () => {
    const one = runCli(makeSandbox({ sessionManager: null }), [INIT_CONFIG]);
    const two = runCli(makeSandbox({ sessionManager: null }), [INIT_CONFIG]);
    expect(one.json.block.name).not.toBe(two.json.block.name);
    expect(one.json.block.notify.stateDir).not.toBe(
      two.json.block.notify.stateDir
    );
  });

  it("keeps the hash inside the 64-character name limit for a long repo name", () => {
    const sandbox = makeSandbox({
      sessionManager: null,
      extraConfig: { github: { org: "o", repo: "r".repeat(80) } },
    });
    const name: string = runCli(sandbox, [INIT_CONFIG]).json.block.name;
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).toContain(`-${rootHash(sandbox.root)}-manager`);
  });

  it("uses an explicit --slug exactly as given", () => {
    const sandbox = makeSandbox({ sessionManager: null });
    const result = runCli(sandbox, [INIT_CONFIG, "--slug", "demo"]);
    expect(result.json.block.name).toBe(MANAGER);
  });
});

describe("start against an existing tmux session", () => {
  it("reports already-running when the session was started in this root", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, ["start"], runningAt(sandbox.root));
    expect(result.status).toBe(0);
    expect(result.json.status).toBe("already-running");
  });

  it("compares real paths, so a symlinked root is still this root", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const alias = path.join(path.dirname(sandbox.root), "alias");
    symlinkSync(sandbox.root, alias);
    const result = runCli(sandbox, ["start"], runningAt(alias));
    expect(result.status).toBe(0);
    expect(result.json.status).toBe("already-running");
  });

  it("exits 2 naming the conflict when the session belongs to another root", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const other = path.join(path.dirname(sandbox.root), "other-project");
    mkdirSync(other);
    const result = runCli(sandbox, ["start"], runningAt(other));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(MANAGER);
    expect(result.stderr).toContain(other);
    expect(result.json).toBeNull();
    expect(callsOf(result.calls, TMUX, "new-session")).toEqual([]);
  });

  it("exits 2 when tmux cannot say where the session was started", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, ["start"], runningAt(""));
    expect(result.status).toBe(2);
    expect(callsOf(result.calls, TMUX, "new-session")).toEqual([]);
  });
});

describe("stop against another project's session", () => {
  it("exits 2 and never kills a session started in another root", () => {
    const sandbox = makeSandbox();
    const other = path.join(path.dirname(sandbox.root), "other-project");
    mkdirSync(other);
    const result = runCli(sandbox, ["stop"], runningAt(other));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(other);
    expect(callsOf(result.calls, TMUX, "kill-session")).toEqual([]);
  });
});

describe("store-token over an existing token", () => {
  it("exits 2 without --replace and leaves the token file untouched", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, [STORE_TOKEN]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--replace");
    expect(readFileSync(path.join(sandbox.stateDir, TOKEN_FILE), "utf8")).toBe(
      PLACEHOLDER
    );
  });

  it("with --replace proceeds to the prompt and carries --replace into the operator's command", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, [STORE_TOKEN, "--replace"]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ stored: false, reason: "no-tty" });
    expect(result.json.command).toContain("--replace");
  });

  it("needs no --replace when there is no token yet", () => {
    const result = runCli(makeSandbox(), [STORE_TOKEN]);
    expect(result.status).toBe(0);
    expect(result.json.command).not.toContain("--replace");
  });
});
