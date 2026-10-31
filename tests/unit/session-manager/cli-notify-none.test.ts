/**
 * The session manager with no notification channel (CodySwannGT/lisa#4555,
 * part 1).
 *
 * Telegram is optional: `sessionManager.notify.provider` may be `"none"`, and
 * an absent `notify` block means the same. Without a channel there is no bot
 * token, no Telegram plugin and no pairing, so `init-config`, `validate` and
 * `start` must all succeed with none of them, and `start` must launch the
 * manager without `--channels`, without `TELEGRAM_STATE_DIR` and without the
 * plugin in its settings. Run as a real process against the stub `tmux` and
 * `claude`, like the other CLI suites; nothing here touches a real Telegram
 * state dir.
 * @module tests/unit/session-manager/cli-notify-none
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildManagerLaunch } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";
import {
  CLI,
  MANAGER,
  makeSandbox,
  removeSandboxes,
  runCli,
} from "./support/cli-harness.js";
import { callsOf } from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const TMUX = "tmux";
const NEW_SESSION = "new-session";
const INIT_CONFIG = "init-config";
const TELEGRAM_PLUGIN = "telegram@claude-plugins-official";

/** A runnable block with no `notify` key at all. */
const NO_NOTIFY = {
  name: MANAGER,
  capacity: {
    maxWorkers: 6,
    gbPerWorker: 1,
    reserveGb: 0,
    cpuFraction: 1,
    maxLoadPerCore: 1000,
  },
};

describe("init-config --notify", () => {
  it("defaults to no notification channel and no state dir", () => {
    const sandbox = makeSandbox({ sessionManager: null });
    const result = runCli(sandbox, [INIT_CONFIG, "--slug", "demo"]);
    expect(result.status).toBe(0);
    expect(result.json.block.notify).toEqual({ provider: "none" });
  });

  it("writes a per-project Telegram state dir with --notify telegram", () => {
    const sandbox = makeSandbox({ sessionManager: null });
    const result = runCli(sandbox, [
      INIT_CONFIG,
      "--slug",
      "demo",
      "--notify",
      "telegram",
    ]);
    expect(result.status).toBe(0);
    expect(result.json.block.notify).toEqual({
      provider: "telegram",
      stateDir: "~/.claude/channels/telegram-demo",
    });
  });

  it("exits 2 for a provider it does not implement", () => {
    const sandbox = makeSandbox({ sessionManager: null });
    const result = runCli(sandbox, [INIT_CONFIG, "--notify", "slack"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/none.*telegram/);
  });

  it("writes a block that validate accepts", () => {
    const sandbox = makeSandbox({ sessionManager: null });
    expect(runCli(sandbox, [INIT_CONFIG, "--write"]).status).toBe(0);
    const config = JSON.parse(
      readFileSync(path.join(sandbox.root, ".lisa.config.json"), "utf8")
    );
    expect(config.sessionManager.notify).toEqual({ provider: "none" });
    expect(runCli(sandbox, ["validate"]).json).toEqual({
      valid: true,
      errors: [],
    });
  });
});

describe.each([
  ["an absent notify block", NO_NOTIFY],
  ['notify.provider "none"', { ...NO_NOTIFY, notify: { provider: "none" } }],
])("with %s", (_label, block) => {
  it("status reports notify none, so the manager knows no channel exists", () => {
    const result = runCli(makeSandbox({ sessionManager: block }), ["status"]);
    expect(result.status).toBe(0);
    expect(result.json.notify).toBe("none");
  });

  it("validate passes with no state dir", () => {
    const sandbox = makeSandbox({ sessionManager: block });
    const result = runCli(sandbox, ["validate"]);
    expect(result.status).toBe(0);
    expect(result.json).toEqual({ valid: true, errors: [] });
  });

  it("start launches without a token, channel, state dir or Telegram plugin", () => {
    const sandbox = makeSandbox({ sessionManager: block });
    const result = runCli(sandbox, ["start", "--settle-ms", "300"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.json).toMatchObject({
      status: "started",
      name: MANAGER,
      notify: "none",
    });
    expect(result.json).not.toHaveProperty("stateDir");

    const [launch] = callsOf(result.calls, TMUX, NEW_SESSION);
    const argv = launch?.argv ?? [];
    expect(argv).toEqual(
      buildManagerLaunch({
        name: MANAGER,
        root: sandbox.root,
        scriptsDir: path.dirname(CLI),
        interval: "5m",
        notify: "none",
      })
    );
    expect(argv).not.toContain("--channels");
    expect(argv.some(arg => arg.startsWith("TELEGRAM_"))).toBe(false);
    expect(argv.join(" ")).not.toContain(TELEGRAM_PLUGIN);
    expect(argv.slice(-2)).toEqual([
      "--",
      "/loop 5m /lisa:session-manager cycle",
    ]);
    expect(launch?.envKeys.some(key => key.startsWith("TELEGRAM_"))).toBe(
      false
    );
    expect(existsSync(sandbox.stateDir)).toBe(false);
  });
});

describe("store-token with no notification channel", () => {
  it("exits 2 naming the telegram provider and writes nothing", () => {
    const sandbox = makeSandbox({ sessionManager: NO_NOTIFY });
    const result = runCli(sandbox, ["store-token", "--from-clipboard"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"provider":"telegram"');
    expect(existsSync(sandbox.stateDir)).toBe(false);
  });
});

describe("a Telegram state dir without the telegram provider", () => {
  it("is refused by validate and by start, before any tmux launch", () => {
    const sandbox = makeSandbox({
      sessionManager: {
        ...NO_NOTIFY,
        notify: { provider: "none", stateDir: "~/.claude/channels/tg-x" },
      },
    });
    const validate = runCli(sandbox, ["validate"]);
    expect(validate.status).toBe(2);
    expect(validate.json.errors.join("\n")).toMatch(/notify\.stateDir/);

    const start = runCli(sandbox, ["start"]);
    expect(start.status).toBe(2);
    expect(callsOf(start.calls, TMUX, NEW_SESSION)).toEqual([]);
  });
});
