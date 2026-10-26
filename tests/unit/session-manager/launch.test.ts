/**
 * Contract tests for the manager's Telegram state dir and bot token.
 *
 * The Telegram plugin long-polls from every session where it is enabled, and
 * on start it kills whichever poller holds the same state dir. So a manager
 * that shared the default dir would knock out the operator's own Telegram
 * session, or be knocked out by it. These tests pin the isolation (the shared
 * default is refused), the file modes (0700 dir, 0600 token file), the no-TTY
 * path an agent's Bash takes, and that the token never leaks into a return
 * value, an error or a log line. Every test works in a temp dir; none touches
 * a real Claude config dir.
 * @module tests/unit/session-manager/launch
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LaunchError,
  assertTokenPresent,
  loadPromptSecret,
  resolveStateDir,
  storeToken,
  validateBotToken,
  writeTokenFile,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";

/** A well-formed but fake bot token, assembled so it is not a literal. */
const TOKEN = ["123456789", "AAH-abcdefghijklmnopqrstuvwxyz_0123"].join(":");
const TOKEN_FILE = ".env";
const HOME = "/home/op";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sm-launch-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/**
 * Permission bits of a path.
 * @param p - Path to stat
 * @returns Mode masked to 0o777
 */
function mode(p: string) {
  return statSync(p).mode & 0o777;
}

describe("resolveStateDir", () => {
  it("expands a leading ~ against the injected home", () => {
    expect(
      resolveStateDir("~/.claude/channels/telegram-demo", { homedir: HOME })
    ).toBe("/home/op/.claude/channels/telegram-demo");
  });

  it("refuses the shared default under ~/.claude", () => {
    expect(() =>
      resolveStateDir("~/.claude/channels/telegram/", { homedir: HOME })
    ).toThrow(LaunchError);
  });

  it("refuses the shared default under CLAUDE_CONFIG_DIR", () => {
    expect(() =>
      resolveStateDir("/cfg/channels/telegram", {
        homedir: HOME,
        env: { CLAUDE_CONFIG_DIR: "/cfg" },
      })
    ).toThrow(/shared/);
  });

  it("refuses the shared default however it is cased", () => {
    expect(() =>
      resolveStateDir("/home/op/.claude/channels/Telegram", { homedir: HOME })
    ).toThrow(LaunchError);
  });

  it("refuses an empty or relative dir", () => {
    expect(() => resolveStateDir("", { homedir: HOME })).toThrow(LaunchError);
    expect(() => resolveStateDir("state/tg", { homedir: HOME })).toThrow(
      /absolute/
    );
  });

  it("maps refusals to exit 2", () => {
    try {
      resolveStateDir("~/.claude/channels/telegram", { homedir: HOME });
      expect.unreachable();
    } catch (error) {
      expect((error as LaunchError).exitCode).toBe(2);
    }
  });
});

describe("validateBotToken", () => {
  it("accepts <digits>:<30+ url-safe chars>", () => {
    expect(validateBotToken(TOKEN)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["abc:AAHabcdefghijklmnopqrstuvwxyz0123", "non-digit id"],
    ["123:short", "short secret"],
    [`${TOKEN} `, "trailing space"],
    [`123:${"a".repeat(29)}!`, "bad character"],
  ])("rejects %j (%s)", value => {
    expect(validateBotToken(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(validateBotToken(undefined)).toBe(false);
  });
});

describe("writeTokenFile", () => {
  it("creates the dir 0700 and the token file 0600 with one assignment", () => {
    const stateDir = path.join(dir, "nested", "telegram-demo");
    const result = writeTokenFile(stateDir, TOKEN);
    const file = path.join(stateDir, TOKEN_FILE);
    expect(result).toEqual({ path: file });
    expect(mode(stateDir)).toBe(0o700);
    expect(mode(file)).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe(`TELEGRAM_BOT_TOKEN=${TOKEN}\n`);
  });

  it("tightens an existing loose dir and replaces an existing file", () => {
    const stateDir = path.join(dir, "loose");
    mkdirSync(stateDir, { mode: 0o755 });
    writeFileSync(path.join(stateDir, TOKEN_FILE), "OLD=1\n", { mode: 0o644 });
    writeTokenFile(stateDir, TOKEN);
    expect(mode(stateDir)).toBe(0o700);
    expect(mode(path.join(stateDir, TOKEN_FILE))).toBe(0o600);
    expect(readdirSync(stateDir)).toEqual([TOKEN_FILE]);
  });

  it("refuses an invalid token without echoing it", () => {
    const bad = "999:not-a-real-token";
    expect(() => writeTokenFile(dir, bad)).toThrow(LaunchError);
    try {
      writeTokenFile(dir, bad);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(bad);
    }
    expect(existsSync(path.join(dir, TOKEN_FILE))).toBe(false);
  });
});

describe("assertTokenPresent", () => {
  it("passes for a 0600 token file", () => {
    writeTokenFile(dir, TOKEN);
    expect(assertTokenPresent(dir)).toEqual({
      path: path.join(dir, TOKEN_FILE),
    });
  });

  it("fails with exit 2 when the token file is missing", () => {
    expect(() => assertTokenPresent(dir)).toThrow(/store-token/);
    try {
      assertTokenPresent(dir);
    } catch (error) {
      expect((error as LaunchError).exitCode).toBe(2);
    }
  });

  it.each([0o640, 0o604, 0o644])(
    "fails with exit 2 when the token file mode is %o",
    loose => {
      writeTokenFile(dir, TOKEN);
      chmodSync(path.join(dir, TOKEN_FILE), loose);
      expect(() => assertTokenPresent(dir)).toThrow(/chmod 600/);
    }
  );
});

describe("storeToken", () => {
  const scriptsDir = "/opt/lisa/skills/lisa-session-manager/scripts";
  const projectRoot = "/work/demo project";

  it("returns a copy-paste command without prompting when there is no TTY", async () => {
    const promptSecret = vi.fn();
    const result = await storeToken({
      stateDir: path.join(dir, "tg"),
      scriptsDir,
      projectRoot,
      io: { canPrompt: () => false, promptSecret },
    });
    expect(promptSecret).not.toHaveBeenCalled();
    expect(result).toEqual({
      stored: false,
      reason: "no-tty",
      message: expect.stringContaining("separate terminal app"),
      command: `node '${scriptsDir}/session-manager.mjs' store-token --project-root '${projectRoot}'`,
      clipboardCommand: `node '${scriptsDir}/session-manager.mjs' store-token --from-clipboard --project-root '${projectRoot}'`,
    });
    expect(existsSync(path.join(dir, "tg"))).toBe(false);
  });

  it("stores a valid pasted token and reports only the path", async () => {
    const stateDir = path.join(dir, "tg");
    const result = await storeToken({
      stateDir,
      scriptsDir,
      projectRoot,
      io: { canPrompt: () => true, promptSecret: () => TOKEN },
    });
    expect(result).toEqual({
      stored: true,
      path: path.join(stateDir, TOKEN_FILE),
    });
    expect(mode(path.join(stateDir, TOKEN_FILE))).toBe(0o600);
  });

  it.each([
    ["", "empty"],
    ["123:nope", "invalid"],
  ])("does not store %j (%s)", async (typed, reason) => {
    const result = await storeToken({
      stateDir: path.join(dir, "tg"),
      scriptsDir,
      projectRoot,
      io: { canPrompt: () => true, promptSecret: () => typed },
    });
    expect(result).toMatchObject({ stored: false, reason });
    expect(existsSync(path.join(dir, "tg", TOKEN_FILE))).toBe(false);
  });

  it("refuses the shared default dir before prompting", async () => {
    const promptSecret = vi.fn();
    await expect(
      storeToken({
        stateDir: "~/.claude/channels/telegram",
        homedir: HOME,
        scriptsDir,
        projectRoot,
        io: { canPrompt: () => true, promptSecret },
      })
    ).rejects.toThrow(LaunchError);
    expect(promptSecret).not.toHaveBeenCalled();
  });

  it("never puts the token in a return value, error or log line", async () => {
    const logged: string[] = [];
    for (const method of ["log", "error", "warn", "info"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        logged.push(args.map(String).join(" "));
      });
    }
    const outputs: unknown[] = [];
    outputs.push(
      await storeToken({
        stateDir: path.join(dir, "tg"),
        scriptsDir,
        projectRoot,
        io: { canPrompt: () => true, promptSecret: () => TOKEN },
      }),
      writeTokenFile(path.join(dir, "tg2"), TOKEN),
      assertTokenPresent(path.join(dir, "tg"))
    );
    const nearMiss = `${TOKEN}!`;
    try {
      writeTokenFile(dir, nearMiss);
    } catch (error) {
      outputs.push((error as Error).message);
    }
    const haystack = JSON.stringify(outputs) + logged.join("\n");
    expect(haystack).not.toContain(TOKEN);
    expect(haystack).not.toContain(TOKEN.split(":")[1]);
  });
});

describe("loadPromptSecret", () => {
  it("imports promptSecret and canPrompt from the secrets-access skill", async () => {
    const mod = await loadPromptSecret();
    expect(typeof mod.promptSecret).toBe("function");
    expect(typeof mod.canPrompt).toBe("function");
    expect(mod.canPrompt({ isTTY: false })).toBe(false);
  });
});
