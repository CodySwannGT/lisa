/**
 * The two shell-facing renderings of the manager's tmux launch, split out of
 * launch.mjs to keep it under the line budget (#4555):
 * - {@link buildForegroundCommand}: the display-only line an operator runs to
 *   start the manager in the foreground and see claude's own error;
 * - {@link buildSourcedLaunch}: the `tmux start-server ; source-file -` call
 *   that carries secret session variables (the Telegram bot token) on stdin,
 *   never in argv.
 *
 * Both take the argv `buildManagerLaunch` returned. Everything here is pure:
 * nothing reads the environment or runs a process. launch.mjs re-exports
 * every export, so callers keep one import.
 * @module launch-shell
 */
import { LaunchError } from "./state-dir.mjs";

/** A `'` inside a single-quoted shell word: close, escaped quote, reopen. */
const ESCAPED_QUOTE = "'\\''";

/** An argument a POSIX shell reads back unchanged without quotes. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quote one argument for a POSIX shell, for display only.
 * @param {string} value - Argument
 * @returns {string} Single-quoted argument
 */
function shellQuote(value) {
  return `'${value.replaceAll("'", ESCAPED_QUOTE)}'`;
}

/**
 * The shell line an operator runs to start the manager in the foreground,
 * from the tmux argv `buildManagerLaunch` (launch.mjs) returned: same cwd, the same
 * two session variables, the same claude argv. `start` prints it when the
 * tmux session dies at once, because tmux closes the window and claude's own
 * error goes with it. It is display text only and is never executed here.
 * The token is not in the argv, so it is not in this line either. When the
 * token comes from a secrets provider, `shellVars` adds it as a command the
 * operator's own shell runs (`$(node …/resolve-secret.mjs get <NAME>)`), so
 * the line names the secret and never holds its value (#4555).
 * @param {readonly string[]} argv - Result of `buildManagerLaunch` (launch.mjs)
 * @param {Record<string, string>} [shellVars] - Extra variables, each value
 *   double-quoted so the operator's shell expands it
 * @returns {string} One shell line
 */
export function buildForegroundCommand(argv, shellVars = {}) {
  const claudeAt = argv.indexOf("claude");
  const head = argv.slice(0, claudeAt);
  const cwd = head[head.indexOf("-c") + 1];
  const vars = head
    .filter((_, index) => head[index - 1] === "-e")
    .map(entry => {
      const at = entry.indexOf("=");
      return `${entry.slice(0, at)}=${shellQuote(entry.slice(at + 1))}`;
    });
  const expanded = Object.entries(shellVars).map(
    ([name, value]) => `${name}="${value}"`
  );
  const command = argv
    .slice(claudeAt)
    .map(arg => (SHELL_SAFE.test(arg) ? arg : shellQuote(arg)));
  return `cd ${shellQuote(cwd)} && ${[...vars, ...expanded, ...command].join(" ")}`;
}

/**
 * Quote one word for tmux's command parser: single quotes, inside which
 * nothing is special, and `'"'"'` for a quote (close, a double-quoted quote,
 * reopen; tmux joins adjacent quoted runs into one word).
 * @param {string} word - Word
 * @returns {string} Quoted word
 */
export function tmuxQuote(word) {
  return `'${String(word).replaceAll("'", `'"'"'`)}'`;
}

/**
 * The tmux call that starts the manager with secret session variables
 * (the Telegram bot token from the secrets provider, #4555) that must never
 * reach argv, where `ps` shows them to every user on the host.
 *
 * `tmux start-server ; source-file -` reads the `new-session` command from
 * stdin, so the argv holds no value. The `-e` variables join the session's
 * own environment only, the same as the ones `buildManagerLaunch` (launch.mjs)
 * already passes. A newline in any word would end the command early and run
 * the rest as a second tmux command, so it is refused.
 * @param {readonly string[]} argv - Result of `buildManagerLaunch` (launch.mjs)
 * @param {Record<string, string>} sessionVars - Extra session variables
 * @returns {{ argv: string[], input: string }} argv for `spawnSync("tmux")`
 *   and the line for its stdin
 */
export function buildSourcedLaunch(argv, sessionVars) {
  if (argv[0] !== "new-session") {
    throw new LaunchError("buildSourcedLaunch needs a new-session argv.");
  }
  const claudeAt = argv.indexOf("claude");
  const words = [
    ...argv.slice(0, claudeAt),
    ...Object.entries(sessionVars).flatMap(([name, value]) => [
      "-e",
      `${name}=${value}`,
    ]),
    ...argv.slice(claudeAt),
  ];
  if (words.some(word => /[\r\n]/.test(word))) {
    throw new LaunchError(
      "A launch argument contains a newline, which would end the tmux " +
        "command early. Nothing was started."
    );
  }
  return {
    argv: ["start-server", ";", "source-file", "-"],
    input: `${words.map(tmuxQuote).join(" ")}\n`,
  };
}
