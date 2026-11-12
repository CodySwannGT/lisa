#!/usr/bin/env node
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
 * WHY BLOCKING AND NOT A WARNING — FOR WRITES. The failure mode is that nothing
 * feels wrong. There is no symptom to notice, so an advisory line scrolls past
 * exactly when it matters. A refusal is the only form of this check the agent
 * cannot read past.
 *
 * WHY ONLY A WARNING FOR PROVABLE READS (CodySwannGT/lisa#4816). Only a write
 * can damage another session's work, and refusing `git status` or `rg` in a
 * mismatched tree cost a manual acknowledge-and-retry for nothing. So while the
 * trees disagree, a Bash command this guard can PROVE read-only — every
 * statement an allowlisted read shape, see {@link isReadOnlyCommand} — is
 * allowed with a non-blocking warning naming both trees. Everything else,
 * including every command the guard cannot classify, is refused exactly as
 * before. The allowlist fails closed: an unknown program is a write.
 *
 * WHY AN EXPLICIT ACKNOWLEDGEMENT AND NOT "BLOCK ONCE". A guard that blocks the
 * first attempt and lets the retry through is defeated by a blind retry, which
 * is the single most likely next action. So the block stands until the session
 * states, in the acknowledgement, the absolute path it now intends to work in.
 * An acknowledgement can choose the observed root, return to the initial root,
 * or accept a linked target this session was explicitly offered. A selected
 * target does not prove a move: the next guarded call must actually be there.
 *
 * FAILING OPEN, LOUDLY. Missing input or unavailable I/O — no session id, no
 * cwd, not a git repository, an unreadable state file — retains the measured
 * fail-open behavior. A readable state file with missing, mismatched or damaged
 * ownership is a different fact: it cannot authorize a baseline or be silently
 * overwritten. Legacy ambiguity requires explicit intent; a conflicting reserved
 * slot requires a new session identity.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const ACK_AND_SEPARATOR = Symbol("acknowledgement AND separator");
const BINDING_VERSION = 4;
const CURRENT_BINDING = Symbol("current binding state");
const UNAVAILABLE_BINDING = Symbol("unavailable binding read");
const BINDING_WRITE_CONFLICT = Symbol("binding write conflict");

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
    // probe-direction: neutral — this helper REPORTS, it does not decide. Both
    // callers below read null and each one says out loud what it could not do
    // before returning, so no gate outcome follows from this null silently
    // (#3848). Keep that true: a caller added here that spends null as an
    // answer has to say so at its own line.
    return null;
  }
}

/**
 * The worktree root containing `cwd`, or null when `cwd` is not in a repo.
 *
 * `--show-toplevel` exits non-zero for two OPPOSITE reasons and hands back the
 * same nothing for both: `cwd` is outside any repository — a real absence, and
 * a call there is genuinely none of this guard's business — or git could not
 * answer at all, where the binding is unproven rather than inapplicable. Only
 * the second is a withdrawal of enforcement, and it is the one that must not
 * pass for the first. `git --version` succeeds wherever git can run, so its
 * failure is what separates them.
 * @param {string} cwd Directory the tool call runs in.
 * @returns {string|null} Absolute worktree root, or null.
 */
function worktreeRoot(cwd) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  if (top) return resolve(top);
  if (git(["--version"], cwd) === null) {
    say("git could not be run here, so the worktree binding is NOT enforced");
  }
  return null;
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
  if (common) return dirname(resolve(common));
  // Reached only for an `EnterWorktree` naming a worktree, which means a
  // repository was already in hand — so failing here is "could not ask", and
  // the consequence is that the claim goes unrecorded and the NEXT call's
  // displacement check has nothing to compare against. Said out loud rather
  // than returned as a quiet null (#3848).
  say("git could not resolve the main checkout, so this claim is NOT recorded");
  return null;
}

/** Registered roots of the bound repository, with Git path quoting disabled. */
function linkedWorktreeRoots(bound) {
  const listing = git(["worktree", "list", "--porcelain", "-z"], bound);
  if (listing === null) {
    say(
      "git could not identify linked worktrees; repository identity is NOT enforced"
    );
    return null;
  }
  return new Set(
    listing
      .split("\0")
      .filter(record => record.startsWith("worktree "))
      .map(record => realpath(record.slice("worktree ".length)))
  );
}

/** Canonical common Git directory: stable identity across linked checkouts. */
function repositoryIdentity(root) {
  if (typeof root !== "string") return null;
  const common = git(["rev-parse", "--git-common-dir"], root);
  if (common === null) {
    say("git could not compare repository identity; identity is NOT enforced");
    return null;
  }
  return realpath(resolve(root, common));
}

/** A registration is only authoritative while its live repository agrees. */
function isLinkedWorktree(
  bound,
  candidate,
  roots = linkedWorktreeRoots(bound)
) {
  if (!roots?.has(candidate) || worktreeRoot(candidate) !== candidate)
    return false;
  const common = repositoryIdentity(bound);
  return common !== null && common === repositoryIdentity(candidate);
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
  let linkedRoots;
  const code = text
    .split("\n")
    .map(line => line.replace(/^\s*#.*$/u, ""))
    .join("\n");
  for (const raw of code.match(/[^\s'";|&()<>]+/gu) ?? []) {
    const token = raw.replace(/^["']|["']$/gu, "");
    if (!token.includes("/")) continue;
    // A null base means an unliteral `cd` left the directory this script runs
    // from unknown. An ABSOLUTE token is unambiguous either way; a relative one
    // is exactly the thing that cannot be placed, so it is skipped rather than
    // resolved against a directory picked for having been handy.
    if (!isAbsolute(token) && cwd === null) continue;
    const candidate = isAbsolute(token) ? token : join(cwd, token);
    let root;
    try {
      if (!statSync(candidate).isDirectory()) continue;
      root = worktreeRoot(realpathSync(candidate));
    } catch {
      continue;
    }
    if (root && root !== bound) {
      if (linkedRoots === undefined) linkedRoots = linkedWorktreeRoots(bound);
      if (isLinkedWorktree(bound, root, linkedRoots)) return root;
    }
  }
  return null;
}

/**
 * A `cd` target this guard cannot turn into a literal directory.
 *
 * Contract point 3 of `tests/unit/hooks/support/cwd-resolution-corpus.json`
 * spells out the same rule; keep the two in step.
 */
const UNLITERAL_CD_TARGET = /[$`*?[{]/u;

/**
 * The literal target of a leading `cd`, `""` for a bare `cd`, or null when the
 * segment does not change directory.
 *
 * A bare `cd` is `cd "$HOME"`. Leaving the previous directory in place for it
 * would resolve later tokens from a directory the shell has already left.
 * @param segment - One statement from the command
 * @returns The target text, or null when this segment is not a `cd`
 */
function cdTarget(segment) {
  const tokens = tokenise(segment);
  if (tokens.length === 0 || tokens[0] !== "cd") return null;
  return tokens[1] ?? "";
}

/**
 * Apply one `cd` to the directory currently in force.
 *
 * Contract points 1-4 of `cwd-resolution-corpus.json`: a literal target
 * REPLACES the directory rather than joining a list of candidates — the
 * ordering was #3933's entire defect; a relative target composes against the
 * directory in force; a target that is not literal text yields unknown; and
 * unknown is sticky only until the next resolvable `cd`, because this returns
 * a fresh answer for each one.
 * @param current - Directory in force, or null when it is already unknown
 * @param target - Literal `cd` target, `""` for a bare `cd`
 * @returns The new directory, or null when it cannot be known
 */
function applyCd(current, target) {
  const home = homedir();
  let value = target === "" ? home : target;
  if (value === "~") value = home;
  else if (value.startsWith("~/")) value = join(home, value.slice(2));
  if (
    value === "" ||
    value.startsWith("-") ||
    UNLITERAL_CD_TARGET.test(value)
  ) {
    return null;
  }
  if (!isAbsolute(value) && current === null) return null;
  const next = isAbsolute(value) ? resolve(value) : resolve(current, value);
  try {
    return statSync(next).isDirectory() ? next : null;
  } catch {
    return null;
  }
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
 * That reason is a dependency on a runtime Lisa does not ship, and it can
 * expire without anything here failing. It is pinned at
 * {@link VERIFIED_RUNTIME_VERSION} and reported when the runtime moves off it
 * — read that constant before widening this arm.
 *
 * ## A relative script path is resolved against the cwd the command will have
 *
 * A leading `cd` establishes the directory this guard resolves relative tokens
 * from, because that is the directory the shell will be in once the command
 * runs. Resolving against `payload.cwd` instead was CodySwannGT/lisa#3933's
 * defect, inherited here knowingly and fixed in CodySwannGT/lisa#3952: on a
 * machine running many worktrees of one repository, every tree holds its own
 * copy of every script at the same relative path, and they differ by whatever
 * each lane is doing.
 *
 * ## A written contract, driven by a corpus
 *
 * The resolution rule is a written contract with a corpus of adversarial rows
 * this guard is driven over in CI, so a change to the resolver fails a test on
 * the commit that causes it rather than surfacing later as a wrong verdict.
 * Contract and corpus live in `tests/unit/hooks/support/cwd-resolution-corpus.json`
 * (CodySwannGT/lisa#3952). **A behaviour with no row in the corpus is
 * unpinned — add a row when you add a branch.**
 *
 * ## The corpus pins the RESOLUTION, not the verdict
 *
 * When the effective directory cannot be known, this guard declines to resolve
 * the token and fails open, which is the doctrine every other undecidable case
 * in this file follows. The corpus asserts the resolved path rather than the
 * exit code, so the contract stays about resolution.
 *
 * Fails OPEN and says so, like every other undecidable case in this file.
 */
function scriptReachingForeignTree(payload, bound) {
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command) return null;
  let cwd = payload.cwd;
  for (const segment of command.split(COMMAND_SEPARATORS)) {
    const target = cdTarget(segment);
    if (target !== null) {
      cwd = applyCd(cwd, target);
      continue;
    }
    const named = executedPath(segment);
    if (!named) continue;
    if (!isAbsolute(named) && cwd === null) {
      // Contract point 3: the effective directory is unknown, so WHICH copy of
      // a same-named script would run is unknown too. Declining to resolve is
      // the contract; failing open rather than refusing is this guard's own
      // doctrine, and the corpus pins the resolution rather than the verdict.
      say(
        `cannot tell which directory ${named} would run from; NOT enforcing on it`
      );
      continue;
    }
    const path = isAbsolute(named) ? resolve(named) : resolve(cwd, named);
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
    const foreign = foreignTreeIn(text, bound, cwd);
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
    "The access lives inside the file, after this guard measures the session.",
    "Run the work from the tree it belongs to, or acknowledge that target:",
    acceptanceLine(foreign),
    "Then move to the acknowledged tree before further guarded calls.",
  ]);
}

// ---------------------------------------------------------------------------
// Read-only classification for a MISMATCHED session (CodySwannGT/lisa#4816)
//
// Used only once the guard has already decided the session's expected and
// actual worktrees disagree. It answers one question — "is this Bash command
// provably unable to change anything?" — and its only effect is to turn a
// refusal into an allow-with-warning. So every doubt answers "no": an
// unparseable command, an expansion the guard cannot see through, a program
// nobody listed, a listed program given an option that writes or executes.
//
// It is an ALLOWLIST of read shapes, not a denylist of writes. A denylist
// fails open on the write nobody enumerated; this fails closed on the read
// nobody enumerated, which costs one acknowledgement — the pre-#4816
// behaviour — and nothing else.
//
// Tests and builds are deliberately absent even though they mostly read: a
// `bun run test` or `npm run build` executes whatever the package's scripts
// say, writes coverage and build output into the tree it runs in, and is
// exactly the "executing a script that reaches that tree" write class.
// Inspection is enumerated; execution is not.

/** Programs that only read and print, whatever operands they are given. */
const PURE_READERS = new Set([
  "basename",
  "cat",
  "cksum",
  "cmp",
  "column",
  "comm",
  "cut",
  "df",
  "diff",
  "dirname",
  "du",
  "echo",
  "egrep",
  "false",
  "fgrep",
  "fold",
  "grep",
  "head",
  "id",
  "jq",
  "ls",
  "md5",
  "md5sum",
  "nl",
  "od",
  "printenv",
  "printf",
  "pwd",
  "readlink",
  "realpath",
  "rev",
  "sha1sum",
  "sha256sum",
  "sha512sum",
  "shasum",
  "sleep",
  "stat",
  "strings",
  "tac",
  "tail",
  "test",
  "tr",
  "true",
  "type",
  "uname",
  "wc",
  "which",
  "whoami",
]);

/** A command word this guard will look up: a bare name, never a path. */
const COMMAND_WORD = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/u;

/** Whether a short-option cluster (`-abc`) contains `letter`. */
function shortCluster(arg, letter) {
  return /^-[^-]/u.test(arg) && arg.includes(letter);
}

/** `find` primaries that execute, delete, or write a file. */
const FIND_WRITES = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-fls",
  "-fprint",
  "-fprint0",
  "-fprintf",
  "-ok",
  "-okdir",
]);

/** Git subcommands that only read the repository. */
const GIT_READS = new Set([
  "annotate",
  "blame",
  "cat-file",
  "check-attr",
  "check-ignore",
  "cherry",
  "count-objects",
  "describe",
  "diff",
  "diff-files",
  "diff-index",
  "diff-tree",
  "for-each-ref",
  "grep",
  "help",
  "log",
  "ls-files",
  "ls-remote",
  "ls-tree",
  "merge-base",
  "name-rev",
  "range-diff",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-branch",
  "show-ref",
  "status",
  "var",
  "version",
  "whatchanged",
]);

/** Git options, before the subcommand, that change nothing. */
const GIT_SAFE_GLOBALS = new Set([
  "--bare",
  "--literal-pathspecs",
  "--no-optional-locks",
  "--no-pager",
  "--no-replace-objects",
  "-P",
]);

/** Options that put `git branch` / `git tag` in list mode. */
const GIT_LIST_MODE = new Set([
  "--contains",
  "--list",
  "--merged",
  "--no-contains",
  "--no-merged",
  "--points-at",
  "-l",
]);

/** Options `git branch` / `git tag` accept without creating or deleting. */
const GIT_LIST_OPTIONS = new Set([
  ...GIT_LIST_MODE,
  "--all",
  "--color",
  "--column",
  "--ignore-case",
  "--no-color",
  "--no-column",
  "--remotes",
  "--show-current",
  "--verbose",
  "-a",
  "-i",
  "-r",
  "-v",
  "-vv",
]);

/** `--opt=value` filters that, like their bare forms, imply list mode. */
const GIT_LIST_FILTER_PREFIXES = [
  "--contains=",
  "--merged=",
  "--no-contains=",
  "--no-merged=",
  "--points-at=",
];

/** Prefixes of `--opt=value` spellings that only shape a listing. */
const GIT_LIST_VALUE_PREFIXES = [
  ...GIT_LIST_FILTER_PREFIXES,
  "--color=",
  "--format=",
  "--sort=",
];

/** `git config` options that read a value. */
const GIT_CONFIG_READS = new Set([
  "--get",
  "--get-all",
  "--get-color",
  "--get-colorbool",
  "--get-regexp",
  "--get-urlmatch",
  "--list",
  "-l",
]);

/** `git config` options that write, whatever else is present. */
const GIT_CONFIG_WRITES = new Set([
  "--add",
  "--edit",
  "--remove-section",
  "--rename-section",
  "--replace-all",
  "--unset",
  "--unset-all",
  "-e",
]);

/** `git branch` / `git tag` in list mode, with no creating option. */
function gitListing(args) {
  const known = args.every(
    arg =>
      !arg.startsWith("-") ||
      GIT_LIST_OPTIONS.has(arg) ||
      /^-n\d*$/u.test(arg) ||
      GIT_LIST_VALUE_PREFIXES.some(prefix => arg.startsWith(prefix))
  );
  const listing =
    !args.some(arg => !arg.startsWith("-")) ||
    args.some(
      arg =>
        GIT_LIST_MODE.has(arg) ||
        GIT_LIST_FILTER_PREFIXES.some(prefix => arg.startsWith(prefix))
    );
  return known && listing;
}

/** The first argument that is not an option, or undefined. */
function firstOperand(args) {
  return args.find(arg => !arg.startsWith("-"));
}

/** Git subcommands that read only in some forms, each with its reading test. */
const GIT_CONDITIONAL_READS = new Map([
  ["branch", gitListing],
  ["tag", gitListing],
  [
    "remote",
    args => {
      const operand = firstOperand(args);
      return operand === undefined
        ? args.every(arg => arg === "-v" || arg === "--verbose")
        : operand === "get-url" || operand === "show";
    },
  ],
  ["stash", args => args[0] === "list" || args[0] === "show"],
  ["worktree", args => args[0] === "list"],
  ["reflog", args => [undefined, "show"].includes(firstOperand(args))],
  [
    "config",
    args =>
      args[0] === "get" ||
      args[0] === "list" ||
      (args.some(arg => GIT_CONFIG_READS.has(arg)) &&
        !args.some(arg => GIT_CONFIG_WRITES.has(arg))),
  ],
]);

/**
 * A git invocation that only reads.
 *
 * `-c` is refused rather than skipped: `-c core.fsmonitor=<cmd>` and friends
 * execute programs, and a guard that read past it would be read past.
 */
function gitReadOnly(args) {
  let index = 0;
  while (index < args.length && args[index].startsWith("-")) {
    const arg = args[index];
    if (arg === "-C") index += 2;
    else if (
      GIT_SAFE_GLOBALS.has(arg) ||
      arg.startsWith("--git-dir=") ||
      arg.startsWith("--work-tree=")
    )
      index += 1;
    else return false;
  }
  const [subcommand, ...rest] = args.slice(index);
  if (subcommand === undefined) return false;
  // `--output=<file>` writes for diff/log/show; `-O` runs a pager program.
  if (rest.some(arg => arg.startsWith("--output") || arg.startsWith("-O")))
    return false;
  if (GIT_READS.has(subcommand)) return true;
  return GIT_CONDITIONAL_READS.get(subcommand)?.(rest) ?? false;
}

/** `gh` verbs that only fetch and print. `gh api` can POST, so it is out. */
const GH_READ_VERBS = new Set([
  "checks",
  "diff",
  "list",
  "status",
  "view",
  "watch",
]);

/** A `gh <noun> <verb>` invocation whose verb only reads. */
function ghReadOnly(args) {
  const [noun, verb] = args.filter(arg => !arg.startsWith("-"));
  return noun !== "api" && GH_READ_VERBS.has(verb);
}

/**
 * One sed command that only prints: an optional address or range, an optional
 * `!`, then `p d l q Q = n N`, or an `s///` whose flags write nothing. The
 * `w` and `e` flags and commands — the ones that write a file or execute one —
 * are absent from the grammar rather than denied by it.
 */
const SED_ADDRESS = String.raw`(?:\d+(?:~\d+)?|\$|/(?:\\.|[^/\\\n])*/I?)`;
const SED_READ_SCRIPT = new RegExp(
  String.raw`^\s*(?:${SED_ADDRESS}(?:\s*,\s*(?:${SED_ADDRESS}|[+~]\d+))?)?\s*!?\s*` +
    String.raw`(?:[pdlqQ=nN]|s([^\s\\])(?:\\.|(?!\1)[^\\\n])*\1(?:\\.|(?!\1)[^\\\n])*\1[gpiImM\d]*)\s*$`,
  "u"
);

/** sed short options that neither edit in place nor read a script file. */
const SED_SAFE_FLAGS = /^[nErsuz]*$/u;

/** sed long options that neither edit in place nor read a script file. */
const SED_SAFE_LONG = new Set([
  "--debug",
  "--null-data",
  "--posix",
  "--quiet",
  "--regexp-extended",
  "--sandbox",
  "--separate",
  "--silent",
  "--unbuffered",
]);

/**
 * A sed invocation that only prints. Every script must be literal text in
 * {@link SED_READ_SCRIPT}'s grammar; `-i` and `-f` are refused outright.
 */
function sedReadOnly(words) {
  const scripts = [];
  const operands = [];
  for (let index = 0; index < words.length; index += 1) {
    const { text } = words[index];
    if (text === "--expression" || text === "-e") {
      scripts.push(words[(index += 1)]);
    } else if (text.startsWith("--expression=")) {
      scripts.push({ ...words[index], text: text.slice(13) });
    } else if (text.startsWith("--")) {
      if (!SED_SAFE_LONG.has(text)) return false;
    } else if (text.startsWith("-") && text.length > 1) {
      const letters = text.slice(1);
      const scriptAt = letters.indexOf("e");
      const flags = scriptAt === -1 ? letters : letters.slice(0, scriptAt);
      if (!SED_SAFE_FLAGS.test(flags)) return false;
      if (scriptAt !== -1) {
        const attached = text.slice(scriptAt + 2);
        scripts.push(
          attached ? { ...words[index], text: attached } : words[(index += 1)]
        );
      }
    } else operands.push(words[index]);
  }
  if (scripts.length === 0 && operands.length > 0) scripts.push(operands[0]);
  return (
    scripts.length > 0 &&
    scripts.every(
      script => script?.exact === true && SED_READ_SCRIPT.test(script.text)
    )
  );
}

/**
 * An awk invocation that only prints. Its program must be literal and free of
 * the three ways awk reaches outside itself: `>` (write a file), `|` (pipe to
 * or from a command), and `system`/`getline`.
 */
function awkReadOnly(words) {
  let index = 0;
  while (index < words.length && words[index].text.startsWith("-")) {
    const { text } = words[index];
    if (text === "--") {
      index += 1;
      break;
    }
    if (text === "-F" || text === "-v") index += 2;
    else if (text.startsWith("-F") || text.startsWith("-v")) index += 1;
    else return false;
  }
  const program = words[index];
  return program?.exact === true && !/[>|]|system|getline/u.test(program.text);
}

/** xargs flags that take no value. */
const XARGS_FLAGS = new Set([
  "--exit",
  "--no-run-if-empty",
  "--null",
  "--verbose",
  "-0",
  "-r",
  "-t",
  "-x",
]);

/** xargs options whose value is the next word or attached (`-n1`). */
const XARGS_VALUE_OPTIONS = new Set([
  "-E",
  "-I",
  "-J",
  "-L",
  "-P",
  "-R",
  "-S",
  "-d",
  "-n",
  "-s",
]);

/**
 * xargs running a pure reader. The items arrive on stdin and could be any
 * option, so only a program no option can turn into a writer qualifies.
 */
function xargsReadOnly(words) {
  let index = 0;
  while (index < words.length && words[index].text.startsWith("-")) {
    const { text } = words[index];
    if (XARGS_FLAGS.has(text)) index += 1;
    else if (XARGS_VALUE_OPTIONS.has(text)) index += 2;
    else if (XARGS_VALUE_OPTIONS.has(text.slice(0, 2))) index += 1;
    else return false;
  }
  const inner = words[index];
  return inner?.exact === true && PURE_READERS.has(inner.text);
}

/**
 * Programs that read unless given a particular option, each with the test that
 * its arguments contain none. Each test sees only the argument texts; a word
 * whose leading text is an expansion never reaches it (see {@link optionVisible}).
 */
const CHECKED_READERS = new Map([
  ["awk", awkReadOnly],
  [
    "date",
    words =>
      !words.some(
        ({ text }) => text.startsWith("--set") || shortCluster(text, "s")
      ),
  ],
  [
    "file",
    words =>
      !words.some(
        ({ text }) => text === "--compile" || shortCluster(text, "C")
      ),
  ],
  ["find", words => !words.some(({ text }) => FIND_WRITES.has(text))],
  ["gh", words => ghReadOnly(words.map(({ text }) => text))],
  ["git", words => gitReadOnly(words.map(({ text }) => text))],
  [
    "rg",
    words =>
      !words.some(
        ({ text }) =>
          text.startsWith("--pre") || text.startsWith("--hostname-bin")
      ),
  ],
  ["sed", sedReadOnly],
  [
    "sort",
    words =>
      !words.some(
        ({ text }) =>
          text.startsWith("--output") ||
          text.startsWith("--compress-program") ||
          shortCluster(text, "o")
      ),
  ],
  ["tree", words => !words.some(({ text }) => shortCluster(text, "o"))],
  ["xargs", xargsReadOnly],
]);

/**
 * Whether the guard can see if this word is an option.
 *
 * An exact word is what the program receives. A word that STARTS with literal
 * text other than `-` cannot become an option however its tail expands. A
 * word that starts with an expansion — `"$X"`, `*` — could become `--pre=…` or
 * `-i`, so a program with a writing option cannot be cleared past it.
 */
function optionVisible(word) {
  return word.exact || (word.leading && !word.text.startsWith("-"));
}

/** One statement: a literal command word, then a listed read shape. */
function isReadOnlyStatement(words) {
  const [head, ...args] = words;
  if (!head.exact || !COMMAND_WORD.test(head.text)) return false;
  if (head.text === "cd" || PURE_READERS.has(head.text)) return true;
  const check = CHECKED_READERS.get(head.text);
  return check !== undefined && args.every(optionVisible) && check(args);
}

/**
 * Consume one redirection operator starting at `index` (a `<`, `>`, or the
 * `&` of `&>`), returning the index after its target, or -1 when the
 * redirection may write or cannot be read. Input redirections read; output
 * is allowed only as an fd duplication (`2>&1`, `>&2`, `1>&-`) or into
 * `/dev/null`.
 */
function skipRedirect(text, index) {
  const output = text[index] !== "<";
  let at = index + (text[index] === "&" ? 2 : 1);
  if (!output && "<>(".includes(text[at] ?? "")) return -1;
  if (output && (text[at] === ">" || text[at] === "|")) at += 1;
  if (text[at] === "(") return -1;
  if (text[at] === "&") {
    const dup = /^(?:\d+|-)/u.exec(text.slice(at + 1));
    return dup ? at + 1 + dup[0].length : -1;
  }
  while (text[at] === " " || text[at] === "\t") at += 1;
  const target = /^[^\s;|&<>()]+/u.exec(text.slice(at));
  if (!target) return -1;
  // Reading any file changes nothing; writing is cleared only into /dev/null.
  if (output && target[0].replace(/^(["'])(.*)\1$/u, "$2") !== "/dev/null")
    return -1;
  return at + target[0].length;
}

/**
 * Split a Bash command into statements of words, or null when the command
 * uses anything this lexer will not reason about: command or process
 * substitution, subshells, here-documents, an unterminated quote, or a
 * redirection that may write.
 *
 * Each word records whether it is EXACT (no expansion or glob can change it)
 * and whether its LEADING character is literal text, which together decide
 * whether an option could hide inside it.
 */
function lexStatements(command) {
  const statements = [[]];
  let word = null;
  let quote = null;
  const begin = () => {
    word ??= { text: "", exact: true, leading: null };
  };
  const add = (char, literal) => {
    begin();
    if (word.leading === null) word.leading = literal;
    if (!literal) word.exact = false;
    word.text += char;
  };
  const finish = () => {
    if (word)
      statements.at(-1).push({ ...word, leading: word.leading ?? true });
    word = null;
  };
  const split = () => {
    finish();
    statements.push([]);
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (quote === "'") {
      if (char === "'") quote = null;
      else add(char, true);
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "`" || (char === "$" && next === "(")) return null;
      else if (
        char === "\\" &&
        next !== undefined &&
        '"\\$`\n'.includes(next)
      ) {
        index += 1;
        if (next !== "\n") add(next, true);
      } else add(char, char !== "$");
    } else if (char === "\\") {
      if (next === undefined) return null;
      index += 1;
      if (next !== "\n") add(next, true);
    } else if (char === "'" || char === '"') {
      begin();
      quote = char;
    } else if (char === " " || char === "\t") finish();
    else if (char === "\n" || char === ";") split();
    else if (char === "|") {
      if (next === "|" || next === "&") index += 1;
      split();
    } else if (char === "&" && next !== ">") {
      if (next === "&") index += 1;
      split();
    } else if (char === ">" || char === "<" || char === "&") {
      // A word of bare digits touching the operator is its fd, not an operand.
      if (word && word.exact && /^\d+$/u.test(word.text)) word = null;
      else finish();
      const after = skipRedirect(command, index);
      if (after === -1) return null;
      index = after - 1;
    } else if ("`()".includes(char) || (char === "$" && next === "(")) {
      return null;
    } else if (char === "#" && word === null) {
      while (index + 1 < command.length && command[index + 1] !== "\n")
        index += 1;
    } else add(char, !"$*?[{".includes(char));
  }
  if (quote !== null) return null;
  finish();
  return statements.filter(statement => statement.length > 0);
}

/**
 * Whether this Bash command provably changes nothing: every statement in it
 * is a listed read shape. Unparseable means no.
 * @param {string} command - The Bash command, as the hook received it
 * @returns {boolean} True only for a command proven read-only
 */
function isReadOnlyCommand(command) {
  const statements = lexStatements(command);
  return (
    statements !== null &&
    statements.length > 0 &&
    statements.every(isReadOnlyStatement)
  );
}

/**
 * Whether a guarded call is a provable read. Write/Edit/MultiEdit are writes by
 * definition; only a Bash command can be cleared, and only by proof.
 */
function isReadOnlyCall(payload) {
  const command = payload.tool_input?.command;
  return (
    payload.tool_name === "Bash" &&
    typeof command === "string" &&
    isReadOnlyCommand(command)
  );
}

/**
 * Allow a provable read in a mismatched worktree, and say so to the agent.
 *
 * ## The channel, per agent — and where it stops
 *
 * stderr on exit 0 reaches a transcript, not the model, so on Claude Code the
 * warning is ALSO printed as PreToolUse JSON in
 * `hookSpecificOutput.additionalContext` — the channel
 * `operational-hazards.mjs` and `block-migration-edits.sh` use. No
 * `permissionDecision` is emitted: "allow" would also skip the user's
 * permission prompt, a wider grant than "this guard does not refuse".
 *
 * The JSON is printed ONLY where `CLAUDECODE` is set, the one runtime measured
 * to read that shape on PreToolUse. Codex was measured NOT to honour
 * PreToolUse `additionalContext` (see `src/codex/scripts/block-migration-edits.sh`),
 * and Cursor and Copilot were never measured reading it. On those the read is
 * allowed with the warning on stderr only, which is NOT known to reach the
 * model. That is a documented gap in the warning, never in the block: a write
 * is refused identically on every agent this guard runs on. Devin sends no
 * `cwd`, so this guard does not run there at all; OpenCode and Antigravity do
 * not ship it (see the wrapper's parity note).
 * @param {string} expected - The worktree the session believes it is in
 * @param {string} observed - The worktree this call actually runs in
 * @param {boolean} claimed - Whether `expected` came from EnterWorktree
 * @returns {number} Always 0: the read is allowed
 */
function warnRead(expected, observed, claimed) {
  const notice = [
    "worktree-binding-guard: allowed a READ-ONLY command in a worktree this session is not bound to.",
    claimed
      ? `  EnterWorktree claimed: ${expected}`
      : `  bound to:  ${expected}`,
    `  acting in: ${observed}`,
    "Another session may own that worktree and its uncommitted work. This call was",
    "allowed only because it is provably read-only; any write there — file edits,",
    "redirects, git commit/checkout/reset/stash, package installs, running a",
    "script — is still refused. Use absolute paths under the tree you mean.",
  ].join("\n");
  process.stderr.write(`${notice}\n`);
  if (process.env.CLAUDECODE) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: notice,
        },
      })}\n`
    );
  }
  return 0;
}

function stateFile(bindingKey) {
  const home = process.env.LISA_STATE_HOME || join(homedir(), ".lisa");
  return join(home, "worktree-binding", `${bindingKey}.json`);
}

/**
 * Percent-escape every byte that is not filename-safe, so the output cannot
 * contain `-` at all and two escaped parts can be joined on `--` without the
 * joiner ever being smuggled in from either side.
 *
 * `:` and friends are folded too — the key lands in a filename and `:` is
 * illegal on Windows/NTFS (CodySwannGT/lisa#4277). `encodeURIComponent`
 * leaves `! ' ( ) *` alone, and `*` is equally illegal on Windows, so they
 * are escaped by hand.
 * @param {string} value - One component of the binding key
 * @returns {string} A component containing only `[A-Za-z0-9._~]` and `%XX`
 */
function keyPart(value) {
  return encodeURIComponent(value)
    .replaceAll(
      /[!'()*]/g,
      c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
    )
    .replaceAll("-", "%2D");
}

/**
 * The identity a binding belongs to.
 *
 * Parallel subagents share the session's `session_id`, so keying the binding
 * on it alone made each subagent's guarded call read the binding a sibling
 * recorded — the sibling's worktree then read as "changed underneath it" and
 * its writes were refused, or an acknowledgement rebound the file out from
 * under the sibling (CodySwannGT/lisa#4277). The payload's `agent_id` is what
 * distinguishes a subagent from the main agent, so a caller carrying one gets
 * its own state file. The main agent carries no `agent_id` and uses a null
 * agent component, also the fallback for runtimes that never send the field.
 *
 * v4 hashes the JSON tuple into a lowercase, bounded filename in its own
 * directory. The digest fixes filename size and casing; the persisted exact
 * tuple remains the authority. A conflicting owner in a reserved slot is
 * refused, never overwritten. Earlier flat filenames were ambiguous across
 * formats (CodySwannGT/lisa#4311).
 * @param {object} payload - Native hook identity
 * @returns {[string, string|null]} Session and normalized optional agent
 */
function bindingIdentity(payload) {
  const agent = payload?.agent_id;
  return [
    payload.session_id,
    typeof agent === "string" && agent ? agent : null,
  ];
}

/**
 * Resolve the reserved slot without exposing filename-unsafe identity bytes.
 * @param {object} payload - Native hook identity
 * @returns {string} Versioned, bounded relative state-file stem
 */
function bindingKey(payload) {
  const digest = createHash("sha256")
    .update(JSON.stringify(bindingIdentity(payload)))
    .digest("hex");
  return join(`v${BINDING_VERSION}`, digest);
}

/**
 * The keys earlier versions wrote for this payload, newest first.
 *
 * The v1 key was the raw `session_id` (single shared file per session). v2
 * joined sanitized session and agent on `--`; v3 escaped both components.
 * All are inspected on upgrade, but only a matching v4 owner record grants
 * authority. An unstamped file cannot distinguish its possible owners, so the
 * guard requires explicit intent rather than guessing or silently re-baselining.
 * Legacy files stay untouched and only safe filename stems are inspected.
 * @param {object} payload - The hook payload
 * @returns {string[]} Zero or more legacy keys this payload may have written
 */
function legacyKeys(payload) {
  const agent = payload?.agent_id;
  const session = payload.session_id;
  const perAgent = typeof agent === "string" && agent;
  const san = value => value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  const older = perAgent ? `${san(session)}--${san(agent)}` : session;
  let escaped = null;
  try {
    escaped = perAgent
      ? `${keyPart(session)}--${keyPart(agent)}`
      : keyPart(session);
  } catch {
    // A lone surrogate could not have produced an escaped v3 filename.
  }
  return [...new Set([escaped, older])].filter(
    key => typeof key === "string" && key && !/[\\/]/u.test(key)
  );
}

/**
 * Require the producer's version, exact tuple and an absolute binding root.
 * A matching identity with a damaged root cannot authorize re-baselining.
 * @param {object|null} state - Parsed local state
 * @param {object} payload - Caller claiming the slot
 * @returns {boolean} Whether the record identifies this caller
 */
function ownsState(state, payload) {
  const expected = bindingIdentity(payload);
  return (
    typeof state?.boundRoot === "string" &&
    isAbsolute(state.boundRoot) &&
    !state.boundRoot.includes("\0") &&
    state?.bindingVersion === BINDING_VERSION &&
    Array.isArray(state.bindingIdentity) &&
    state.bindingIdentity.length === expected.length &&
    state.bindingIdentity.every((part, index) => part === expected[index])
  );
}

function readState(bindingKeyValue, payload) {
  try {
    const state = JSON.parse(readFileSync(stateFile(bindingKeyValue), "utf8"));
    return ownsState(state, payload)
      ? { ...state, [CURRENT_BINDING]: true }
      : { unverifiedOwner: true, canonicalConflict: true };
  } catch (error) {
    if (error instanceof SyntaxError)
      return { unverifiedOwner: true, canonicalConflict: true };
    // Unavailable I/O proves neither absence nor conflicting ownership. Keep
    // it separate so an exclusive write cannot mistake EACCES for a race.
    if (error.code !== "ENOENT")
      return { [UNAVAILABLE_BINDING]: error.message };
  }
  let ambiguous = false;
  for (const key of legacyKeys(payload)) {
    try {
      const state = JSON.parse(readFileSync(stateFile(key), "utf8"));
      if (ownsState(state, payload)) return state;
      ambiguous = true;
    } catch (error) {
      if (error instanceof SyntaxError) ambiguous = true;
      // Not written under this key — try the next older one.
    }
  }
  return ambiguous ? { unverifiedOwner: true } : null;
}

/**
 * Write the session's binding state, MERGING over whatever is already there.
 *
 * Explicit `claimedRoot: null` still clears a claim. Merging means that a
 * field one writer owns is not silently dropped by
 * another writer that had no opinion about it: `runtimeNoticed` is written by
 * {@link noticeRuntimeDrift} and read by nobody else, and a clobbering write
 * would turn its "reported once" into "reported again after the next
 * acknowledgement", which is the noise the notice is designed not to be.
 * @param bindingKeyValue - The key whose state file this is
 * @param state - Fields to write over the recorded state
 * @param payload - The hook payload, for legacy-key reads while a binding is
 *   migrating to the current key format
 * @param options - Validated acknowledgement or create-only baseline intent
 * @returns True on success, false for unavailable I/O, or a conflict sentinel
 */
function writeState(bindingKeyValue, state, payload, options = {}) {
  const file = stateFile(bindingKeyValue);
  const previous = readState(bindingKeyValue, payload);
  if (previous?.[UNAVAILABLE_BINDING]) {
    say(
      `could not read the binding (${previous[UNAVAILABLE_BINDING]}); NOT enforcing`
    );
    return false;
  }
  if (
    (options.createOnly && previous) ||
    previous?.canonicalConflict ||
    (previous?.unverifiedOwner && !options.acceptUnowned)
  )
    return BINDING_WRITE_CONFLICT;
  const proven = previous?.unverifiedOwner ? null : previous;
  // A runtime notice alone cannot establish a binding after a failed baseline.
  // Every record we produce must satisfy the same authority check as a read.
  const next = {
    ...proven,
    ...state,
    bindingVersion: BINDING_VERSION,
    bindingIdentity: bindingIdentity(payload),
  };
  if (!ownsState(next, payload)) return false;
  const originalRoot =
    proven?.originalRoot ?? proven?.boundRoot ?? state.boundRoot;
  const originalCommonDir =
    proven?.originalCommonDir ?? repositoryIdentity(originalRoot);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          ...next,
          // Preserve the initial root after intentional rebinds. A legacy
          // state's established root is its only proven recovery anchor.
          originalRoot,
          originalCommonDir,
        },
        null,
        2
      )}\n`,
      { flag: previous?.[CURRENT_BINDING] ? "w" : "wx" }
    );
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return BINDING_WRITE_CONFLICT;
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
 * Record where the session STARTED, so its first guarded call is checked
 * against a baseline rather than establishing one.
 *
 * ## Why the first call could not be checked before
 *
 * It established the baseline instead of testing one, which is
 * trust-on-first-use — and TOFU is only as safe as its first use. Here the
 * first use is assigned by the harness, unasked (CodySwannGT/lisa#3864), so the
 * one moment the guard trusted was the moment the session had least control
 * over. A session already sitting in a foreign worktree when it first acted
 * bound to that tree and was never refused, and every later call was then
 * checked faithfully against the wrong baseline — defending the session INTO
 * the wrong worktree rather than out of it (CodySwannGT/lisa#3955).
 *
 * ## Why an earlier observation separates what a cleverer check cannot
 *
 * At the first guarded call, "I was displaced before I acted" and "I
 * legitimately started here" present identically: one session id, one observed
 * root, no prior state. No comparison can tell them apart, because the
 * information is not in the hook's inputs at that instant.
 *
 * At session start it is. The displacement mechanism actually observed is a
 * PEER's `EnterWorktree` moving this session (CodySwannGT/lisa#3712), which
 * happens during the session — after it has started. A baseline taken at start
 * is therefore recorded BEFORE the event that moves it, and the first guarded
 * call becomes an ordinary comparison against a baseline that already exists.
 * It reaches the same refusal a later displacement produces, because by then it
 * is one.
 *
 * ## What this does NOT achieve
 *
 * #3955 asks for a baseline from the ASSIGNER rather than from observation.
 * That is not what this is and Lisa cannot build it: Lisa does not own
 * `EnterWorktree`, and nothing the harness writes names a session's assigned
 * worktree in a form a hook can read. This is still an observation, just an
 * earlier one. It closes the window between session start and the first guarded
 * call; it leaves open a session LAUNCHED already displaced, where start
 * observes the foreign tree and trust-on-first-use still applies.
 *
 * Returns nothing on purpose, like its sibling below: SessionStart has no call
 * to refuse, so every path through it allows.
 * @param bindingKeyValue - The key this baseline belongs to
 * @param observed - The worktree root the session started in
 * @param payload - The hook payload, for legacy-key reads
 */
function recordBaseline(bindingKeyValue, observed, payload) {
  // Never overwrite. A resumed session, a reconnect, or anything else that
  // fires the event twice must not be able to launder a displaced binding into
  // a fresh baseline — which is the whole failure this exists to close.
  const previous = readState(bindingKeyValue, payload);
  if (previous?.boundRoot || previous?.unverifiedOwner) return;
  writeState(
    bindingKeyValue,
    {
      boundRoot: observed,
      claimedRoot: null,
      updatedAt: new Date().toISOString(),
    },
    payload,
    { createOnly: true }
  );
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
  const previous = readState(bindingKey(payload), payload);
  if (previous?.unverifiedOwner) return;
  writeState(
    bindingKey(payload),
    {
      boundRoot: previous?.boundRoot ?? observed,
      claimedRoot: claimed,
      updatedAt: new Date().toISOString(),
    },
    payload,
    { createOnly: !previous }
  );
}

function refuse(lines) {
  process.stderr.write(`${lines.join("\n")}\n`);
  return 2;
}

/** Refuse an action whose binding changed while its creation was in flight. */
function bindingWriteConflict() {
  return refuse([
    "worktree-binding-guard: another hook recorded this session's binding during this call.",
    "The existing file has been preserved. Retry the call to check its established binding.",
  ]);
}

function acceptanceLine(observed) {
  const literal = `${ACCEPT_PREFIX} ${observed}`.replaceAll("'", "'\\''");
  return `  echo '${literal}'`;
}

/**
 * Explain a real ownership ambiguity without treating a stranger's root as fact.
 * @param {object} state - Unverified-state sentinel, containing no imported fields
 * @param {string|null} observed - Measured checkout
 * @returns {number} Blocking native-hook status
 */
function unownedBinding(state, observed) {
  return refuse([
    "worktree-binding-guard: cannot prove this binding belongs to this session.",
    "The existing file has no matching owner record. It has not been imported or changed.",
    ...(state.canonicalConflict
      ? [
          "This session's reserved state file identifies another owner or an unknown format.",
          "Start a new session with its own identity; acknowledging cannot overwrite that file.",
        ]
      : [
          "Choose the worktree you intend to use by acknowledging its measured path:",
          acceptanceLine(observed),
        ]),
  ]);
}

/** Read literal shell words and AND separators without evaluating expansions. */
function acknowledgementWords(text) {
  const words = [];
  let word = "",
    active = false,
    quote = null;
  const emit = () => {
    if (active) words.push(word);
    word = "";
    active = false;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      continue;
    }
    if (char === "\\") {
      const next = text[index + 1];
      if (next === undefined) return null;
      if (quote === '"' && !['"', "\\", "$", "`", "\n"].includes(next)) {
        word += char;
        continue;
      }
      index += 1;
      if (next !== "\n") {
        word += next;
        active = true;
      }
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "$" || char === "`") return null;
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      active = true;
    } else if (char === " " || char === "\t") emit();
    else if (char === "\n") return null;
    else if (char === "&" && text[index + 1] === "&") {
      emit();
      words.push(ACK_AND_SEPARATOR);
      index += 1;
    } else if (/[&;|<>$`*?[\]{}()]/u.test(char)) return null;
    else {
      word += char;
      active = true;
    }
  }
  if (quote !== null) return null;
  emit();
  return words;
}

/** Strip only actual shell edge whitespace in linear time. */
function acknowledgementText(command) {
  let start = 0,
    end = command.length;
  while (start < end && " \t\n".includes(command[start])) start += 1;
  while (end > start && " \t\n".includes(command[end - 1])) end -= 1;
  return command.slice(start, end);
}

/** A literal echo, optionally preceded by a literal cd to the stated root. */
function acceptanceRequest(command) {
  const text = acknowledgementText(command);
  const words = acknowledgementWords(text.replace(/;$/u, ""));
  if (!words) return null;
  const direct = words.length === 2 && words[0] === "echo";
  const moving =
    words.length === 5 &&
    words[0] === "cd" &&
    typeof words[1] === "string" &&
    words[2] === ACK_AND_SEPARATOR &&
    words[3] === "echo";
  if (!direct && !moving) return null;
  const message = words.at(-1);
  if (typeof message !== "string" || !message.startsWith(`${ACCEPT_PREFIX} `))
    return null;
  const stated = message.slice(ACCEPT_PREFIX.length + 1);
  // The printed protocol names absolute roots. Empty/relative operands and
  // cd's special ~, -, or -- forms cannot authorize a move.
  if (!isAbsolute(stated)) return null;
  const path = realpath(stated);
  const destination =
    moving && isAbsolute(words[1]) ? realpath(words[1]) : null;
  return {
    path,
    validMove: !moving || (destination !== null && destination === path),
  };
}

/**
 * Validate the initial recovery root against the identity captured at baseline.
 * The current checkout may have been removed or deliberately rebound elsewhere.
 */
function isOriginalRoot(state, path) {
  const original = state?.originalRoot ?? state?.boundRoot;
  if (path !== original || worktreeRoot(path) !== path) return false;
  // Older state can only prove the repository of its established binding.
  const common = state.originalCommonDir ?? repositoryIdentity(state.boundRoot);
  return common !== null && common === repositoryIdentity(path);
}

/** Acknowledgements select intent; the next call must prove actual movement. */
function handleAcceptance(payload, observed) {
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !command.includes(ACCEPT_PREFIX))
    return null;
  const request = acceptanceRequest(command);
  if (!request) return null;
  const { path, validMove } = request;
  const previous = readState(bindingKey(payload), payload);
  if (previous?.canonicalConflict) return unownedBinding(previous, observed);
  const original = previous?.originalRoot ?? previous?.boundRoot;
  const recovering = isOriginalRoot(previous, path);
  const offered =
    path === previous?.offeredRoot &&
    isLinkedWorktree(previous.boundRoot, path);
  if (!validMove || (path !== observed && !recovering && !offered)) {
    const suggestion = observed ?? original;
    return refuse([
      `worktree-binding-guard: this acknowledgement names ${path ?? "no path"},`,
      "but it is not a valid move to the observed, original, or offered worktree. Not rebinding.",
      ...(suggestion
        ? [
            "Acknowledge the measured or original worktree:",
            acceptanceLine(suggestion),
          ]
        : []),
    ]);
  }
  const written = writeState(
    bindingKey(payload),
    {
      boundRoot: path,
      claimedRoot: null,
      offeredRoot: null,
      updatedAt: new Date().toISOString(),
    },
    payload,
    { acceptUnowned: true }
  );
  if (written === BINDING_WRITE_CONFLICT) return bindingWriteConflict();
  if (written)
    say(
      path === observed
        ? `bound to ${path}`
        : `binding set to ${path}; move there before further guarded calls`
    );
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

/**
 * The runtime version the inline-redirect gap was last verified at.
 *
 * ## What this constant is a pin ON
 *
 * This guard deliberately does NOT refuse an INLINE redirect into another
 * worktree — `cd <other> && git …`, `git -C <other> …`. The reason is good and
 * is written out at {@link scriptReachingForeignTree}: the runtime's own
 * worktree isolation already refuses them, and duplicating a control is how two
 * controls drift into disagreeing about the same command.
 *
 * That reason is a DEPENDENCY on behaviour Lisa does not ship. It was verified
 * refusing at this version, with the refusal wording "this command names git in
 * a form too complex to verify that it stays inside the worktree" and
 * "redirects git to the shared checkout via -C".
 *
 * ## Why a pin rather than a test
 *
 * The runtime's isolation is not reachable from a unit test: it adjudicates
 * inside a live worktree-isolated session, and there is no entry point that
 * takes one hook envelope and returns a verdict the way this guard does. So the
 * dependency cannot be turned red by writing a test, and a claim that cannot go
 * red goes stale silently instead (CodySwannGT/lisa#3944).
 *
 * What CAN be measured is whether the runtime is still the one the claim was
 * checked against. That does not prove the behaviour changed — only that nobody
 * has checked since, which is the honest thing to report and the whole of what
 * this pin does.
 *
 * ## Moving it
 *
 * Re-run both inline forms in a worktree-isolated session. Still refused: move
 * this pin, and say where. Permitted: those two cells are UNCOVERED, and #3944
 * owns the decision about which of them Lisa takes on.
 */
const VERIFIED_RUNTIME_VERSION = "2.1.261";

/** The ticket that owns the inline-redirect dependency and its expiry. */
const RUNTIME_ASSUMPTION_TICKET = "CodySwannGT/lisa#3944";

/**
 * This session's runtime version, or null when this is not that runtime.
 *
 * Three answers, and the difference between the last two is the point:
 * - `null` — not Claude Code. Codex, Cursor and Copilot ship this guard too,
 *   and the assumption above is about a control none of them has. A notice that
 *   fires on every session of every harness is noise, and noise gets switched
 *   off.
 * - `""` — Claude Code, which will not say which version. Read as a DIVERGENCE
 *   rather than as a match: the assumption is unconfirmed either way, and
 *   treating an unreadable version as "still 2.1.261" is exactly the silent
 *   expiry #3944 was filed about.
 * - a version — take it at its word.
 *
 * Both env vars are read because either can be the one a future release keeps.
 * `AI_AGENT` carries `claude-code_2-1-261_agent`; `CLAUDE_CODE_EXECPATH` ends
 * in the version directory the running build was launched from.
 * @param env - Environment to read
 * @returns The version, `""` when unreadable, or null for another runtime
 */
const isDigit = ch => ch >= "0" && ch <= "9";

/** @param value - Segment to test @returns Whether it is all digits */
const allDigits = value => value.length > 0 && [...value].every(isDigit);

/** @param value - Segment to read @returns Its trailing digit run, else `""` */
const trailingDigits = value => {
  let start = value.length;
  while (start > 0 && isDigit(value[start - 1])) start -= 1;
  return value.slice(start);
};

function runtimeVersion(env) {
  if (!env.CLAUDECODE) return null;
  const tagged = /claude-code[_-](\d+)[-.](\d+)[-.](\d+)/u.exec(
    env.AI_AGENT ?? ""
  );
  if (tagged) return `${tagged[1]}.${tagged[2]}.${tagged[3]}`;
  // Read the version off the final path segment by scanning characters rather
  // than by regex: an unanchored `\d+\.\d+\.\d+` before `$` backtracks
  // super-linearly on a long execpath, and the version Claude Code launches
  // from is always the trailing directory name.
  const segments = (env.CLAUDE_CODE_EXECPATH ?? "").split("/").filter(Boolean);
  const trailing = segments.length ? segments[segments.length - 1] : "";
  const parts = trailing.split(".");
  if (parts.length < 3) return "";
  const [major, minor, patch] = parts.slice(-3);
  const majorDigits = trailingDigits(major);
  if (!majorDigits || !allDigits(minor) || !allDigits(patch)) return "";
  return `${majorDigits}.${minor}.${patch}`;
}

/**
 * The notice text for a runtime the inline-redirect claim was not checked at.
 * @param version - The observed runtime version, `""` when unreadable
 * @returns The lines to report
 */
function driftNotice(version) {
  return [
    "worktree-binding-guard: the inline-redirect gap is UNVERIFIED here.",
    "",
    "This guard does not refuse `cd <other-worktree> && git …` or",
    "`git -C <other-worktree> …`. Those two cells are covered by the runtime's",
    `own worktree isolation, verified refusing at Claude Code ${VERIFIED_RUNTIME_VERSION}.`,
    version
      ? `This session is running ${version}, so that check does not cover it.`
      : "This session's runtime version could not be read, so nothing covers it.",
    "",
    "This does NOT say the runtime stopped refusing them — only that nobody has",
    "checked since. Run both forms in a worktree-isolated session: still",
    "refused, move VERIFIED_RUNTIME_VERSION in worktree-binding-guard.mjs;",
    `permitted, the two cells are uncovered and ${RUNTIME_ASSUMPTION_TICKET}`,
    "owns what Lisa does about it.",
  ];
}

/**
 * Report, once per session, that the runtime moved off the verified version.
 *
 * ## Why SessionStart and not the guarded call
 *
 * SessionStart is the guard's first evaluation of a session, it fires exactly
 * once per start, and its `additionalContext` is the one channel here that the
 * agent actually reads — the `say()` lines elsewhere in this file are for a
 * human reading a transcript. A notice attached to a guarded tool call would
 * either repeat on every Bash command or need a suppression rule of its own.
 *
 * ## Why it is recorded rather than counted
 *
 * A resume fires SessionStart again for the same session id. The recorded
 * version is what makes the second one silent, and recording the VERSION rather
 * than a flag means a runtime that moves twice inside one resumed session is
 * still reported the second time.
 *
 * Never refuses. The dependency is a reporting gap, not a live displacement,
 * and blocking a session over a version number would be a wall where an
 * observation belongs.
 * @param bindingKeyValue - The key being started
 * @param env - Environment to read the runtime version from
 * @param payload - The hook payload, for legacy-key reads
 * @returns Nothing; every path through this allows
 */
function noticeRuntimeDrift(bindingKeyValue, env, payload) {
  const version = runtimeVersion(env);
  if (version === null || version === VERIFIED_RUNTIME_VERSION) return;
  if (readState(bindingKeyValue, payload)?.runtimeNoticed === version) return;
  writeState(bindingKeyValue, { runtimeNoticed: version }, payload);
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: driftNotice(version).join("\n"),
      },
    })}\n`
  );
}

function evaluate(payload) {
  const sessionId = payload.session_id;
  const cwd = payload.cwd;
  if (typeof sessionId !== "string" || !sessionId || typeof cwd !== "string") {
    say("payload carries no session id or cwd; binding is NOT enforced");
    return 0;
  }
  const binding = bindingKey(payload);
  const observed = worktreeRoot(cwd);
  // The initial-root recovery acknowledgement also works outside any repo.
  if (GUARDED_TOOLS.has(payload.tool_name)) {
    const accepted = handleAcceptance(payload, observed);
    if (accepted !== null) return accepted;
  }
  if (!observed) return 0;

  if (payload.hook_event_name === "SessionStart") {
    recordBaseline(binding, observed, payload);
    // After the baseline, never before: `recordBaseline` writes a fresh state
    // for a session it has not seen, and the notice's record has to go on top
    // of that write rather than under it.
    noticeRuntimeDrift(binding, process.env, payload);
    return 0;
  }
  if (payload.tool_name === "EnterWorktree") {
    const previous = readState(binding, payload);
    if (
      previous?.boundRoot &&
      previous.boundRoot !== observed &&
      !isLinkedWorktree(previous.boundRoot, observed)
    )
      return 0;
    recordClaim(payload, observed);
    return 0;
  }
  if (!GUARDED_TOOLS.has(payload.tool_name)) return 0;

  const state = readState(binding, payload);
  if (state?.unverifiedOwner) return unownedBinding(state, observed);
  if (!state?.boundRoot) {
    // No baseline means SessionStart did not run for this session — an older
    // install, a runtime that fires no such event, a harness that skips it.
    // Absence of a baseline is absence of evidence, not evidence of
    // displacement, so this records one exactly as it always did rather than
    // refusing. Treating it as a refusal would turn a floor into a wall on
    // every surface where the event does not fire, and a wall gets switched
    // off, which costs the whole guard.
    const written = writeState(
      binding,
      {
        boundRoot: observed,
        claimedRoot: null,
        updatedAt: new Date().toISOString(),
      },
      payload,
      { createOnly: true }
    );
    if (written === BINDING_WRITE_CONFLICT) return bindingWriteConflict();
    return 0;
  }
  if (
    state.boundRoot !== observed &&
    !isLinkedWorktree(state.boundRoot, observed)
  )
    return 0;
  // A mismatch. From here a provable read is allowed with a warning and
  // everything else — every write and every command the guard cannot classify
  // — is refused exactly as before (CodySwannGT/lisa#4816).
  if (state.claimedRoot && state.claimedRoot !== observed) {
    if (isReadOnlyCall(payload))
      return warnRead(state.claimedRoot, observed, true);
    return unconfirmedSwitch(state.claimedRoot, observed);
  }
  if (state.claimedRoot === observed) {
    const written = writeState(
      binding,
      {
        boundRoot: observed,
        claimedRoot: null,
        offeredRoot: null,
        updatedAt: new Date().toISOString(),
      },
      payload
    );
    if (written === BINDING_WRITE_CONFLICT) return bindingWriteConflict();
    return 0;
  }
  if (state.boundRoot !== observed) {
    if (isReadOnlyCall(payload))
      return warnRead(state.boundRoot, observed, false);
    return displaced(state.boundRoot, observed);
  }
  // Last, and only once the session is provably where it should be: a script
  // that moves somewhere else after this check has already run.
  const reach = scriptReachingForeignTree(payload, observed);
  if (reach) {
    writeState(binding, { offeredRoot: reach.foreign }, payload);
    return reachesOut(reach.script, reach.foreign, observed);
  }
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
