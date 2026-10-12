/**
 * Integration tests for the session-manager CLI's manager and setup commands:
 * start, stop, status, repo-dir, validate, init-config and store-token, run
 * as a real process against stub `tmux` and `claude` executables.
 * @module tests/unit/session-manager/cli-manager
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildManagerLaunch } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";
import {
  CLI,
  MANAGER,
  MEMINFO,
  makeSandbox,
  removeSandboxes,
  runCli,
  type Sandbox,
} from "./support/cli-harness.js";
import { activeAgent, callsOf } from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const TOKEN_FILE = ".env";
const TMUX = "tmux";
const NEW_SESSION = "new-session";
const INIT_CONFIG = "init-config";
const STORE_TOKEN = "store-token";

/**
 * Put a token file with the given mode in the sandbox state dir.
 * @param sandbox - Project sandbox
 * @param mode - File mode
 */
function plantTokenFile(sandbox: Sandbox, mode = 0o600): void {
  const file = path.join(sandbox.stateDir, TOKEN_FILE);
  mkdirSync(sandbox.stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(file, "placeholder\n");
  chmodSync(file, mode);
}

describe("start", () => {
  it("exits 2 without <stateDir>/.env and never calls new-session", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["start"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(STORE_TOKEN);
    expect(callsOf(result.calls, TMUX, NEW_SESSION)).toEqual([]);
  });

  it("exits 2 for a group-readable token file", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox, 0o640);
    expect(runCli(sandbox, ["start"]).status).toBe(2);
  });

  it("exits 2 when stateDir is the shared default dir", () => {
    const sandbox = makeSandbox({
      sessionManager: {
        name: MANAGER,
        notify: {
          provider: "telegram",
          stateDir: "~/.claude/channels/telegram",
        },
      },
    });
    const result = runCli(sandbox, ["start"]);
    expect(result.status).toBe(2);
    expect(callsOf(result.calls, TMUX, NEW_SESSION)).toEqual([]);
  });

  it("launches the exact tmux argv from launch.mjs with a scrubbed env", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, ["start"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ status: "started", name: MANAGER });
    const [launch] = callsOf(result.calls, TMUX, NEW_SESSION);
    expect(launch?.argv).toEqual(
      buildManagerLaunch({
        name: MANAGER,
        root: sandbox.root,
        stateDir: sandbox.stateDir,
        scriptsDir: path.dirname(CLI),
        interval: "5m",
      })
    );
    expect(launch?.envKeys).not.toContain("TELEGRAM_BOT_TOKEN");
  });

  it("is a no-op when the tmux session already exists", () => {
    const sandbox = makeSandbox();
    plantTokenFile(sandbox);
    const result = runCli(sandbox, ["start"], {
      env: { STUB_TMUX_HAS_SESSION: "1", STUB_TMUX_SESSION_PATH: sandbox.root },
    });
    expect(result.status).toBe(0);
    expect(result.json.status).toBe("already-running");
    expect(callsOf(result.calls, TMUX, NEW_SESSION)).toEqual([]);
  });
});

describe("stop", () => {
  it("kills only the manager session", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["stop"], {
      env: { STUB_TMUX_HAS_SESSION: "1", STUB_TMUX_SESSION_PATH: sandbox.root },
    });
    expect(result.status).toBe(0);
    expect(result.json.status).toBe("stopped");
    const tmux = result.calls.filter(call => call.bin === TMUX);
    expect(tmux.map(call => call.argv)).toEqual([
      ["has-session", "-t", `=${MANAGER}`],
      ["display-message", "-p", "-t", `=${MANAGER}:`, "#{session_path}"],
      ["kill-session", "-t", `=${MANAGER}`],
    ]);
    expect(result.calls.some(call => call.bin === "claude")).toBe(false);
  });

  it("reports not-running when there is no session", () => {
    const result = runCli(makeSandbox(), ["stop"]);
    expect(result.status).toBe(0);
    expect(result.json.status).toBe("not-running");
  });
});

describe("status", () => {
  it("joins the ledger with live sessions and reports the manager", () => {
    const sandbox = makeSandbox();
    const spawned = runCli(sandbox, ["spawn", "DEMO-7", "--meminfo", MEMINFO]);
    const result = runCli(sandbox, ["status"], {
      agents: [activeAgent(spawned.json.name), activeAgent("wk-X-1-1012-0900")],
      env: { STUB_TMUX_HAS_SESSION: "1" },
    });
    expect(result.status).toBe(0);
    expect(result.json.manager).toEqual({ name: MANAGER, running: true });
    expect(result.json.workers).toEqual([
      expect.objectContaining({
        ref: "DEMO-7",
        worker: spawned.json.name,
        live: true,
      }),
    ]);
    expect(result.json.untracked).toEqual(["wk-X-1-1012-0900"]);
  });
});

describe("repo-dir", () => {
  it("prints the routed dir as JSON, or bare with --raw", () => {
    const sandbox = makeSandbox({ repos: ["api"] });
    const json = runCli(sandbox, ["repo-dir", "--repo", "api"]);
    expect(json.json).toEqual({
      repo: "api",
      dir: path.join(sandbox.root, "projects/api"),
    });
    const raw = runCli(sandbox, ["repo-dir", "--repo", "api", "--raw"]);
    expect(raw.stdout).toBe(`${path.join(sandbox.root, "projects/api")}\n`);
  });

  it("is the project root for a single-repo project", () => {
    const sandbox = makeSandbox();
    expect(runCli(sandbox, ["repo-dir"]).json.dir).toBe(sandbox.root);
  });

  it("exits 2 for an unknown key or a child with no .lisa.config.json", () => {
    const sandbox = makeSandbox({ repos: ["api"], bareRepos: ["web"] });
    expect(runCli(sandbox, ["repo-dir", "--repo", "nope"]).status).toBe(2);
    expect(runCli(sandbox, ["repo-dir", "--repo", "web"]).status).toBe(2);
  });
});

describe("validate", () => {
  it("passes a valid block", () => {
    const result = runCli(makeSandbox({ repos: ["api"] }), ["validate"]);
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ valid: true, errors: [] });
  });

  it("exits 2 listing every problem", () => {
    const sandbox = makeSandbox({
      sessionManager: { name: "Bad Name", notify: { provider: "telegram" } },
    });
    const result = runCli(sandbox, ["validate"]);
    expect(result.status).toBe(2);
    expect(result.json.valid).toBe(false);
    expect(result.json.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("exits 2 when the block is absent", () => {
    const result = runCli(makeSandbox({ sessionManager: null }), ["validate"]);
    expect(result.status).toBe(2);
    expect(result.json.valid).toBe(false);
  });
});

describe("init-config", () => {
  it("prints a default block with detected repos and writes it with --write", () => {
    const sandbox = makeSandbox({ sessionManager: null, repos: ["api"] });
    const printed = runCli(sandbox, [INIT_CONFIG, "--slug", "demo"]);
    expect(printed.status).toBe(0);
    expect(printed.json.block.name).toBe("demo-manager");
    expect(Object.keys(printed.json.block.repos.entries)).toEqual(["api"]);
    expect(printed.json.written).toBe(false);

    const written = runCli(sandbox, [INIT_CONFIG, "--slug", "demo", "--write"]);
    expect(written.json.written).toBe(true);
    const config = JSON.parse(
      readFileSync(path.join(sandbox.root, ".lisa.config.json"), "utf8")
    );
    expect(config.sessionManager.name).toBe("demo-manager");
    expect(config.github.repo).toBe("demo-repo");
  });

  it("never overwrites an existing block", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, [INIT_CONFIG, "--write"]);
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({ written: false, reason: "exists" });
  });
});

describe(STORE_TOKEN, () => {
  it("without a TTY prints the copy-paste command and stores nothing", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, [STORE_TOKEN]);
    expect(result.status).toBe(0);
    expect(result.json.stored).toBe(false);
    expect(result.json.reason).toBe("no-tty");
    expect(result.json.command).toContain("store-token --project-root");
    expect(existsSync(path.join(sandbox.stateDir, TOKEN_FILE))).toBe(false);
  });
});

describe("usage", () => {
  it("--help lists every subcommand", () => {
    const result = runCli(makeSandbox(), ["--help"], { noProjectRoot: true });
    expect(result.status).toBe(0);
    for (const name of [
      "capacity",
      "spawn",
      "resume",
      "start",
      "stop",
      "status",
      "repo-dir",
      "queue",
      "ledger",
      "classify",
      "route",
      "blocked-plan",
      "record-cycle",
      INIT_CONFIG,
      STORE_TOKEN,
      "validate",
    ]) {
      expect(result.stdout).toContain(name);
    }
  });

  it("exits 2 on an unknown subcommand or flag", () => {
    const sandbox = makeSandbox();
    expect(runCli(sandbox, ["nope"]).status).toBe(2);
    expect(runCli(sandbox, ["capacity", "--bogus"]).status).toBe(2);
  });

  it("exits 2 on a relative --project-root", () => {
    const result = runCli(
      makeSandbox(),
      ["capacity", "--project-root", "relative/dir"],
      { noProjectRoot: true }
    );
    expect(result.status).toBe(2);
  });
});
