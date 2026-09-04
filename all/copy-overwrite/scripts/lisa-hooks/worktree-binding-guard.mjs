#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Reconcile the worktree a session was TOLD it is in against the one it is
 * ACTUALLY operating in, and refuse to act while the two disagree.
 *
 * WHAT WENT WRONG. `EnterWorktree` reported "the session is now working in the
 * worktree" for a tree that Bash never moved to and that Edit then refused by
 * name (CodySwannGT/lisa#3864). Three subsystems, three answers, and the one
 * that answered affirmatively was the wrong one. A refusal teaches you
 * something; a success message that is not true is a confirmation — it removes
 * the reason to check and sends the agent forward confidently in the wrong
 * place. Acting on that confirmation, one session ran an install that landed in
 * a different agent's active worktree. The next such command is a `git commit`
 * or a file write, and that tree held eighteen modified tracked files.
 *
 * The displacement is also mutual: whoever calls `EnterWorktree` last wins for
 * every session whose own binding never took, so each agent repairing itself
 * displaces the others. That is why "just re-enter your worktree" is not a
 * remedy — it is the mechanism.
 *
 * WHAT THIS FIXES AND WHAT IT CANNOT. Lisa does not own `EnterWorktree`, so it
 * cannot make that call itself return failure. What it can do is make the
 * false confirmation cost nothing: the FIRST action taken on the strength of it
 * is refused, and the refusal names the worktree the session is really bound
 * to. The gap is stated rather than hidden — the acceptance criterion asking
 * `EnterWorktree` to fail is met one tool call later, by the guard, not by the
 * tool.
 *
 * WHY BLOCKING AND NOT A WARNING. The failure mode is that nothing feels wrong.
 * There is no symptom to notice, so an advisory line scrolls past exactly when
 * it matters. A refusal is the only form of this check the agent cannot read
 * past.
 *
 * WHY AN EXPLICIT ACKNOWLEDGEMENT AND NOT "BLOCK ONCE". A guard that blocks the
 * first attempt and lets the retry through is defeated by a blind retry, which
 * is the single most likely next action. So the block stands until the session
 * states, in the acknowledgement, the absolute path it now intends to work in.
 * A path that does not match what the session is actually in is refused too —
 * that is the rejection control, and it is what stops a stale acknowledgement
 * copied from another agent's transcript from silently rebinding this one.
 *
 * FAILING OPEN, LOUDLY. Anything this cannot determine — no session id, no
 * cwd, not a git repository, an unreadable state file — exits 0 with a line on
 * stderr. A guard that cannot read its input cannot tell a displacement from a
 * directory listing, and one that wedges every tool call is switched off within
 * the hour. Silence is the only outcome that is never acceptable.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Tools whose effect on the wrong worktree is not undoable by re-reading. */
const GUARDED_TOOLS = new Set(["Bash", "Write", "Edit", "MultiEdit"]);

/**
 * The literal an agent echoes to rebind this session deliberately.
 *
 * A shell line rather than a flag on this script, because the only surface the
 * agent has for saying so is a Bash command, and it must be one this guard sees
 * on its own PreToolUse pass — which is exactly where a command string arrives.
 */
const ACCEPT_PREFIX = "lisa-worktree-binding: accept";

/**
 * Resolve a path the way git reports one.
 *
 * `git rev-parse --show-toplevel` answers with symlinks resolved, and on macOS
 * every temporary directory is a symlink — `/var/…` is `/private/var/…`. A
 * comparison between git's answer and a path handed in by a tool would then
 * differ by that prefix alone and read as a displacement, which is a false
 * accusation in exactly the state the guard is supposed to be trusted in. A
 * path that does not exist yet cannot be resolved and is returned as given.
 * @param value - Absolute path to normalize
 * @returns The path with symlinks resolved where possible
 */
function realpath(value) {
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

function say(message) {
  process.stderr.write(`worktree-binding-guard: ${message}\n`);
}

/** Run git, returning trimmed stdout, or null when it exits non-zero. */
function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** The worktree root containing `cwd`, or null when `cwd` is not in a repo. */
function worktreeRoot(cwd) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  return top ? resolve(top) : null;
}

/**
 * The MAIN checkout's root, which is where `.claude/worktrees/` lives.
 *
 * `--git-common-dir` is shared by every linked worktree, so its parent is the
 * main checkout no matter which worktree asks.
 */
function mainCheckout(cwd) {
  const common = git(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd
  );
  return common ? dirname(resolve(common)) : null;
}

function stateFile(sessionId) {
  const home = process.env.LISA_STATE_HOME || join(homedir(), ".lisa");
  return join(home, "worktree-binding", `${sessionId}.json`);
}

function readState(sessionId) {
  try {
    return JSON.parse(readFileSync(stateFile(sessionId), "utf8"));
  } catch {
    return null;
  }
}

function writeState(sessionId, state) {
  const file = stateFile(sessionId);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    return true;
  } catch (error) {
    say(`could not record the binding (${error.message}); NOT enforcing`);
    return false;
  }
}

/**
 * The worktree `EnterWorktree` claims the session moved to.
 *
 * `path` is given verbatim; `name` resolves under the main checkout's
 * `.claude/worktrees/`, which is where the tool creates one. A call carrying
 * neither is a generated name this guard cannot predict, so it returns null and
 * the claim is simply not recorded — an unrecorded claim degrades to the plain
 * displacement check rather than to a false accusation.
 */
function claimedRoot(toolInput, cwd) {
  const path = toolInput?.path;
  if (typeof path === "string" && path.trim()) {
    return realpath(resolve(isAbsolute(path) ? path : join(cwd, path)));
  }
  const name = toolInput?.name;
  if (typeof name === "string" && name.trim()) {
    const main = mainCheckout(cwd);
    return main
      ? realpath(join(main, ".claude", "worktrees", name.trim()))
      : null;
  }
  return null;
}

/**
 * Record what `EnterWorktree` just claimed, for the next tool call to check.
 *
 * Returns nothing on purpose. This runs on PostToolUse, where the tool has
 * already happened and there is no call left to refuse, so every path through
 * it is an allow — and a function whose only answer is "allow" should not be
 * spelled as one that computes an exit code.
 */
function recordClaim(payload, observed) {
  const claimed = claimedRoot(payload.tool_input, payload.cwd);
  if (!claimed || claimed === observed) return;
  const previous = readState(payload.session_id);
  writeState(payload.session_id, {
    boundRoot: previous?.boundRoot ?? observed,
    claimedRoot: claimed,
    updatedAt: new Date().toISOString(),
  });
}

function refuse(lines) {
  process.stderr.write(`${lines.join("\n")}\n`);
  return 2;
}

function acceptanceLine(observed) {
  return `  echo '${ACCEPT_PREFIX} ${observed}'`;
}

/**
 * Handle an acknowledgement line, or return null when the command is not one.
 *
 * The path is compared against what the session is measurably in, not against
 * what it says it wants. An acknowledgement naming somewhere else is the case
 * this is for: it means the operator is reasoning about a tree they are not in.
 */
function handleAcceptance(payload, observed) {
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command.includes(ACCEPT_PREFIX))
    return null;
  const stated = command.slice(
    command.indexOf(ACCEPT_PREFIX) + ACCEPT_PREFIX.length
  );
  const match = /([^\s'"]+)/.exec(stated);
  const path = match ? realpath(resolve(match[1])) : null;
  if (path !== observed) {
    return refuse([
      `worktree-binding-guard: this acknowledgement names ${path ?? "no path"},`,
      `but this session is operating in ${observed}. Not rebinding.`,
      `If ${observed} is where you mean to work, acknowledge that path:`,
      acceptanceLine(observed),
    ]);
  }
  writeState(payload.session_id, {
    boundRoot: observed,
    claimedRoot: null,
    updatedAt: new Date().toISOString(),
  });
  say(`bound to ${observed}`);
  return 0;
}

/** Refusal text for a switch that reported success without taking effect. */
function unconfirmedSwitch(claimed, observed) {
  return refuse([
    `worktree-binding-guard: EnterWorktree reported success for`,
    `  ${claimed}`,
    `but this session is still operating in`,
    `  ${observed}`,
    "The switch did not take effect. Anything run now lands in the second",
    "path, not the first — including installs, commits, and file writes, and",
    "that tree may hold another agent's uncommitted work.",
    "",
    "Use absolute paths under the tree you actually want, or acknowledge that",
    "you intend to keep working where you are:",
    acceptanceLine(observed),
  ]);
}

/** Refusal text for a binding that moved without this session asking. */
function displaced(bound, observed) {
  return refuse([
    "worktree-binding-guard: this session's worktree changed underneath it.",
    `  bound to:  ${bound}`,
    `  now in:    ${observed}`,
    "Concurrent sessions share one worktree binding, so another agent's",
    "EnterWorktree can move this one. Commands run now land in the second",
    "path. If you moved deliberately, say so:",
    acceptanceLine(observed),
  ]);
}

function evaluate(payload) {
  const sessionId = payload.session_id;
  const cwd = payload.cwd;
  if (typeof sessionId !== "string" || !sessionId || typeof cwd !== "string") {
    say("payload carries no session id or cwd; binding is NOT enforced");
    return 0;
  }
  const observed = worktreeRoot(cwd);
  if (!observed) return 0;

  if (payload.tool_name === "EnterWorktree") {
    recordClaim(payload, observed);
    return 0;
  }
  if (!GUARDED_TOOLS.has(payload.tool_name)) return 0;

  const accepted = handleAcceptance(payload, observed);
  if (accepted !== null) return accepted;

  const state = readState(sessionId);
  if (!state?.boundRoot) {
    writeState(sessionId, {
      boundRoot: observed,
      claimedRoot: null,
      updatedAt: new Date().toISOString(),
    });
    return 0;
  }
  if (state.claimedRoot && state.claimedRoot !== observed) {
    return unconfirmedSwitch(state.claimedRoot, observed);
  }
  if (state.claimedRoot === observed) {
    writeState(sessionId, {
      boundRoot: observed,
      claimedRoot: null,
      updatedAt: new Date().toISOString(),
    });
    return 0;
  }
  if (state.boundRoot !== observed) return displaced(state.boundRoot, observed);
  return 0;
}

function main() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    say("could not read the hook payload; binding is NOT enforced");
    return 0;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    say("hook payload was not JSON; binding is NOT enforced");
    return 0;
  }
  return evaluate(payload);
}

process.exit(main());
