/**
 * Ask an operator for a credential, without it appearing anywhere.
 *
 * The obvious alternatives all leave a copy behind:
 *
 * - **A command-line argument** is visible in `ps` to every process on the
 *   machine for as long as the call runs, and a shell records it in history.
 * - **The clipboard** is worse than it looks. Raycast, Alfred, Maccy and every
 *   other clipboard manager persist history in plaintext, searchable, long
 *   after the paste — so a bootstrap routed through it outlives the operation
 *   in a database nobody thinks about. Reading it silently also takes whatever
 *   happens to be there, which is the wrong thing whenever the operator copied
 *   something else in between.
 * - **Echoed input** puts it in the terminal scrollback, which is frequently
 *   logged.
 *
 * So: read from the tty with echo off, and never touch anything else.
 * @module prompt-secret
 */

import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";

/**
 * Whether a human can actually answer.
 *
 * Checked so an automated caller SKIPS the prompt rather than hanging on a
 * read that will never return. A setup script blocked forever is worse than one
 * that says what it could not do — the first looks like a slow install.
 * @param {object} [io] Injected seams, for tests.
 * @returns {boolean} True when stdin is a terminal.
 */
export function canPrompt(io = {}) {
  return Boolean(io.isTTY ?? process.stdin.isTTY);
}

/**
 * Prompt for a secret with terminal echo disabled.
 *
 * Echo is turned off with `stty` and restored in a `finally`, because a caller
 * that throws mid-read would otherwise leave the operator's terminal silently
 * not echoing anything they type afterwards.
 * @param {string} message Prompt to display.
 * @param {object} [io] Injected seams, for tests.
 * @returns {string} What was typed, trimmed.
 */
export function promptSecret(message, io = {}) {
  const run = io.run ?? execFileSync;
  const open = io.open ?? openSync;
  const read = io.read ?? readSync;
  const close = io.close ?? closeSync;
  const write = io.write ?? writeSync;

  const tty = open("/dev/tty", "r+");
  try {
    write(tty, message);
    run("stty", ["-echo"], { stdio: ["inherit", "ignore", "ignore"] });
    try {
      const buffer = Buffer.alloc(4096);
      const bytes = read(tty, buffer, 0, buffer.length, null);
      return buffer.toString("utf8", 0, bytes).trim();
    } finally {
      run("stty", ["echo"], { stdio: ["inherit", "ignore", "ignore"] });
      // The newline the operator typed was not echoed, so without this the next
      // line of output starts halfway across the prompt.
      write(tty, "\n");
    }
  } finally {
    close(tty);
  }
}
