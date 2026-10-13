/**
 * Read and clear the system clipboard, for `store-token --from-clipboard`.
 *
 * `store-token` prompts on a TTY with echo off, and an agent's Bash has no
 * TTY. Neither does Claude Code's `!` prefix, which is the first thing an
 * operator inside Claude Code tries, so the only working route used to be a
 * separate terminal app (CodySwannGT/lisa#4465). The clipboard is the route an
 * operator reaches for instead: they copy the token from BotFather and the
 * agent stores it without ever seeing it.
 *
 * What is read is a secret. It is returned to the caller and never placed in
 * an error message, a log line or a return value of anything else here.
 * @module session-manager/clipboard
 */
import { spawnSync } from "node:child_process";

/** Upper bound for one clipboard tool call. */
const TOOL_TIMEOUT_MS = 5000;

/**
 * Clipboard tools per platform, tried in order: the first one that runs is
 * used for both reading and clearing.
 */
const TOOLS = Object.freeze({
  darwin: [{ name: "pbpaste", read: ["pbpaste"], clear: ["pbcopy"] }],
  linux: [
    {
      name: "wl-paste",
      read: ["wl-paste", "--no-newline"],
      clear: ["wl-copy", "--clear"],
    },
    {
      name: "xclip",
      read: ["xclip", "-o", "-selection", "clipboard"],
      clear: ["xclip", "-i", "-selection", "clipboard"],
    },
    {
      name: "xsel",
      read: ["xsel", "--clipboard", "--output"],
      clear: ["xsel", "--clipboard", "--clear"],
    },
  ],
});

/**
 * Run one tool with empty stdin.
 *
 * A clear (`capture: false`) discards the tool's output instead of piping it:
 * `xclip -i` forks a background selection owner, and a child holding an
 * inherited pipe makes `spawnSync` wait out the whole timeout. Any spawn
 * error (a timeout included) is a failure, never a success.
 * @param {string[]} argv - Command and arguments
 * @param {{ capture?: boolean }} [options] - Whether to capture stdout
 * @returns {{ status: number | null, stdout: string, missing: boolean }}
 *   Outcome; `missing` when the binary is not on PATH
 */
function runTool([command, ...args], { capture = true } = {}) {
  const result = spawnSync(command, args, {
    input: "",
    encoding: "utf8",
    timeout: TOOL_TIMEOUT_MS,
    stdio: ["pipe", capture ? "pipe" : "ignore", "ignore"],
  });
  return {
    status: result.error ? null : result.status,
    stdout: result.stdout ?? "",
    missing: result.error?.code === "ENOENT",
  };
}

/**
 * Read the clipboard with the first available tool for `platform`.
 * @param {{ platform?: string, run?: typeof runTool }} [seams] - Platform and
 *   the tool runner
 * @returns {{ ok: true, text: string, clear: () => boolean } |
 *   { ok: false, reason: "unsupported" | "unavailable" | "failed",
 *     message: string }} The text and a function that clears the clipboard
 *   (true when it did), or why nothing was read
 */
export function readClipboard(seams = {}) {
  const platform = seams.platform ?? process.platform;
  const run = seams.run ?? runTool;
  const tools = TOOLS[platform];
  if (!tools) {
    return {
      ok: false,
      reason: "unsupported",
      message: `Reading the clipboard is not supported on ${platform}.`,
    };
  }
  const failed = [];
  for (const tool of tools) {
    const result = run(tool.read);
    if (result.missing) continue;
    // An installed tool can still fail where another works (wl-paste on an
    // X11 session), so a failure moves on to the next tool.
    if (result.status !== 0) {
      failed.push(`${tool.name} exited ${result.status}`);
      continue;
    }
    return {
      ok: true,
      text: result.stdout,
      clear: () => run(tool.clear, { capture: false }).status === 0,
    };
  }
  if (failed.length > 0) {
    return {
      ok: false,
      reason: "failed",
      message: `${failed.join("; ")}; nothing was read.`,
    };
  }
  return {
    ok: false,
    reason: "unavailable",
    message: `No clipboard tool found (tried ${tools.map(t => t.name).join(", ")}).`,
  };
}
