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
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

/**
 * How much of an executed script this guard will read, in bytes.
 *
 * A generated fixture can be megabytes, and a guard that reads all of it on
 * every Bash call is a guard someone switches off.
 */
const SCRIPT_READ_LIMIT = 256 * 1024;

/**
 * Programs that take their operands as DATA and never execute them.
 *
 * The same split `block-direct-issue-create.sh` makes, and for the same reason
 * it had to: a guard that opens every file a command names, then judges the
 * COMMAND by that FILE's contents, refuses ordinary inspection. Reading a
 * script that visits another worktree is not visiting it.
 *
 * The list is an exemption, not an allowlist. Anything unrecognised is
 * FOLLOWED, because an interpreter roster fails open on the runner nobody
 * enumerated.
 */
const READ_ONLY_PROGRAMS = new Set([
  "awk",
  "basename",
  "cat",
  "cksum",
  "cmp",
  "comm",
  "cut",
  "diff",
  "dirname",
  "du",
  "file",
  "find",
  "grep",
  "egrep",
  "fgrep",
  "head",
  "less",
  "ls",
  "md5",
  "md5sum",
  "more",
  "nl",
  "od",
  "realpath",
  "rg",
  "sed",
  "sha1sum",
  "sha256sum",
  "sort",
  "stat",
  "strings",
  "tail",
  "tee",
  "tr",
  "uniq",
  "wc",
  "xxd",
]);

/** Interpreters whose first non-option operand is the file they run. */
const EXECUTING_INTERPRETERS = new Set([
  "bash",
  "dash",
  "ksh",
  "node",
  "perl",
  "python",
  "python3",
  "ruby",
  "sh",
  "zsh",
  "bun",
  "deno",
  "tsx",
]);

/** Shell builtins that run a file in the CURRENT shell. */
const SOURCE_BUILTINS = new Set([".", "source"]);

/** Where one command ends and the next begins. */
const COMMAND_SEPARATORS = /\|\||&&|[;|&\n]/u;

/**
 * Split a command into tokens, honouring simple quoting.
 *
 * Deliberately simple, and the guard fails OPEN when it is not enough — see
 * {@link scriptReachingForeignTree}. A tokeniser that guessed would be worse
 * than one that says it does not know.
 */
function tokenise(segment) {
  const tokens = segment.match(/"[^"]*"|'[^']*'|[^\s]+/gu) ?? [];
  return tokens.map(token => token.replace(/^["']|["']$/gu, ""));
}

/**
 * The path this command EXECUTES, or null.
 *
 * The command-position question. A path anywhere else is an argument, and an
 * argument is data.
 */
function executedPath(segment) {
  const tokens = tokenise(segment);
  if (tokens.length === 0) return null;
  const [head, ...rest] = tokens;
  const program = head.split("/").pop() ?? "";
  if (READ_ONLY_PROGRAMS.has(program)) return null;
  if (SOURCE_BUILTINS.has(program)) return rest[0] ?? null;
  if (!EXECUTING_INTERPRETERS.has(program)) {
    // A command word that is itself a file runs by its shebang.
    return head.includes("/") ? head : null;
  }
  // A known interpreter: the first operand that is not an option.
  const operand = rest.find(token => !token.startsWith("-"));
  return operand ?? null;
}

/**
 * A worktree root other than `bound` that this text reaches into, or null.
 *
 * ## Why this does not enumerate `cd`
 *
 * The redirect spellings — `cd`, `git -C`, `--work-tree`, `--git-dir`, a
 * subshell, `env -C`, a variable holding the path — are an open set, and
 * enumerating them is the failure this arm exists to end
 * (CodySwannGT/lisa#3927 states it for the sibling guard). So the question is
 * inverted the same way the filing guard inverted its own: not *which syntax
 * moves*, which is unbounded, but *which tokens name a directory in another
 * worktree*, which is bounded by the file.
 *
 * A path only has to RESOLVE. How it arrived does not matter, which is what
 * makes an unenumerated spelling reach the same verdict as `cd`.
 *
 * ## Why comments are stripped first
 *
 * A script that merely MENTIONS a sibling worktree — a usage line, a comment,
 * a log message — would otherwise be refused for describing the thing rather
 * than doing it. Prose about a subject is the likeliest text to contain the
 * subject's shapes, and the population that writes it is the people
 * documenting the guard. A parity classifier elsewhere in this repository was
 * fooled by exactly that and was caught only by a known-answer control.
 */
function foreignTreeIn(text, bound, cwd) {
  const code = text
    .split("\n")
    .map(line => line.replace(/^\s*#.*$/u, ""))
    .join("\n");
  for (const raw of code.match(/[^\s'";|&()<>]+/gu) ?? []) {
    const token = raw.replace(/^["']|["']$/gu, "");
    if (!token.includes("/")) continue;
    const candidate = isAbsolute(token) ? token : join(cwd, token);
    let root;
    try {
      if (!statSync(candidate).isDirectory()) continue;
      root = worktreeRoot(realpathSync(candidate));
    } catch {
      continue;
    }
    if (root && root !== bound) return root;
  }
  return null;
}

/**
 * The foreign worktree an executed script reaches, or null.
 *
 * ## Why this arm exists at all
 *
 * The check above compares `payload.cwd` against the bound root, and that is
 * the right comparison — but **`payload.cwd` is sampled before the child
 * process runs**. A script that changes directory internally moves AFTER the
 * guard has measured. The guard is not wrong about the target; it is right
 * about a target that stops being the target one instruction later.
 *
 * A measurement taken before execution cannot bind what execution does
 * (CodySwannGT/lisa#3924). So the only thing left is to read what is about to
 * run.
 *
 * ## What this arm does NOT cover, stated rather than implied
 *
 * An INLINE redirect — `cd B && git status`, `git -C B status` — is not
 * refused here. Those are already refused by the runtime's own worktree
 * isolation, and duplicating a control is how two controls drift into
 * disagreeing. The scripted form is the one neither covers, and it is the only
 * cell this arm fills.
 *
 * ## A relative script path is resolved against `payload.cwd`, and that is a
 * KNOWN limitation shared with `parity-safety-net.sh`
 *
 * CodySwannGT/lisa#3933, filed against that guard, is the same defect: a
 * relative token is resolved against the hook process's working directory, not
 * against the directory the command will have once it runs its own leading
 * `cd`. So `cd <other tree> && bash scripts/foo.sh` reads THIS tree's copy of
 * `scripts/foo.sh` and reports on it with full confidence.
 *
 * It matters here for the same reason it matters there: on a machine running
 * many worktrees of one repository, every tree holds its own copy of every
 * script at the same relative path, and they differ by whatever each lane is
 * doing. A confident scan of the wrong copy is wrong in both directions, and
 * the silent one — the copy that will run reaches out, the copy that was read
 * does not — is the direction this arm exists to prevent.
 *
 * NOT fixed here on purpose. #3933 is assigned and its options (honour a
 * leading `cd`, or fail closed when the effective cwd is uncertain) belong in
 * one place rather than two: a second implementation of the same resolution is
 * how two guards drift into disagreeing about which file a command runs.
 * When that lands, this call site should adopt whatever it produces.
 *
 * The exposure here is narrower than there. This arm is reached only after the
 * session has been confirmed to be in its bound worktree, so the common case
 * is a relative path resolving inside the tree the session is actually in.
 *
 * Fails OPEN and says so, like every other undecidable case in this file.
 */
function scriptReachingForeignTree(payload, bound) {
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command) return null;
  for (const segment of command.split(COMMAND_SEPARATORS)) {
    const named = executedPath(segment);
    if (!named) continue;
    const path = isAbsolute(named) ? named : join(payload.cwd, named);
    let text;
    try {
      if (statSync(path).size > SCRIPT_READ_LIMIT) {
        say(`${path} is too large to inspect; NOT enforcing on it`);
        continue;
      }
      text = readFileSync(path, "utf8");
    } catch {
      // Not a readable file: nothing was executed that this can read.
      continue;
    }
    const foreign = foreignTreeIn(text, bound, payload.cwd);
    if (foreign) return { script: path, foreign };
  }
  return null;
}

function reachesOut(script, foreign, bound) {
  return refuse([
    "worktree-binding-guard: this command runs a script that reaches into",
    "another worktree.",
    `  script:    ${script}`,
    `  reaches:   ${foreign}`,
    `  bound to:  ${bound}`,
    "The directory change lives inside the file, so it happens after this",
    "guard has measured where the session is. Run the work from the tree it",
    "belongs to, or acknowledge the move:",
    acceptanceLine(foreign),
  ]);
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
  // Last, and only once the session is provably where it should be: a script
  // that moves somewhere else after this check has already run.
  const reach = scriptReachingForeignTree(payload, observed);
  if (reach) return reachesOut(reach.script, reach.foreign, observed);
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
