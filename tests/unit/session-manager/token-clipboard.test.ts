/**
 * Contract tests for storing the bot token from the clipboard
 * (CodySwannGT/lisa#4465).
 *
 * `store-token` prompts on a TTY, and neither an agent's Bash nor Claude
 * Code's `!` prefix has one, so the clipboard is the route an operator inside
 * Claude Code can actually use. These tests pin that it applies the same
 * validation and existing-token rule as the prompt, writes the file 0600,
 * clears the clipboard only after a successful store, and never lets the
 * token (or an invalid value) out in a return value or error.
 * @module tests/unit/session-manager/token-clipboard
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readClipboard } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/clipboard.mjs";
import {
  LaunchError,
  storeToken,
  storeTokenFromClipboard,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/launch.mjs";

/** A well-formed but fake bot token, assembled so it is not a literal. */
const TOKEN = ["123456789", "AAH-abcdefghijklmnopqrstuvwxyz_0123"].join(":");
const TOKEN_FILE = ".env";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sm-clip-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * A fake clipboard holding `text`, recording whether it was cleared.
 * @param text - Clipboard contents
 * @returns The seam and its clear spy
 */
function clipboard(text: string) {
  const clear = vi.fn(() => true);
  return { read: () => ({ ok: true as const, text, clear }), clear };
}

describe("storeTokenFromClipboard", () => {
  it("stores a valid token 0600, clears the clipboard, and returns only the path", () => {
    const stateDir = path.join(dir, "tg");
    const clip = clipboard(`  ${TOKEN}\n`);
    const result = storeTokenFromClipboard({
      stateDir,
      io: { readClipboard: clip.read },
    });
    const file = path.join(stateDir, TOKEN_FILE);
    expect(result).toEqual({
      stored: true,
      path: file,
      clipboardCleared: true,
    });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toBe(`TELEGRAM_BOT_TOKEN=${TOKEN}\n`);
    expect(clip.clear).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(TOKEN.split(":")[1]);
  });

  it.each([
    ["", "empty"],
    ["   \n", "empty"],
    ["hunter2-not-a-token", "invalid"],
  ])("refuses %j (%s) without echoing it or clearing", (text, reason) => {
    const clip = clipboard(text);
    const result = storeTokenFromClipboard({
      stateDir: path.join(dir, "tg"),
      io: { readClipboard: clip.read },
    });
    expect(result).toMatchObject({ stored: false, reason });
    if (text.trim()) expect(JSON.stringify(result)).not.toContain(text.trim());
    expect(clip.clear).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, "tg", TOKEN_FILE))).toBe(false);
  });

  it("keeps an existing token without --replace, before reading the clipboard", () => {
    const stateDir = path.join(dir, "tg");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, TOKEN_FILE), "kept\n");
    const read = vi.fn();
    expect(() =>
      storeTokenFromClipboard({ stateDir, io: { readClipboard: read } })
    ).toThrow(LaunchError);
    expect(read).not.toHaveBeenCalled();
    expect(readFileSync(path.join(stateDir, TOKEN_FILE), "utf8")).toBe(
      "kept\n"
    );
  });

  it("replaces an existing token with --replace", () => {
    const stateDir = path.join(dir, "tg");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(path.join(stateDir, TOKEN_FILE), "old\n");
    const result = storeTokenFromClipboard({
      stateDir,
      replace: true,
      io: { readClipboard: clipboard(TOKEN).read },
    });
    expect(result.stored).toBe(true);
  });

  it("passes a clipboard failure through without storing", () => {
    const result = storeTokenFromClipboard({
      stateDir: path.join(dir, "tg"),
      io: {
        readClipboard: () => ({
          ok: false as const,
          reason: "unavailable" as const,
          message: "No clipboard tool found.",
        }),
      },
    });
    expect(result).toEqual({
      stored: false,
      reason: "unavailable",
      message: "No clipboard tool found.",
    });
  });
});

describe("storeToken without a TTY", () => {
  it("offers the clipboard command and says the ! prefix has no TTY", async () => {
    const scriptsDir = "/opt/lisa/scripts";
    const result = await storeToken({
      stateDir: path.join(dir, "tg"),
      scriptsDir,
      projectRoot: "/work/demo",
      io: { canPrompt: () => false, promptSecret: vi.fn() },
    });
    expect(result).toMatchObject({
      stored: false,
      reason: "no-tty",
      clipboardCommand: `node '${scriptsDir}/session-manager.mjs' store-token --from-clipboard --project-root '/work/demo'`,
    });
    expect((result as { message: string }).message).toContain("! prefix");
  });
});

describe("readClipboard", () => {
  /**
   * A tool runner that reports `missing` for every command not in `present`.
   * @param present - Commands that exist, with the stdout they print
   * @returns The runner and the argv it saw
   */
  function runner(present: Record<string, { status: number; stdout: string }>) {
    const seen: string[][] = [];
    const run = (argv: string[]) => {
      const hit = present[argv[0] ?? ""];
      seen.push(argv);
      return hit
        ? { ...hit, missing: false }
        : { status: null, stdout: "", missing: true };
    };
    return { run, seen };
  }

  it("uses pbpaste on macOS and pbcopy to clear", () => {
    const { run, seen } = runner({
      pbpaste: { status: 0, stdout: TOKEN },
      pbcopy: { status: 0, stdout: "" },
    });
    const result = readClipboard({ platform: "darwin", run });
    expect(result).toMatchObject({ ok: true, text: TOKEN });
    expect((result as { clear: () => boolean }).clear()).toBe(true);
    expect(seen.map(argv => argv[0])).toEqual(["pbpaste", "pbcopy"]);
  });

  it("falls through to the first Linux tool that exists", () => {
    const { run, seen } = runner({ xsel: { status: 0, stdout: TOKEN } });
    const result = readClipboard({ platform: "linux", run });
    expect(result).toMatchObject({ ok: true, text: TOKEN });
    expect(seen.map(argv => argv[0])).toEqual(["wl-paste", "xclip", "xsel"]);
  });

  it("reports unavailable when no tool exists", () => {
    const { run } = runner({});
    expect(readClipboard({ platform: "linux", run })).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
  });

  it("reports a failing tool without its output", () => {
    const { run } = runner({ pbpaste: { status: 1, stdout: TOKEN } });
    const result = readClipboard({ platform: "darwin", run });
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("reports an unsupported platform", () => {
    expect(readClipboard({ platform: "win32", run: vi.fn() })).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });
});
