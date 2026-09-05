#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Provider-neutral work-item binding and Git enforcement for Lisa projects.
 * State is private to the current linked worktree; durable linkage lives in
 * commit trailers, pull-request bodies, and the configured tracker.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Contract version of the traceability gate's script half, reported by the
 * `contract-version` subcommand and read by the workflow half.
 *
 * The two halves travel by different routes — `quality.yml` / `quality-rails.yml`
 * by git ref at `@main`, this file by `lisa apply` — so they WILL drift, exactly
 * as the nightly-e2e gate's header says of its own pair. The registry says so
 * too: `scripts/two-channel-couplings.json` carries this coupling twice.
 *
 * Before this constant existed the workflow's only staleness signal was probing
 * for the `verify-level` subcommand, which is a single hardcoded floor at #2721.
 * Below that floor staleness was visible; above it a copy was indistinguishable
 * from current no matter how old — a copy from 2026-08-18, a major behind,
 * satisfied the probe in silence (#3477). A version is what makes "how old"
 * answerable at all; enforcement was downstream of a number that did not exist.
 *
 * MAJOR — the workflow half cannot drive this script correctly any more: a
 * subcommand it invokes is gone or renamed, an exit code changed meaning, or an
 * env var the workflow sets is no longer read. A mismatch FAILS the gate closed.
 * MINOR — the contract still holds but the logic behind it moved: a new
 * requirement, a fixed parse, a changed message. Reported, never fatal.
 * PATCH — nothing a caller can observe.
 *
 * Bump the MINOR whenever a change to this file would alter a verdict the gate
 * reports, so a consumer running old logic can be told how far behind it is.
 */
export const WORK_ITEM_CONTRACT_VERSION = "1.0.0";

/**
 * Subject of a release-bot commit, which is exempt from the work-item trailer.
 *
 * `[skip-cd]` is OPTIONAL here on purpose. The release workflow now emits
 * `... [skip ci] [skip-cd]` (Amplify honours `[skip-cd]`, not `[skip ci]`, and
 * requires it at the end of the message), but a host project pinned to an older
 * Lisa still emits the bare `[skip ci]` form. Accepting both keeps the exemption
 * working across that upgrade window in either direction.
 *
 * Still fully anchored: `$` after the optional group, so this cannot be widened
 * into "any subject that starts with chore(release)". A commit carrying trailing
 * text beyond the recognised tokens is NOT exempt.
 */
const RELEASE_SUBJECT =
  /^chore\(release\): \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? \[skip ci\](?: \[skip-cd\])?$/;
const ZERO_OID = /^0+$/;
const MARKER = "[lisa-pr-link]";
/**
 * The deploy environment whose done role is terminal — the only one that
 * closes a work item. Named once because three separate readers compare
 * against it, and a literal repeated three times is three places to drift.
 */
const PRODUCTION = "production";
/** How a base branch that maps to no deploy environment is described. */
const NOT_A_DEPLOY_BRANCH = "not a deploy branch";
/**
 * The command that establishes the ticket-side backlink.
 *
 * Named in every refusal that the backlink is missing. A validator that
 * reports "no verified backlink" without the remedy sends the reader looking
 * for a producer that, until this command existed, was prose in a SKILL.md.
 */
const BACKLINK_COMMAND = "node scripts/lisa-work-item.mjs backlink";
/**
 * The subcommand that closes out the two gates a push had to defer.
 *
 * Named in the push report rather than described, because the push report is
 * the only place an operator learns that two requirements are still open, and
 * a list of open work with no command against it is a complaint.
 */
const DISCHARGE_COMMAND = "discharge-pr-gates";
/**
 * The prefix only — an anchored, fixed-length literal with no quantifier, so
 * it cannot backtrack. The ReDoS was never here; it was in the `\s*(.+?)\s*$`
 * tail, which is now string work.
 *
 * Deliberately still a regex rather than `line.toLowerCase().startsWith(…)`.
 * `toLowerCase()` applies FULL Unicode case mapping, so U+212A KELVIN SIGN
 * folds to "k" and `WorK-Item:` written with it would be accepted — a format
 * this has never accepted, because `/i` on a non-unicode pattern canonicalizes
 * ASCII only.
 */
const WORK_ITEM_PREFIX = /^work-item:/i;

/**
 * The value of a `Work-Item:` line, or null if this is not one.
 *
 * Replaces `/^Work-Item:\s*(.+?)\s*$/i`, which put a lazy quantifier between
 * two `\s*` groups and backtracked super-linearly on a line that is mostly
 * whitespace — over commit messages and PR bodies, which are not this
 * script's to trust. Acceptance is unchanged: ASCII-case-insensitive prefix at
 * the start of the line, non-empty value, surrounding whitespace ignored.
 * @param {string} line One line of a commit message or PR body.
 * @returns {string | null} The trimmed value, or null.
 */
function workItemLineValue(line) {
  const match = WORK_ITEM_PREFIX.exec(line);
  if (!match) return null;
  const value = line.slice(match[0].length).trim();
  return value === "" ? null : value;
}
const GUIDANCE = [
  "Mention the ticket this work relates to, or ask Lisa to create one:",
  "  Work-Item: <configured-project-ticket>",
].join("\n");

class TrackingError extends Error {
  /**
   * Whether a COMMIT rewrite is what clears this refusal.
   *
   * Set where the refusal is raised, not sniffed from its text downstream.
   * `commitOutcome` catches several unrelated kinds from one call —
   * a commit missing its trailer, a tracker saying the item is closed, an
   * unreadable config — and only the first is answered by an amend or a rebase.
   * Telling a reader to rewrite a commit because the tracker said no would be
   * the same misdirection this flag exists to remove, pointed somewhere else.
   * @type {boolean}
   */
  commitRewritable = false;

  /**
   * Whether this refusal already says everything the operator needs.
   *
   * Every other refusal here IS about work-item tracking, so the reporter's
   * banner and its "mention the ticket" guidance are the right frame for them.
   * The push-destination refusal is not: nothing about it is fixed by naming a
   * ticket, and telling someone to do that while their push is landing on a
   * deploy branch points them away from the one thing that matters. Set where
   * the refusal is raised, for the same reason `commitRewritable` is — the
   * reporter cannot tell these apart from the text without guessing.
   * @type {boolean}
   */
  selfExplanatory = false;
}

/** What `soleWorkItem` is reading when it reads a commit. */
const COMMIT_SUBJECT = "commit message";

// WHICH RULE FIRED. `🔗 Work-Item Traceability` is one check name over several
// independent requirements, and a refusal that does not say which of them it is
// costs the reader a diagnosis step every single time: the same red check means
// "rewrite a commit", "edit the body", "post a backlink", or "the tracker says
// no", and those have nothing in common but the name. Measured on the defect
// this naming was added for — four misdiagnoses of one refusal in a single day,
// each one an edit that could not have cleared it.
//
// The numbers are the ones `gateSummary` prints, so a refusal and the checklist
// underneath it refer to the same thing by the same name.
/** The trailer on each commit in the range. */
const GATE_COMMIT = "gate 3 (commit trailer)";
/** The tracker's own answer about an item the range names. */
const GATE_LIVENESS = "gate 1 (live tracker item)";
/** What the pull-request body declares, and whether it matches the commits. */
const GATE_MAPPING = "gate 4 (pull-request declaration)";
/** The managed backlink comment on the tracker item. */
const GATE_BACKLINK = "gate 5 (tracker backlink)";

/**
 * Record which rule a refusal belongs to, without overwriting a narrower tag.
 * @param {Error} error The refusal.
 * @param {string} gate The rule that raised it.
 * @returns {Error} The same error, tagged.
 */
function taggedGate(error, gate) {
  if (error instanceof TrackingError && !error.gate) error.gate = gate;
  return error;
}

// A HELPER FOR RANGE-WIDE COMMIT REFUSALS USED TO LIVE HERE, and it is gone
// because the only refusal that used it is gone. `validateCommits` raised
// "mixed Work-Item references" about the RANGE rather than about any one
// message; that rule is now the pull-request mapping check in `reportMapping`,
// where it is about the body and a body edit clears it. Every remaining
// commit-side refusal comes from `exactWorkItem`, which tags its own by
// catching.

/**
 * The tracker could not be ASKED — a missing binary, a refused credential, a
 * call that never completed. Distinct from a TrackingError, which carries the
 * tracker's own "no". Only this kind may be degraded.
 */
export class TrackerUnreachableError extends TrackingError {}

/**
 * Turn a failed `gh` invocation into the right kind of refusal.
 *
 * The distinction is the whole point: a missing binary or a refused credential
 * means the tracker could not be ASKED, while a "no" from the tracker is an
 * answer. Absence of evidence is not evidence of absence, and only the first
 * kind may be degraded — treating them alike would either strand finished work
 * or wave through an item that genuinely is not committable.
 * @param {{status: number|null, error?: Error, stderr?: string}} result Spawn result.
 * @param {string} ref Work item reference.
 * @returns {Error} The error to throw.
 */
export function githubFailure(result, ref) {
  const reason = githubFailureReason(result, ref, "GitHub issue");
  // ANY spawn-level error means the tracker could not be asked — the binary is
  // missing (ENOENT), the call was killed at its deadline (ETIMEDOUT), the
  // system could not fork (EAGAIN). Singling out ENOENT made a timed-out `gh`
  // a non-degradable TrackingError, i.e. "this work item is invalid" because
  // the network was slow.
  // An upstream outage is UNREACHABLE, not a verdict. Adding the outage branch
  // to `githubFailureReason` fixed the sentence a reader sees and left this
  // classification wrong: a 503 still produced a TrackingError, which means
  // "this work item is invalid" — the same false verdict, one layer down. The
  // message and the error class have to agree, or the honest wording just makes
  // a wrong classification more convincing.
  const unreachable =
    result.error !== undefined ||
    /cannot authenticate|GitHub API is unavailable/.test(reason);
  return unreachable
    ? new TrackerUnreachableError(reason)
    : new TrackingError(reason);
}

/**
 * Say which of three different failures a `gh` invocation actually hit.
 *
 * The three are indistinguishable from an exit status alone, and they send the
 * reader to three different places: a missing binary is an environment to
 * provision, a refused credential is an access grant to obtain, and only the
 * third is anything to do with the ticket.
 *
 * Collapsing them cost a real round trip. On Claude Code web, where `gh` is not
 * pre-installed, every commit was refused with "issue #2202 does not exist or
 * is inaccessible" — about an issue that was open and correct. The message
 * accused the ticket, so that is where the reader went.
 * @param {{status: number|null, error?: Error, stderr?: string}} result Spawn result.
 * @param {string} ref Work item reference, for the message.
 * @param {string} noun What the reference names.
 * @returns {string} A message naming the actual fault.
 */
export function githubFailureReason(result, ref, noun) {
  if (result.error?.code === "ENOENT") {
    return (
      `the GitHub CLI (gh) is not installed, so ${noun} ${ref} could not be ` +
      `checked.\nThis is an environment gap, not a problem with the work item. ` +
      `Pin gh in remoteEnv.tools.install for surfaces that lack it.`
    );
  }
  const stderr = String(result.stderr ?? "");
  if (
    /not enabled for this session|gh auth login|HTTP 40[13]|Bad credentials|authentication/i.test(
      stderr
    )
  ) {
    return (
      `the GitHub CLI cannot authenticate, so ${noun} ${ref} could not be ` +
      `checked.\nThis is a credential gap, not a problem with the work item.` +
      `\n${stderr.trim().slice(0, 300)}`
    );
  }
  // A transient upstream failure is NOT a verdict about the work item, and
  // reporting it as one is worse than reporting nothing. Measured 2026-08-17:
  // GitHub returned `HTTP 503: No server is currently available` during an
  // outage, this function fell through to the sentence below, and a push was
  // blocked with "issue #2651 does not exist" about an issue created minutes
  // earlier. The author's next move is to go looking for a deleted ticket.
  //
  // 5xx, rate limiting, and network failures all mean UNASSESSED. The two
  // branches above already model that distinction; this is the third case they
  // were missing.
  if (
    /HTTP 5\d\d|rate limit|timed out|timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|service unavailable|try again/i.test(
      stderr
    )
  ) {
    return (
      `the GitHub API is unavailable, so ${noun} ${ref} could not be ` +
      `checked.\nThis is an upstream outage, not a problem with the work item. ` +
      `Retry when it clears.\n${stderr.trim().slice(0, 300)}`
    );
  }
  return `${noun} ${ref} does not exist or is inaccessible`;
}

/**
 * Wall-clock ceiling for any child process this script spawns.
 *
 * These run inside a git hook, so an unbounded call does not merely wait — it
 * hangs the commit or push that invoked it, with no output explaining why. A
 * tracker that has stopped answering must look like a tracker that is
 * unreachable, which the degradation path already knows how to handle.
 */
const CHILD_TIMEOUT_MS = Number(
  process.env.LISA_WORK_ITEM_TIMEOUT_MS || 30_000
);

/**
 * Run a child process, with the module's shared failure conventions.
 *
 * Exported so the stdout guarantee below can be asserted against a real spawn
 * failure rather than a mocked one — the defect it fixes only appears when
 * `spawnSync` genuinely declines to start a child, which a stub cannot stage
 * convincingly.
 * @param {string} command - Executable to run.
 * @param {string[]} args - Arguments to pass.
 * @param {object} [options] - cwd, env, input, timeout, allowFailure, error.
 * @returns {object} The spawnSync result, with stdout and stderr always strings.
 */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    timeout: options.timeout ?? CHILD_TIMEOUT_MS,
    // SIGKILL, not the default SIGTERM. `timeout` sends killSignal and then
    // keeps waiting for the child to exit, so a child that traps or ignores
    // SIGTERM hangs the hook exactly as long as it would have without any
    // timeout at all. A deadline a child can decline is not a deadline.
    killSignal: "SIGKILL",
  });
  // spawnSync reports a timeout via `error`, not a non-zero status, so the
  // status check below would let a timed-out call through as success.
  if (result.error && !options.allowFailure) {
    throw new TrackerUnreachableError(
      `${command} ${args.join(" ")} did not complete: ${result.error.message}`
    );
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new TrackingError(
      options.error ?? `${command} ${args.join(" ")} failed`
    );
  }
  // `spawnSync` reports `stdout`/`stderr` as null when the child never ran —
  // an absent binary, a permissions failure, a timeout. Callers passing
  // `allowFailure` then reach straight for `.stdout.trim()`, and every one of
  // them would throw `Cannot read properties of null`: an unrelated TypeError
  // in place of the real cause, on the path specifically written to tolerate
  // failure. Normalizing here rather than at each call site means a caller
  // added later inherits the guarantee instead of having to remember it.
  return {
    ...result,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function git(args, options = {}) {
  return run("git", args, options).stdout.trim();
}

function curlConfigValue(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")}"`;
}

/**
 * `Accept` header value for the REST endpoints this file reads. Named because
 * the string is the wire contract, not decoration: a tracker that receives a
 * different `Accept` answers with a different shape, and every parser below
 * assumes JSON.
 */
const ACCEPT_JSON = "Accept: application/json";

/** `Content-Type` header value for the request bodies this file sends. */
const CONTENT_TYPE_JSON = "Content-Type: application/json";

/**
 * The curl config key that carries a request body verbatim.
 *
 * `data-binary` rather than `data`: `data` strips newlines, which silently
 * corrupts a GraphQL document or a markdown comment body.
 */
const DATA_BINARY = "data-binary";

function secureCurl(args, entries, options = {}) {
  const input = `${entries
    .map(([name, value]) => `${name} = ${curlConfigValue(value)}`)
    .join("\n")}\n`;
  // --max-time bounds curl itself, so it exits on its own rather than being
  // killed by the spawnSync ceiling; --connect-timeout fails fast on a host
  // that is not answering at all. Kept below CHILD_TIMEOUT_MS so curl's own
  // error message is what surfaces.
  return run(
    "curl",
    [
      "-fsS",
      "--connect-timeout",
      "10",
      "--max-time",
      "25",
      "--config",
      "-",
      ...args,
    ],
    { ...options, input }
  );
}

function projectRoot() {
  return git(["rev-parse", "--show-toplevel"]);
}

function statePath() {
  return resolve(git(["rev-parse", "--git-path", "lisa/work-item.json"]));
}

/** Canonical prefix on a fully qualified local branch ref. */
const HEADS_PREFIX = "refs/heads/";

function currentBranch() {
  return git(["branch", "--show-current"]);
}

/**
 * Branch an in-progress rebase is rewriting, or empty when no rebase is in
 * progress. During a rebase HEAD is detached, but git records the branch being
 * rebased in `<rebase-state-dir>/head-name` (issue #1956) — resolved via
 * `git rev-parse --git-path` so linked worktrees find their private state dir.
 */
function rebaseBranch() {
  for (const stateDir of ["rebase-merge", "rebase-apply"]) {
    const file = resolve(
      git(["rev-parse", "--git-path", `${stateDir}/head-name`])
    );
    if (!existsSync(file)) continue;
    const headName = readFileSync(file, "utf8").trim();
    if (headName.startsWith(HEADS_PREFIX)) {
      return headName.slice(HEADS_PREFIX.length);
    }
  }
  return "";
}

/**
 * The branch this worktree is working on, mid-rebase included.
 *
 * During a rebase HEAD is detached, so `git branch --show-current` answers with
 * an empty string about a worktree that is very much on a branch. Every caller
 * that asks "what branch is this" wants the rebase's head-name in that case,
 * and this is the one place that decides it.
 *
 * It used to be decided in two places and only one of them knew about rebases.
 * `assertStateBranch` fell back to `rebaseBranch()`; `writeState` did not. The
 * consequence was a trap with no exit: a binding created mid-rebase recorded
 * `branch: null`, every commit was then refused as "pending branch attachment",
 * and `attach-branch` — the command that refusal names — itself refused with
 * "create or check out a feature branch", because it was asking the question
 * the other way. `git rebase --abort` is blocked by the same gate, so the only
 * way out was to write the binding file by hand.
 * @returns {string} The branch name, or "" on a detached HEAD with no rebase.
 */
function activeBranch() {
  return currentBranch() || rebaseBranch();
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override;
  if (
    base === null ||
    override === null ||
    typeof base !== "object" ||
    typeof override !== "object"
  ) {
    return override;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? deepMerge(merged[key], value) : value;
  }
  return merged;
}

function readJson(file, required = false) {
  if (!existsSync(file)) {
    if (required) throw new TrackingError(`Required file not found: ${file}`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new TrackingError(`Invalid JSON: ${file}`);
  }
}

function readConfig() {
  const override = process.env.LISA_TRACKING_CONFIG_FILE;
  if (override) return readJson(resolve(process.cwd(), override), true);
  const root = projectRoot();
  return deepMerge(
    readJson(join(root, ".lisa.config.json"), true),
    readJson(join(root, ".lisa.config.local.json"))
  );
}

function values(value) {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(values);
}

function lifecycleContract(config, provider) {
  // Linear's lifecycle is a workflow STATE, exactly like Jira's status, so it
  // is configured under `linear.workflow` — NOT `linear.labels.build`. The
  // label path is still honoured as a fallback for any config written against
  // the old shape. Reading only the label path meant nothing resolved, the
  // GitHub-shaped `status:*` defaults below took over, and no Linear state name
  // could ever match them, so every correctly claimed Linear issue was
  // rejected as "not claimed".
  const configured =
    provider === "jira"
      ? config.jira?.workflow
      : provider === "github"
        ? config.github?.labels?.build
        : (config.linear?.workflow ?? config.linear?.labels?.build);
  const defaults =
    provider === "jira" || provider === "linear"
      ? {
          ready: "Ready",
          claimed: "In Progress",
          review: "Code Review",
          blocked: "Blocked",
          done: {
            dev: "On Dev",
            staging: "On Stg",
            production: "Done",
          },
        }
      : {
          ready: "status:ready",
          claimed: "status:in-progress",
          blocked: "status:blocked",
          done: {
            dev: "status:on-dev",
            staging: "status:on-stg",
            production: "status:done",
          },
        };
  const roles = deepMerge(defaults, configured ?? {});
  const done = values(roles.done);
  const terminal =
    typeof roles.done === "string"
      ? roles.done
      : (roles.done?.production ?? done.at(-1));
  // No `active` set any more. It existed for exactly one reader — the claim
  // check — and dead code inside a mutation-gated file is not merely untidy: it
  // is a block of mutants nothing can kill, so it lowers the measured score
  // while proving nothing. `done` still feeds `terminal`, which the completion
  // writer reads.
  // Two fields for one role, because matching and naming want opposite things.
  // `terminal` is the COMPARISON key and stays folded, so a Linear workflow
  // state configured `Done` still matches the API's `Done`. `terminalName` is
  // the configured spelling, kept verbatim so a human-facing sentence can name
  // the state the operator actually typed. Folding both is how the error for a
  // missing state read `no workflow state named done` about a board whose
  // state is called `Done` — a message that sends someone looking for a state
  // that is not what they configured and not what Linear shows them.
  const terminalName = String(terminal ?? "");
  const byEnvironment = doneRolesByEnvironment(roles.done, terminalName);
  return {
    claimed: requireString(roles.claimed, `${provider} claimed lifecycle role`),
    done: byEnvironment,
    productionEnvironment: productionEnvironmentOf(byEnvironment, terminalName),
    ready: requireString(roles.ready, `${provider} ready lifecycle role`),
    roles: lifecycleRoleSet(roles, done),
    terminal: terminalName.toLowerCase(),
    terminalName,
  };
}

/**
 * The done roles keyed by deploy environment, in configured order.
 *
 * The single-string form (`done: "Done"`) is a project that names one done
 * role for every environment, so it is read as the production one — that is
 * the only environment whose role closes anything.
 * @param {unknown} done The configured `done` role or role map.
 * @param {string} terminalName The resolved terminal role's spelling.
 * @returns {[string, string][]} `[environment, role]` pairs, order preserved.
 */
function doneRolesByEnvironment(done, terminalName) {
  const entries =
    typeof done === "string"
      ? [[PRODUCTION, done]]
      : done && typeof done === "object"
        ? Object.entries(done)
        : [];
  const mapped = entries
    .map(([environment, role]) => [
      String(environment).trim().toLowerCase(),
      typeof role === "string" ? role.trim() : "",
    ])
    .filter(([environment, role]) => environment !== "" && role !== "");
  // A shape this reader could not decompose must never leave the writer with
  // NO environment to apply, which would refuse every completion in a project
  // whose `done` nests. The resolved terminal is always an answer.
  return mapped.length > 0 ? mapped : [[PRODUCTION, terminalName]];
}

/**
 * Which of the configured environments is the production one.
 *
 * Found by matching the already-resolved TERMINAL ROLE, not by position. The
 * terminal role is the single existing answer to "which role closes an item",
 * so deriving the environment from it means the two can never disagree — and
 * it avoids deriving anything a second, independent way from JSON key order,
 * which is not semantically meaningful and which no schema constrains.
 * @param {[string, string][]} byEnvironment `[environment, role]` pairs.
 * @param {string} terminalName The resolved terminal role's spelling.
 * @returns {string} The production environment's name.
 */
function productionEnvironmentOf(byEnvironment, terminalName) {
  const folded = terminalName.trim().toLowerCase();
  const matched = byEnvironment.find(
    ([, role]) => role.toLowerCase() === folded
  );
  return matched?.[0] ?? PRODUCTION;
}

/**
 * Every lifecycle role a project has configured, in the project's own spelling.
 *
 * GitHub Issues has no lifecycle beyond open and closed, so Lisa synthesises one
 * in labels — and a synthesised state is one something has to reconcile. The
 * completion writer knew exactly one competing role, the claimed one, so items
 * closed still carrying the ready, blocked, or intermediate environment role
 * they had passed through. Measured on a live tracker before this existed: 34
 * closed issues carried an active lifecycle role, six of them carrying the ready
 * role and the terminal role at once. That pair is not cosmetic — the build
 * queue scan reads the label, not the closed state, so a closed item that still
 * reads as ready is handed back out, and one already-shipped fix was rebuilt end
 * to end by a second agent before a push-time gate caught it.
 *
 * Configured spellings, never folded ones. These become `--remove-label`
 * arguments, and the label a project named is the label GitHub holds.
 *
 * `human_needed` is deliberately absent. It is a marker that rides ALONGSIDE a
 * role rather than a lane an item occupies, and nothing dispatches work on it,
 * so retiring it here would be a second behaviour smuggled in under this one.
 *
 * Worth knowing for whoever reads this next: trackers with a native lifecycle
 * field do not need any of it. On JIRA and Linear the field that closes an item
 * is the same field a queue scan filters on, so the two cannot disagree. This
 * reconciliation exists because GitHub has no such field and Lisa synthesises
 * one, and this writer is the main place that divergence is created. The
 * asymmetry itself is CodySwannGT/lisa#3479 — deliberately not addressed here.
 * @param {object} roles The merged role map for this provider.
 * @param {string[]} done Every configured environment terminal value.
 * @returns {readonly string[]} Each configured role once, first spelling wins.
 */
function lifecycleRoleSet(roles, done) {
  const seen = new Map();
  for (const value of [
    roles.ready,
    roles.claimed,
    roles.review,
    roles.blocked,
    ...done,
  ]) {
    if (typeof value !== "string") continue;
    const name = value.trim();
    if (name && !seen.has(name.toLowerCase()))
      seen.set(name.toLowerCase(), name);
  }
  return Object.freeze([...seen.values()]);
}

function requireString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TrackingError(`Tracker configuration is missing ${path}`);
  }
  return value.trim();
}

function repoBasename(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\.git$/, "");
  return normalized.split(/[/:]/).filter(Boolean).at(-1) ?? "";
}

function currentRepoIdentity(config) {
  const configured = repoBasename(config.repo ?? config.github?.repo);
  if (configured) return configured;
  const githubRepository = repoBasename(process.env.GITHUB_REPOSITORY);
  if (githubRepository) return githubRepository;
  const remote = run("git", ["remote", "get-url", "origin"], {
    allowFailure: true,
  });
  const inferred = remote.status === 0 ? repoBasename(remote.stdout) : "";
  if (inferred) return inferred;
  throw new TrackingError(
    "Cannot resolve the current repository; configure repo or github.repo"
  );
}

/**
 * The two contracts this gate can be asked to prove.
 *
 * `trailer` — the DEFAULT — proves that the change names a work item: a
 * `Work-Item:` line exists, is well formed, names the configured tracker's
 * repository or project, matches this worktree's binding, and is the same
 * reference on the commits and on the pull-request body. Every one of those is
 * decidable from the text and the local config, so it needs no credential of
 * any kind.
 *
 * `full` adds the requirements that need tracker API access, two of them read
 * and one of them WRITE: the item exists, is open, carries a `repo:` label
 * naming this repository, is a leaf, and carries a verified backlink to this
 * pull request.
 *
 * `full` is not a promise that any of the read checks RAN. When the tracker
 * cannot be asked — no credential, no binary, an outage — they are reported as
 * skipped and the commit proceeds on the offline checks alone. An absent
 * credential is not a verdict about a work item, and treating it as one refuses
 * finished work on every surface that has no key. The pull-request check is
 * where a credential is genuinely required, and it does not degrade.
 *
 * Claim state is deliberately NOT in that list; see the note where
 * `assertClaimedLifecycle` used to be.
 *
 * The default flipped in #2721. `full` was the only contract on offer, so a
 * project unwilling to hand a tracker API key to CI could not satisfy the gate
 * in any form — the traceability requirement and the tracker-integration
 * requirement were one thing, and only the first is what the gate is for.
 *
 * Declared rather than inferred from whichever credentials happen to be
 * present. Inferring it would make the gate's strength a property of the
 * environment: delete a secret and the check quietly asks for less, with the
 * decision recorded nowhere. A level in the config says what the project
 * decided, and `verify-level` prints what actually resolved.
 */
const VERIFY_LEVELS = new Set(["trailer", "full"]);

/** What a project gets when it says nothing. */
const DEFAULT_VERIFY = "trailer";

/**
 * Resolve how much of the contract to prove.
 *
 * The environment override exists for one caller: CI degrading a project that
 * declared `full` whose tracker credential did not arrive. That used to be a
 * warning and `exit 0` — a required check reporting success having verified
 * nothing at all, an absent trailer included. Degrading to `trailer` still
 * proves the reference, which is the part that was never credential-bound.
 * @param {object} config Merged Lisa config.
 * @returns {string} Either "trailer" or "full".
 */
function verifyLevel(config) {
  const override = process.env.LISA_WORK_ITEM_VERIFY;
  const raw =
    override === undefined || override === ""
      ? config.workItem?.verify
      : override;
  if (raw === undefined || raw === "") return DEFAULT_VERIFY;
  const value = String(raw).trim().toLowerCase();
  if (!VERIFY_LEVELS.has(value)) {
    throw new TrackingError(
      `Unknown workItem.verify '${raw}'. Expected "trailer" (the default: ` +
        `prove the Work-Item reference, contact no tracker) or "full" (also ` +
        `prove the tracker item exists and is open, has repo scope, is a leaf, ` +
        `and carries the PR backlink)`
    );
  }
  return value;
}

/**
 * Deploy branches reversed: branch name -> the environment it deploys.
 *
 * `deploy.branches` is written env-first (`production: main`) because that is
 * how a human thinks about it. Every reader here starts from a branch — a
 * merged pull request's base — and needs the environment, so the map is
 * inverted once, here, rather than searched at each use.
 *
 * **The fallback is deliberate and narrow.** A project that configures no
 * deploy branches at all is not saying "nothing ever deploys"; it is saying
 * nothing unusual happens, and its default branch is its production branch.
 * Treating the absent map as "no branch deploys anything" would refuse every
 * completion in every project that never wrote the key — a fix that stops
 * completing anything is not a fix. What the fallback does NOT do is invent an
 * environment for a branch that is simply not in a map the project DID write:
 * that is the stacked-integration case, and it is exactly the one that must
 * not be read as production.
 * @param {object} config The resolved Lisa configuration.
 * @returns {Map<string, string>} Branch name to deploy environment.
 */
export function deployBranchEnvironments(config) {
  const configured = config?.deploy?.branches;
  const entries =
    configured && typeof configured === "object"
      ? Object.entries(configured)
      : [];
  const mapped = new Map();
  for (const [environment, branch] of entries) {
    const trimmed = typeof branch === "string" ? branch.trim() : "";
    const name = trimmed.startsWith(HEADS_PREFIX)
      ? trimmed.slice(HEADS_PREFIX.length)
      : trimmed;
    if (name !== "") mapped.set(name, String(environment).trim().toLowerCase());
  }
  if (mapped.size > 0) return mapped;
  const fallback = config?.policy?.repository?.default_branch;
  const branch =
    typeof fallback === "string" && fallback.trim() !== ""
      ? fallback.trim()
      : "main";
  return new Map([[branch, PRODUCTION]]);
}

function trackerContract(config = readConfig()) {
  const provider = requireString(config.tracker, "tracker").toLowerCase();
  const identityRepo = currentRepoIdentity(config);
  if (provider === "github") {
    const org = requireString(config.github?.org, "github.org");
    const githubRepo = requireString(config.github?.repo, "github.repo");
    const queue =
      typeof config.github?.queueRepo === "string" &&
      config.github.queueRepo.trim() !== ""
        ? config.github.queueRepo.trim()
        : `${org}/${githubRepo}`;
    const repository = queue.includes("/") ? queue : `${org}/${queue}`;
    return {
      provider,
      repository,
      identityRepo,
      deployBranches: deployBranchEnvironments(config),
      verify: verifyLevel(config),
      lifecycle: lifecycleContract(config, provider),
      repositoryIsIdentity:
        repository.toLowerCase() === `${org}/${githubRepo}`.toLowerCase(),
    };
  }
  if (provider === "jira") {
    return {
      provider,
      identityRepo,
      verify: verifyLevel(config),
      project: requireString(
        config.jira?.project,
        "jira.project"
      ).toUpperCase(),
      cloudId: String(config.atlassian?.cloudId ?? "").trim(),
      site: String(config.atlassian?.site ?? process.env.JIRA_SERVER ?? "")
        .replace(/^https?:\/\//, "")
        .replace(/\/$/, ""),
      email: String(config.atlassian?.email ?? "").trim(),
      lifecycle: lifecycleContract(config, provider),
    };
  }
  if (provider === "linear") {
    return {
      provider,
      identityRepo,
      verify: verifyLevel(config),
      workspace: requireString(config.linear?.workspace, "linear.workspace"),
      teamKey: requireString(
        config.linear?.teamKey,
        "linear.teamKey"
      ).toUpperCase(),
      lifecycle: lifecycleContract(config, provider),
    };
  }
  throw new TrackingError(
    `Unknown tracker '${provider}'. Expected github, jira, or linear`
  );
}

function canonicalizeRef(raw, contract = trackerContract()) {
  const value = String(raw ?? "").trim();
  if (contract.provider === "github") {
    const match = /^([^\s/#]+\/[^\s/#]+)#([1-9]\d*)$/.exec(value);
    if (!match)
      throw new TrackingError(
        `Invalid GitHub Work-Item '${value}'; expected owner/repo#123`
      );
    const repository = `${match[1]}`;
    if (repository.toLowerCase() !== contract.repository.toLowerCase()) {
      throw new TrackingError(
        `Work-Item '${value}' is outside configured tracker repository ${contract.repository}`
      );
    }
    return `${contract.repository}#${match[2]}`;
  }
  const match = /^([A-Z][A-Z0-9]{1,9})-([1-9]\d*)$/.exec(value.toUpperCase());
  if (!match)
    throw new TrackingError(
      `Invalid ${contract.provider} Work-Item '${value}'; expected KEY-123`
    );
  const expected =
    contract.provider === "jira" ? contract.project : contract.teamKey;
  if (match[1] !== expected) {
    throw new TrackingError(
      `Work-Item '${value}' is outside configured ${contract.provider} project ${expected}`
    );
  }
  return `${match[1]}-${match[2]}`;
}

function readState(optional = true) {
  const file = statePath();
  if (!existsSync(file)) {
    if (optional) return undefined;
    throw new TrackingError("No work item is bound to this worktree");
  }
  const state = readJson(file, true);
  if (
    state.version !== 1 ||
    (state.branch !== null && typeof state.branch !== "string") ||
    typeof state.provider !== "string" ||
    typeof state.ref !== "string"
  ) {
    throw new TrackingError(`Malformed work-item binding: ${file}`);
  }
  return state;
}

function assertStateBranch(state) {
  // Mid-rebase HEAD is detached, but the binding must validate against the
  // branch the rebase is rewriting (its head-name) so rebase picks and
  // `git rebase --continue` commits are not wedged (issue #1956). A detached
  // HEAD with NO rebase in progress still fails closed below.
  const branch = activeBranch();
  if (!branch)
    throw new TrackingError(
      "Cannot use a work-item binding from detached HEAD"
    );
  if (state.branch === null) {
    throw new TrackingError(
      "Work-item binding is pending branch attachment; run lisa-work-item.mjs attach-branch"
    );
  }
  if (state.branch !== branch) {
    throw new TrackingError(
      `Work-item binding belongs to branch '${state.branch}', not '${branch}'. Re-bind or attach it to this branch`
    );
  }
}

function writeState(ref, provider = trackerContract().provider, options = {}) {
  const branch = activeBranch();
  if (!branch && options.requireBranch)
    throw new TrackingError(
      "Create or check out a feature branch before binding a work item"
    );
  const file = statePath();
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify({ version: 1, branch: branch || null, provider, ref }, null, 2)}\n`,
      {
        flag: "wx",
        mode: 0o600,
      }
    );
    chmodSync(temporary, 0o600);
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return file;
}

/**
 * Every `Work-Item:` value in a message, wherever in the message it sits.
 *
 * Deliberately NOT `git interpret-trailers --parse`, which reads only the
 * FINAL paragraph block. Under that rule a trailer stopped counting the moment
 * anything landed after it — a blank line before the `Co-Authored-By:`
 * attribution block, a bot appending release notes below it — and the gate
 * then reported `found 0` about a message that plainly contained one (#2672).
 *
 * The two failure modes point opposite ways, which is what made it expensive
 * to read: a duplicate reports `found 2`, and a present-but-early trailer
 * reports `found 0`, sending every reader hunting for a line that is right
 * there. It could also go red with no human action at all, because something
 * appended below the trailer is enough.
 *
 * Position carries no information here. Neither a commit message assembled by
 * an agent nor a pull-request body edited by bots after review has a
 * meaningful "last block", so the whole text is read.
 *
 * Comment lines and a verbose commit's diff are not a hazard: the prefix is
 * anchored at column zero, so `# Work-Item: …` never matches, and every
 * unified-diff line carries a space, `+` or `-` in that column.
 * @param {string} message Commit message or pull-request body.
 * @returns {string[]} Every Work-Item value found, in order of appearance.
 */
function workItemLines(message) {
  return String(message ?? "")
    .split(/\r?\n/)
    .flatMap(line => {
      const value = workItemLineValue(line);
      return value === null ? [] : [value];
    });
}

/**
 * The one work item a text names, wherever and however often it says so.
 *
 * ONE function for commit messages and pull-request bodies, because two of
 * them is how this recurs. #2672 fixed the commit side — read the whole text,
 * accept repeats of the same reference — and left the body side reading every
 * line but rejecting a second one. The same text then answered two different
 * ways depending on which parser saw it, and neither answer explained the
 * other.
 *
 * Repeats of the SAME reference pass. They have to on the commit side: Lisa's
 * own prepare-commit-msg hook appends `Work-Item:` to the final trailer block,
 * so a message already carrying the trailer above its attribution block comes
 * back out of that hook with two identical lines. They now pass on the body
 * side too. The old reasoning there — nothing appends a trailer to a body on
 * Lisa's behalf, so a second line means a person wrote two — is simply not
 * true: a body that quotes its own commit message carries the line twice, and
 * bots edit bodies after review. A repeat of the same reference says exactly
 * what one line says, so rejecting it bought tidiness and cost traceability.
 *
 * Two DIFFERENT references is the real ambiguity — which one is this change
 * about? — and it still fails, naming both.
 * @param {string} text Commit message or pull-request body.
 * @param {object} contract Resolved tracker contract.
 * @param {string} subject What is being read, for the message.
 * @returns {string} The canonical work-item reference.
 */
function soleWorkItem(text, contract, subject) {
  const values = workItemLines(text);
  if (values.length === 0) {
    throw new TrackingError(`No Work-Item trailer anywhere in the ${subject}`);
  }
  const refs = [
    ...new Set(values.map(value => canonicalizeRef(value, contract))),
  ];
  if (refs.length > 1) {
    throw new TrackingError(
      `${subject[0].toUpperCase()}${subject.slice(1)} names ${refs.length} different work items (${refs.join(", ")}); it must name exactly one`
    );
  }
  return refs[0];
}

/**
 * The one work item a COMMIT message names.
 * @param {string} message Commit message.
 * @param {object} contract Resolved tracker contract.
 * @returns {string} The canonical work-item reference.
 */
function exactWorkItem(message, contract = trackerContract()) {
  try {
    return soleWorkItem(message, contract, COMMIT_SUBJECT);
  } catch (error) {
    // `soleWorkItem` serves gate 3 and gate 4 from one body and cannot tell
    // them apart; this caller is gate 3 by construction. Tagging here rather
    // than inside it keeps the flag set exactly where a commit rewrite is the
    // answer — never on the body refusal, which a rewrite would not touch.
    if (error instanceof TrackingError) error.commitRewritable = true;
    throw taggedGate(error, GATE_COMMIT);
  }
}

function messageSubject(message) {
  return message.split(/\r?\n/, 1)[0] ?? "";
}

function isMergeInProgress() {
  return (
    run("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], {
      allowFailure: true,
    }).status === 0
  );
}

/**
 * `.lisa.config.json` as it stands at one commit, or `{}` when it cannot be
 * read there.
 *
 * Read from the BASE of the comparison rather than from the working tree, and
 * that is the whole security posture of the deploy-chain exemption below: on a
 * pull request the working tree is the HEAD's, so a branch could otherwise
 * declare ITSELF protected by adding a `deploy.branches` entry in the same
 * change and exempt every one of its own commits. Same hole, same remedy, as
 * `threshold-ratchet` reading its chain from the baseline config.
 *
 * An unreadable or unparseable config yields no chain, so the exemption is
 * simply skipped — fail-safe strict, exactly as `remoteDefaultRef` treats a ref
 * it cannot resolve.
 * @param {string | undefined} ref Commit-ish to read the config at.
 * @returns {object} Parsed config, or an empty object.
 */
function configAt(ref) {
  if (!ref || process.env.LISA_TRACKING_CONFIG_FILE) return readConfig();
  const result = run("git", ["show", `${ref}:.lisa.config.json`], {
    allowFailure: true,
  });
  // probe-direction: fail-closed — an empty config grants no deploy-chain
  // exemption, so a config that cannot be read at the base makes the gate
  // stricter, never looser.
  if (result.status !== 0) return {};
  try {
    return JSON.parse(result.stdout);
  } catch {
    // probe-direction: fail-closed — same as above: unparseable config, no
    // exemption granted.
    return {};
  }
}

/**
 * Existing refs for every branch the deploy chain declares.
 *
 * Remote-tracking first, because that is the copy CI fetched from the forge and
 * the one a pull request's author cannot point anywhere. The local fallback is
 * for a developer running the validator by hand, where no remote-tracking ref
 * need exist; it is inert under `actions/checkout`, which creates no
 * `refs/heads/*` beyond the one it builds.
 *
 * A declared branch with no ref at all is skipped rather than guessed at.
 * @param {string | undefined} configRef Commit-ish whose config declares the chain.
 * @param {string} remote Remote whose tracking refs to prefer. Required — see
 *   `commitOutcome` for why this is never defaulted.
 * @returns {string[]} Fully qualified refs, in declaration order.
 */
function deployChainRefs(configRef, remote) {
  const branches = configAt(configRef)?.deploy?.branches;
  if (!branches || typeof branches !== "object") return [];
  const refs = [];
  for (const value of Object.values(branches)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const name = value.trim();
    const candidate = [
      `refs/remotes/${remote}/${name}`,
      `refs/heads/${name}`,
    ].find(
      ref =>
        run("git", ["rev-parse", "-q", "--verify", ref], { allowFailure: true })
          .status === 0
    );
    if (candidate && !refs.includes(candidate)) refs.push(candidate);
  }
  return refs;
}

/**
 * Which of these commits are ALREADY on a deploy-chain branch.
 *
 * The case this exists for: on a `staging` -> `dev` back-merge,
 * `git rev-list <base>..<head>` is the OTHER branch's already-authored commits
 * — they predate the trailer convention and belong to somebody else's pull
 * request. Their traceability was established when they were authored and
 * merged; re-asserting it at merge time asks a question whose only answer is
 * rewriting a protected branch's history, so every back-merge pull request was
 * structurally unable to pass. A forward promote carries the same shape.
 *
 * Reachability, not branch identity, is the discriminator, and that is what
 * keeps the exemption narrow. A sync branch's own newly authored commits sit on
 * no deploy-chain branch, so they are still checked — the difference between
 * "this pull request introduces nothing new" and "this pull request introduces
 * work nobody can trace". An ordinary feature branch is untouched for the same
 * reason: nothing on it has landed on the chain yet.
 * @param {string[]} commits Commits in the range, as full object ids.
 * @param {string | undefined} configRef Commit-ish whose config declares the chain.
 * @param {string} remote Remote whose tracking refs name the chain branches.
 * @returns {Set<string>} The subset already reachable from a deploy-chain branch.
 */
function protectedCommits(commits, configRef, remote) {
  if (commits.length === 0) return new Set();
  const refs = deployChainRefs(configRef, remote);
  if (refs.length === 0) return new Set();
  // One walk, bounded by what is NOT on the chain — on a back-merge, almost
  // nothing. Whatever rev-list still reports is unreachable from the chain, so
  // the rest of the range is reachable from it.
  const unreached = new Set(
    git(["rev-list", ...commits, "--not", ...refs])
      .split("\n")
      .filter(Boolean)
  );
  return new Set(commits.filter(sha => !unreached.has(sha)));
}

function commitExemption(sha, onProtectedBranch = new Set()) {
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).split(/\s+/);
  if (parents.length > 2) return "merge";
  if (RELEASE_SUBJECT.test(git(["show", "-s", "--format=%s", sha])))
    return "release";
  return onProtectedBranch.has(sha) ? "protected" : undefined;
}

function safeJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new TrackingError(`${context} returned malformed JSON`);
  }
}

function namesFrom(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === "string" ? item : item?.name))
    .filter(name => typeof name === "string")
    .map(name => name.toLowerCase());
}

function assertRepoScope(ref, contract, labels, components = []) {
  // #1957: mirror the intake-side scoping rule uniformly across trackers
  // (plugins/lisa/rules/reference/config-resolution.md:949,:968): a work item
  // is repo-scoped by the label `repo:<name>` OR the bare `<name>` label
  // (Sentry-provenance items carry only the bare repo name). The match is the
  // exact repo short name, case-insensitive via namesFrom's lowercasing —
  // never substring or prefix. Jira additionally accepts a component equal to
  // the bare name.
  const bare = contract.identityRepo.toLowerCase();
  const expected = `repo:${bare}`;
  const labelNames = namesFrom(labels);
  const componentNames = namesFrom(components);
  if (
    !labelNames.includes(expected) &&
    !labelNames.includes(bare) &&
    !componentNames.includes(bare)
  ) {
    throw new TrackingError(
      `Work item ${ref} is not scoped to repository ${contract.identityRepo}; require label ${expected} or bare label ${bare}`
    );
  }
}

// CLAIM-STATE ENFORCEMENT USED TO LIVE HERE, and it is deliberately gone.
//
// `assertClaimedLifecycle` refused any work item that did not already carry the
// claimed lifecycle role. It was the only check on this path that could refuse
// work that was entirely correct — right ticket, right trailer, right branch,
// the tracker's label simply not transitioned yet — and it did, twice in one
// day. One of those stalled an agent, which spawned two subagents that died,
// and needed a human to move a label before anything could commit again.
//
// It protected nothing in exchange. A label's timing says nothing about whether
// a commit belongs to the ticket it names; the trailer's FORMAT is what carries
// traceability, and that is checked offline on every commit, always. The
// lifecycle roles remain real and are still what intake dispatches on — they
// are just no longer a precondition for committing.
//
// The checks it sat beside stay: the item must exist, be open, be scoped to
// this repository, and be a leaf. Those can only fail on something genuinely
// wrong, and they now run only when a credential happens to be present.

function assertLeaf(ref, type, childStates = []) {
  const normalizedType = String(type ?? "")
    .replace(/^type:/i, "")
    .trim()
    .toLowerCase();
  const openChildren = childStates.filter(
    state =>
      !["closed", "done", "completed", "canceled", "cancelled"].includes(
        String(state ?? "").toLowerCase()
      )
  );
  if (normalizedType === "epic" || openChildren.length > 0) {
    throw new TrackingError(
      `Work item ${ref} is a container; bind a claimed leaf with no open children`
    );
  }
}

function typeFromLabels(labels) {
  return namesFrom(labels).find(name => name.startsWith("type:"));
}

/**
 * Every sub-issue state for a GitHub issue, following pagination.
 *
 * Two things this gets right that the single-page version did not:
 *
 * A transport failure is classified through githubFailure, exactly as
 * githubIssue does. Raising a bare TrackingError meant "gh is missing" and
 * "the network is down" read as "this work item is invalid", so validateLive
 * could not degrade and the hook hard-failed on a laptop with no connection.
 *
 * And it pages. `subIssues(first:100)` silently truncated, so an Epic with
 * more than 100 children reported only the first page — assertLeaf then saw
 * no open child beyond it and treated a container as a leaf, which is the
 * precise condition leaf-only-lifecycle exists to prevent.
 * @param {string} ref Canonical work-item ref, for error messages.
 * @param {object} contract Resolved tracker contract.
 * @param {string|number} number GitHub issue number.
 * @returns {string[]} State of every sub-issue.
 */
function githubHierarchy(ref, contract, number) {
  const [owner, repo] = contract.repository.split("/");
  const query =
    "query($owner:String!,$repo:String!,$number:Int!,$after:String){repository(owner:$owner,name:$repo){issue(number:$number){subIssues(first:100,after:$after){nodes{state}pageInfo{hasNextPage endCursor}}}}}";
  const states = [];
  const cursor = { after: null };

  do {
    const args = [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
    ];
    if (cursor.after) args.push("-F", `after=${cursor.after}`);
    const result = run("gh", args, { allowFailure: true });
    if (result.status !== 0) throw githubFailure(result, ref);

    const response = safeJson(result.stdout, `GitHub issue ${ref} hierarchy`);
    const subIssues = response.data?.repository?.issue?.subIssues;
    if (!Array.isArray(subIssues?.nodes)) {
      throw new TrackingError(
        `GitHub issue ${ref} did not expose native sub-issue hierarchy`
      );
    }
    states.push(...subIssues.nodes.map(child => child.state));
    cursor.after = subIssues.pageInfo?.hasNextPage
      ? subIssues.pageInfo.endCursor
      : null;
  } while (cursor.after);

  return states;
}

/**
 * The oldest `gh` that understands every field this module asks for.
 *
 * `closedByPullRequestsReferences` landed in gh 2.73.0. An older CLI does not
 * fail informatively — it reports an unknown-field error naming a JSON key,
 * which reads like a Lisa bug rather than an out-of-date tool.
 */
const GH_MINIMUM = [2, 73, 0];

let ghVersionChecked = false;

/**
 * Whether one dotted version sorts before another.
 *
 * Compared part by part rather than as numbers or text, because both of the
 * obvious shortcuts are wrong in ways that would silently misjudge: `2.9.0`
 * parses as the float 2.9 and beats `2.73.0`, and string comparison puts "2.9"
 * after "2.73" for the same reason.
 * @param {number[]} actual The version found.
 * @param {number[]} minimum The version required.
 * @returns {boolean} True when `actual` precedes `minimum`.
 */
function isOlder(actual, minimum) {
  const first = minimum.findIndex((part, index) => actual[index] !== part);
  return first !== -1 && actual[first] < minimum[first];
}

/**
 * Refuse early when the installed `gh` predates a field this module needs.
 *
 * Deliberately NOT fail-closed on an unreadable version. This is a diagnostic,
 * not a gate: its whole job is turning an obscure downstream error into a
 * sentence naming the real problem. Blocking because `gh --version` printed
 * something unfamiliar would invent a failure where the tool may be perfectly
 * capable, and the call that follows still surfaces any genuine incompatibility
 * on its own. So an unparseable version means "say nothing and let the real
 * call speak", never "assume it is fine" — nothing is being reported as proved.
 *
 * Checked once per process: this sits on the path of every tracker read, and a
 * subprocess per call to re-learn an answer that cannot change mid-run is pure
 * cost.
 * @param {Function} [exec] Command runner, injected for tests.
 * @returns {void}
 */
export function assertGhVersion(exec = run) {
  if (ghVersionChecked) return;
  ghVersionChecked = true;
  const printed = exec("gh", ["--version"], { allowFailure: true }).stdout;
  const found = /gh version (\d+)\.(\d+)\.(\d+)/u.exec(printed ?? "");
  if (!found) return;

  const actual = found.slice(1, 4).map(Number);
  if (!isOlder(actual, GH_MINIMUM)) return;
  throw new TrackingError(
    `gh ${actual.join(".")} is too old for work-item tracking, which needs ` +
      `${GH_MINIMUM.join(".")} or newer.\nThe pull-request backlink is read ` +
      `from the "closedByPullRequestsReferences" field, added in gh ` +
      `${GH_MINIMUM.join(".")}.\nUpgrade the GitHub CLI, then retry.`
  );
}

/**
 * Reset the once-per-process version memo. Exported for tests only.
 * @returns {void}
 */
export function resetGhVersionCheck() {
  ghVersionChecked = false;
}

function githubIssue(ref, contract) {
  assertGhVersion();
  const number = ref.slice(ref.lastIndexOf("#") + 1);
  const result = run(
    "gh",
    [
      "issue",
      "view",
      number,
      "--repo",
      contract.repository,
      "--json",
      "number,url,state,labels,comments,closedByPullRequestsReferences",
    ],
    {
      allowFailure: true,
    }
  );
  if (result.status !== 0) throw githubFailure(result, ref);
  const issue = safeJson(result.stdout, `GitHub issue ${ref}`);
  if (String(issue.number) !== number)
    throw new TrackingError(`GitHub returned the wrong issue for ${ref}`);
  if (String(issue.state ?? "").toUpperCase() !== "OPEN") {
    throw new TrackingError(
      `GitHub issue ${ref} is closed; bind an open work item`
    );
  }
  if (!contract.repositoryIsIdentity) {
    assertRepoScope(ref, contract, issue.labels);
  }
  assertLeaf(
    ref,
    typeFromLabels(issue.labels),
    githubHierarchy(ref, contract, number)
  );
  return issue;
}

function jiraStatusCategory(issue) {
  return String(
    issue.fields?.status?.statusCategory?.key ??
      issue.status?.statusCategory?.key ??
      issue.statusCategory?.key ??
      ""
  ).toLowerCase();
}

function jiraCredentials(contract) {
  const token = process.env.JIRA_API_TOKEN || process.env.ATLASSIAN_API_TOKEN;
  const login = process.env.JIRA_LOGIN || contract.email;
  const server = String(contract.site || process.env.JIRA_SERVER || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const baseUrl = contract.cloudId
    ? `https://api.atlassian.com/ex/jira/${encodeURIComponent(contract.cloudId)}`
    : server
      ? `https://${server}`
      : "";
  return token && login && baseUrl ? { token, login, baseUrl } : undefined;
}

function jiraIssue(ref, contract) {
  const credentials = jiraCredentials(contract);
  if (credentials) {
    const url = `${credentials.baseUrl}/rest/api/3/issue/${encodeURIComponent(ref)}?fields=project,status,labels,components,issuetype,subtasks,comment`;
    const result = secureCurl(
      [url],
      [
        ["user", `${credentials.login}:${credentials.token}`],
        ["header", ACCEPT_JSON],
      ],
      { allowFailure: true }
    );
    if (result.status !== 0)
      throw new TrackingError(
        `Jira ticket ${ref} does not exist or is inaccessible`
      );
    const issue = safeJson(result.stdout, `Jira ticket ${ref}`);
    if (
      String(issue.key ?? "").toUpperCase() !== ref ||
      String(issue.fields?.project?.key ?? "").toUpperCase() !==
        contract.project
    ) {
      throw new TrackingError(
        `Jira ticket ${ref} is outside configured project ${contract.project}`
      );
    }
    const statusCategory = jiraStatusCategory(issue);
    if (!statusCategory) {
      throw new TrackingError(
        `Jira ticket ${ref} did not expose a status category`
      );
    }
    if (statusCategory === "done") {
      throw new TrackingError(
        `Jira ticket ${ref} is done; bind an active work item`
      );
    }
    assertRepoScope(
      ref,
      contract,
      issue.fields?.labels,
      issue.fields?.components
    );
    assertLeaf(
      ref,
      issue.fields?.issuetype?.name,
      (issue.fields?.subtasks ?? []).map(child =>
        jiraStatusCategory(child) === "done" ? "done" : "open"
      )
    );
    return issue;
  }

  if (
    run("sh", ["-c", "command -v acli >/dev/null 2>&1"], { allowFailure: true })
      .status === 0
  ) {
    if (!contract.site) {
      throw new TrackerUnreachableError(
        `Jira cannot be reached for ${ref}: acli is installed but ` +
          `atlassian.site is unset, so the active account cannot be ` +
          `identity-matched.\nThis is a configuration gap, not a problem with ` +
          `the work item.`
      );
    }
    const auth = run("acli", ["auth", "status"], { allowFailure: true });
    if (
      auth.status !== 0 ||
      !auth.stdout.toLowerCase().includes(contract.site.toLowerCase())
    ) {
      throw new TrackerUnreachableError(
        `Jira cannot be reached for ${ref}: acli is not authenticated to ` +
          `configured site ${contract.site}.\nThis is a credential gap, not a ` +
          `problem with the work item.`
      );
    }
    const result = run(
      "acli",
      ["jira", "workitem", "view", ref, "--fields", "*all", "--json"],
      { allowFailure: true }
    );
    if (result.status !== 0)
      throw new TrackingError(
        `Jira ticket ${ref} does not exist or is inaccessible`
      );
    const issue = safeJson(result.stdout, `Jira ticket ${ref}`);
    if (String(issue.key ?? "").toUpperCase() !== ref)
      throw new TrackingError(`Jira returned the wrong ticket for ${ref}`);
    const statusCategory = jiraStatusCategory(issue);
    if (!statusCategory) {
      throw new TrackingError(
        `Jira ticket ${ref} did not expose a status category`
      );
    }
    if (statusCategory === "done") {
      throw new TrackingError(
        `Jira ticket ${ref} is done; bind an active work item`
      );
    }
    assertRepoScope(
      ref,
      contract,
      issue.fields?.labels ?? issue.labels,
      issue.fields?.components ?? issue.components
    );
    assertLeaf(
      ref,
      issue.fields?.issuetype?.name ?? issue.issueType?.name,
      (issue.fields?.subtasks ?? issue.subtasks ?? []).map(child =>
        jiraStatusCategory(child) === "done" ? "done" : "open"
      )
    );
    return issue;
  }
  // Same rule as the Linear and GitHub paths: no credential means Jira could
  // not be ASKED. Refusing here made the absence of a token a verdict about the
  // work item, which is the one thing it can never be.
  throw new TrackerUnreachableError(
    `Jira cannot be reached for ${ref}: no identity-matched acli, and no ` +
      `ATLASSIAN_API_TOKEN/JIRA_API_TOKEN with JIRA_LOGIN and ` +
      `atlassian.cloudId/site.\nThis is a credential gap, not a problem with ` +
      `the work item.`
  );
}

/**
 * The Linear token, from the environment and nowhere else.
 *
 * There used to be a third step here: a macOS keychain lookup for a
 * Lisa-specific entry, deliberately not named again anywhere in this file. It
 * read as a fallback and was, on the machines that actually ran it, the SOLE
 * source — the two environment variables above it were unset. So a deprecated
 * credential was quietly load-bearing, and the day it was retired every commit
 * carrying a `Work-Item:` trailer would have been refused, for humans and
 * agents alike.
 *
 * Worse, it regenerated itself. An agent blocked by the hook opened this file
 * to understand the refusal, found the keychain call, and adopted the
 * deprecated path; three did exactly that in one day. A credential that teaches
 * itself to everyone who trips over it does not age out — removing the code is
 * the only thing that ends it.
 * @param {string} workspace Configured Linear workspace slug.
 * @returns {string | undefined} The token, or undefined when none is set.
 */
function readLinearKey(workspace) {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  const suffix = workspace.toLowerCase().replace(/-/g, "_");
  return process.env[`LINEAR_API_KEY_${suffix}`] || undefined;
}

function linearIssue(ref, contract) {
  const token = readLinearKey(contract.workspace);
  // UNREACHABLE, not invalid. No token means Linear could not be ASKED, which
  // is the same class as a missing binary or a refused credential — never a
  // verdict about the work item. The trailer has already been proved present,
  // well formed, and bound to this branch, offline; that is what traceability
  // rests on. What is skipped here is re-run with credentials by the required
  // pull-request check before anything can merge.
  if (!token)
    throw new TrackerUnreachableError(
      `Linear cannot be reached for ${ref}: no LINEAR_API_KEY (or ` +
        `LINEAR_API_KEY_${contract.workspace.toLowerCase().replace(/-/g, "_")}) ` +
        `is set.\nThis is a credential gap, not a problem with the work item.`
    );
  const query =
    "query($id:String!){issue(id:$id){id identifier team{key} state{name type} labels{nodes{name}} children{nodes{state{type}}} attachments{nodes{url}} comments{nodes{body}}}}";
  const payload = JSON.stringify({ query, variables: { id: ref } });
  const result = secureCurl(
    ["https://api.linear.app/graphql"],
    [
      ["request", "POST"],
      ["header", CONTENT_TYPE_JSON],
      ["header", `Authorization: ${token}`],
      [DATA_BINARY, payload],
    ],
    { allowFailure: true }
  );
  if (result.status !== 0)
    throw new TrackingError(
      `Linear issue ${ref} does not exist or is inaccessible`
    );
  const response = safeJson(result.stdout, `Linear issue ${ref}`);
  if (Array.isArray(response.errors) && response.errors.length > 0)
    throw new TrackingError(`Linear issue ${ref} validation failed`);
  const issue = response.data?.issue;
  if (
    !issue ||
    String(issue.identifier ?? "").toUpperCase() !== ref ||
    String(issue.team?.key ?? "").toUpperCase() !== contract.teamKey
  ) {
    throw new TrackingError(
      `Linear issue ${ref} does not exist in configured team ${contract.teamKey}`
    );
  }
  const stateType = String(issue.state?.type ?? "").toLowerCase();
  if (!stateType) {
    throw new TrackingError(
      `Linear issue ${ref} did not expose a workflow state`
    );
  }
  if (["completed", "canceled", "cancelled"].includes(stateType)) {
    throw new TrackingError(
      `Linear issue ${ref} is terminal; bind an active work item`
    );
  }
  assertRepoScope(ref, contract, issue.labels?.nodes);
  assertLeaf(
    ref,
    typeFromLabels(issue.labels?.nodes),
    (issue.children?.nodes ?? []).map(child => child.state?.type)
  );
  return issue;
}

/**
 * Ask the tracker whether this work item may be committed against.
 *
 * When the tracker cannot be REACHED, the live checks are reported as skipped
 * rather than enforced or silently dropped. Everything checkable without a
 * network — the trailer is present, well formed, and matches this branch's
 * binding — has already run by the time this is called, and the semantic
 * checks it cannot do here are re-run in CI by a REQUIRED status check
 * ("Work-Item Traceability"), with credentials, before anything can merge.
 *
 * So the guarantee is not lost; it moves to a gate that cannot be bypassed.
 * That is the whole justification, and it holds only while that check stays
 * required — if it is ever made optional, this degradation becomes a hole.
 *
 * The alternative was worse in both directions. Refusing outright strands
 * finished, green work on any surface without a GitHub credential — a cloud
 * container, for one — and the agent's only remaining move is a bypass that
 * skips the offline checks too. Enforcing nothing hides the difference between
 * "could not ask" and "the tracker said no".
 * @param {string} ref Work item reference.
 * @param {object} [contract] Tracker contract.
 * @returns {object|undefined} The live item, or undefined when unreachable.
 */
function validateLive(ref, contract = trackerContract()) {
  // Not a degradation and not a skip — under `trailer` the tracker's answer is
  // no part of the contract this project asked to have proved, so there is
  // nothing to report and nothing to contact. A warning here would be noise on
  // every commit in a project that made a deliberate choice.
  if (contract.verify !== "full") return undefined;
  try {
    if (contract.provider === "github") return githubIssue(ref, contract);
    if (contract.provider === "jira") return jiraIssue(ref, contract);
    return linearIssue(ref, contract);
  } catch (error) {
    if (!(error instanceof TrackerUnreachableError)) throw error;
    // Loud on stderr, never silent: a degradation nobody sees is the failure
    // mode this exists to avoid, not a milder version of it.
    console.error(
      `\n⚠️  Work-item live validation SKIPPED for ${ref}.\n` +
        `${error.message}\n\n` +
        `The offline checks still ran: the trailer is present, well formed and ` +
        `bound to this branch.\nWhat could not be checked here — that the item ` +
        `is open, claimed and a leaf — is re-run\nwith credentials by the ` +
        `required "Work-Item Traceability" check before this can merge.\n`
    );
    return undefined;
  }
}

/**
 * Opening punctuation that can hug a URL in prose or markdown, stripped before
 * compare.
 *
 * A URL is recognised as a whitespace-delimited token, so anything a writer
 * wraps around it — `<url>`, a trailing full stop, a closing bracket — would
 * otherwise make an exact comparison fail against a backlink that is perfectly
 * valid. Being too strict here fails closed and merely annoys; being too loose
 * is the defect below.
 */
const URL_OPENERS = new Set(["<", "(", "["]);

/** The closing counterparts, plus the sentence punctuation prose leaves behind. */
const URL_CLOSERS = new Set([">", ")", "]", ".", ",", ";", ":"]);

/**
 * One token with those edges removed.
 *
 * Two index scans rather than `/^[<([]+|[>)\].,;:]+$/`. A quantified class
 * pinned to `$` has to be re-attempted from every position in the token before
 * it can fail, which is super-linear in the token's length — S5852, and this
 * runs over comment bodies written by anyone who can comment on the pull
 * request. Walking the ends is one pass from each side and cannot backtrack.
 * @param {string} token One whitespace-delimited token.
 * @returns {string} The token without its leading and trailing punctuation.
 */
function trimUrlEdges(token) {
  let start = 0;
  let end = token.length;
  while (start < end && URL_OPENERS.has(token[start])) start += 1;
  while (end > start && URL_CLOSERS.has(token[end - 1])) end -= 1;
  return token.slice(start, end);
}

/**
 * The URLs a comment offers as backlinks, as discrete tokens.
 * @param {string} text Comment body.
 * @returns {string[]} Whitespace-delimited tokens, trimmed of edge punctuation.
 */
function backlinkTokens(text) {
  return text.split(/\s+/).map(trimUrlEdges);
}

/**
 * Whether a value carries a backlink to exactly this pull request.
 *
 * The comparison is token equality, not containment. `value.includes(prUrl)`
 * was a substring test against a URL ending in the PR number, so a comment
 * linking PR #123 satisfied the gate for PR #12 — `.../pull/12` is a prefix of
 * `.../pull/123`. That is a fail-open in the check whose entire job is proving
 * a change is bound to its own work item, and it fails silently: the check goes
 * green and reports the binding verified.
 *
 * Both native paths already compare with `===`. Only this fallback was loose,
 * and it is the path GitHub Issues actually uses, having no native PR-link
 * field. Exported so the comparison can be asserted directly — a permissive
 * comparison returns `true` rather than throwing, so nothing observable changes
 * without an assertion on the returned boolean.
 * @param {unknown} value Comment body, or a structure containing one.
 * @param {string} prUrl The pull request URL that must be linked.
 * @returns {boolean} True when this exact pull request is linked.
 */
export function textContainsBacklink(value, prUrl) {
  if (typeof value === "string")
    return value.includes(MARKER) && backlinkTokens(value).includes(prUrl);
  if (Array.isArray(value))
    return value.some(item => textContainsBacklink(item, prUrl));
  if (value && typeof value === "object")
    return Object.values(value).some(item => textContainsBacklink(item, prUrl));
  return false;
}

/**
 * The managed backlink comment's body.
 *
 * One line, and the whole body — so establishing the backlink is a whole-body
 * replace rather than an append, which is what makes a rerun converge instead
 * of accumulating. Nothing else is carried here on purpose: the milestone and
 * the merge SHA belong to the vendor sync skills' progress notes, and putting
 * them in this body would make every rerun a content change.
 * @param {string} prUrl Pull request URL.
 * @returns {string} The comment body.
 */
function backlinkBody(prUrl) {
  return `${MARKER} ${prUrl}`;
}

/**
 * Whether a comment payload is Lisa's managed backlink comment.
 *
 * Shape-agnostic deliberately: GitHub and Linear return a plain string body,
 * Jira returns an Atlassian Document Format tree. Serialising covers all three
 * without a per-provider walker, and the marker is distinctive enough that a
 * false positive would have to be a comment quoting it verbatim — which is
 * still Lisa's comment to reuse rather than a second one to add.
 * @param {unknown} body Comment body in whatever shape the provider returned.
 * @returns {boolean} True when this is the managed comment.
 */
function carriesMarker(body) {
  return JSON.stringify(body ?? "").includes(MARKER);
}

/**
 * Lisa's managed backlink comments, split by whether one is THIS pull request's.
 *
 * The whole defect this exists to remove is in the word "the": the writers used
 * to look for *a* managed comment and rewrite it, so a work item with a second
 * pull request against it had the first one's backlink silently repointed. The
 * earlier pull request then failed a gate it had already passed, for a reason
 * that was not in front of anyone looking at it, and the tool said `updated` —
 * which reads as "added a link", not "took someone else's away".
 *
 * `[lisa-pr-link]` is a statement about a PAIR: *this pull request is linked to
 * this item*. Storing a pair in a single slot means every new pair evicts the
 * last, so the comment is keyed on the pull request it names and a work item
 * carries one per pull request. Nothing here needs a migration: an item holding
 * one legacy comment is simply an item where `mine` matches or it does not.
 *
 * This is deliberately NOT stack-awareness. A fix and its follow-up, a revert
 * and its replacement, a pull request reopened or recreated against a different
 * base, and work split across repositories all put two pull requests on one
 * item, and none of them involve a stack.
 * @param {readonly unknown[]} comments Comments as the provider returned them.
 * @param {string} prUrl The pull request being discharged.
 * @param {(comment: unknown) => unknown} bodyOf Reads a comment's body.
 * @returns {{mine: unknown, others: number}} This PR's comment, and how many
 *   managed comments belong to OTHER pull requests.
 */
function partitionBacklinks(comments, prUrl, bodyOf) {
  const mine = [];
  let others = 0;
  for (const comment of comments) {
    const body = bodyOf(comment);
    if (!carriesMarker(body)) continue;
    if (textContainsBacklink(body, prUrl)) mine.push(comment);
    else others += 1;
  }
  return { mine: mine[0], others };
}

/**
 * Say what a backlink write did, including what it did NOT touch.
 *
 * The sibling count is reported rather than left implicit because a tool that
 * writes to a shared surface should say what else is on it. `updated` was the
 * only signal the old writer gave before it evicted another pull request's
 * link, and one word is not enough to distinguish "added" from "replaced".
 * Exported so the wording can be asserted without a tracker.
 * @param {{change: string, others: number}} outcome What the writer did.
 * @param {string} ref Canonical work-item reference.
 * @param {string} prUrl Pull request URL.
 * @returns {string} The operator-readable report.
 */
export function backlinkReport(outcome, ref, prUrl) {
  const line = `work-item backlink ${outcome.change} on ${ref}: ${MARKER} ${prUrl}`;
  if (!outcome.others) return line;
  const plural = outcome.others === 1 ? "" : "s";
  return (
    `${line}\n  ${outcome.others} other pull request${plural} already linked ` +
    `to ${ref}, left untouched — an item carries one backlink per pull ` +
    `request, and discharging one never removes another.`
  );
}

/**
 * Establish the backlink on a GitHub issue.
 * @param {string} ref Canonical `owner/repo#number` reference.
 * @param {string} prUrl Pull request URL.
 * @returns {{change: string, others: number}} What changed, and how many other
 *   pull requests are linked to this item and were left alone.
 */
function githubBacklink(ref, prUrl) {
  const [repository, number] = ref.split("#");
  const listing = run(
    "gh",
    [
      "api",
      "--paginate",
      `repos/${repository}/issues/${number}/comments?per_page=100`,
    ],
    { allowFailure: true }
  );
  if (listing.status !== 0) throw githubFailure(listing, ref);
  const comments = safeJson(listing.stdout, `GitHub comments on ${ref}`);
  // This listing is the read-before-write, and it is fetched here rather than
  // passed in for exactly that reason: the version you last wrote is not the
  // version that is live on a surface other agents also comment on.
  const { mine, others } = partitionBacklinks(
    Array.isArray(comments) ? comments : [],
    prUrl,
    comment => comment?.body
  );
  const body = backlinkBody(prUrl);
  if (mine && mine.body === body) return { change: "unchanged", others };
  // PATCH only ever targets THIS pull request's own comment. A managed comment
  // naming a different pull request is that pull request's proof of gate 5,
  // and rewriting it would fail a gate that had already passed.
  const [method, endpoint] = mine
    ? ["PATCH", `repos/${repository}/issues/comments/${mine.id}`]
    : ["POST", `repos/${repository}/issues/${number}/comments`];
  run("gh", ["api", "--method", method, endpoint, "--field", `body=${body}`], {
    error: `could not write the backlink comment on ${ref}`,
  });
  return { change: mine ? "updated" : "created", others };
}

/**
 * Send one Linear GraphQL document, refusing on either failure surface.
 *
 * GraphQL answers an invalid mutation with HTTP 200 and an `errors` array, so
 * a status-only check reports success for a comment that was never written.
 * @param {string} token Linear API key.
 * @param {string} query The document.
 * @param {object} variables Its variables.
 * @param {string} context What the call was for, for the message.
 * @returns {object} The `data` payload.
 */
function linearGraphql(token, query, variables, context) {
  const result = secureCurl(
    ["https://api.linear.app/graphql"],
    [
      ["request", "POST"],
      ["header", CONTENT_TYPE_JSON],
      ["header", `Authorization: ${token}`],
      [DATA_BINARY, JSON.stringify({ query, variables })],
    ],
    { allowFailure: true }
  );
  if (result.status !== 0) throw new TrackingError(`${context} failed`);
  const response = safeJson(result.stdout, context);
  if (Array.isArray(response.errors) && response.errors.length > 0)
    throw new TrackingError(
      `${context} failed: ${response.errors[0]?.message}`
    );
  return response.data ?? {};
}

/**
 * Establish the backlink on a Linear issue.
 * @param {string} ref Canonical `KEY-123` identifier.
 * @param {string} prUrl Pull request URL.
 * @param {object} contract Resolved tracker contract.
 * @returns {{change: string, others: number}} What changed, and how many other
 *   pull requests are linked to this item and were left alone.
 */
function linearBacklink(ref, prUrl, contract) {
  const token = readLinearKey(contract.workspace);
  // A refusal, not a degradation, and the asymmetry with `linearIssue` is
  // deliberate: this is a WRITE. Reading can be skipped and re-run later by the
  // pull-request check; a comment that was never posted stays never posted, and
  // reporting success would leave the backlink gate failing later with nothing
  // to explain it.
  if (!token)
    throw new TrackingError(
      `writing a Linear backlink requires LINEAR_API_KEY (or ` +
        `LINEAR_API_KEY_${contract.workspace.toLowerCase().replace(/-/g, "_")})`
    );
  const issue = linearGraphql(
    token,
    "query($id:String!){issue(id:$id){id comments{nodes{id body}}}}",
    { id: ref },
    `Linear issue ${ref} lookup`
  ).issue;
  if (!issue?.id)
    throw new TrackingError(
      `Linear issue ${ref} does not exist or is inaccessible`
    );
  const { mine, others } = partitionBacklinks(
    issue.comments?.nodes ?? [],
    prUrl,
    comment => comment?.body
  );
  const body = backlinkBody(prUrl);
  if (mine && mine.body === body) return { change: "unchanged", others };
  if (mine) {
    linearGraphql(
      token,
      "mutation($id:String!,$body:String!){commentUpdate(id:$id,input:{body:$body}){success}}",
      { body, id: mine.id },
      `Linear backlink update on ${ref}`
    );
    return { change: "updated", others };
  }
  linearGraphql(
    token,
    "mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success}}",
    { body, id: issue.id },
    `Linear backlink comment on ${ref}`
  );
  return { change: "created", others };
}

/**
 * The managed comment as an Atlassian Document Format tree.
 *
 * A single text node, so the marker and the URL land in one string — which is
 * what `textContainsBacklink` walks the tree looking for. Splitting them across
 * nodes would write a comment the reader accepts visually and the check
 * rejects.
 * @param {string} prUrl Pull request URL.
 * @returns {object} The ADF document.
 */
function jiraCommentDocument(prUrl) {
  return {
    content: [
      {
        content: [{ text: backlinkBody(prUrl), type: "text" }],
        type: "paragraph",
      },
    ],
    type: "doc",
    version: 1,
  };
}

/**
 * Establish the backlink on a Jira ticket.
 *
 * Requires API credentials rather than falling back to `acli`: the read path
 * may degrade to whatever can answer, but a write that silently does not
 * happen is exactly the failure this command exists to remove.
 * @param {string} ref Canonical `KEY-123` reference.
 * @param {string} prUrl Pull request URL.
 * @param {object} contract Resolved tracker contract.
 * @returns {{change: string, others: number}} What changed, and how many other
 *   pull requests are linked to this item and were left alone.
 */
function jiraBacklink(ref, prUrl, contract) {
  const credentials = jiraCredentials(contract);
  if (!credentials)
    throw new TrackingError(
      "writing a Jira backlink requires ATLASSIAN_API_TOKEN/JIRA_API_TOKEN with JIRA_LOGIN and atlassian.cloudId/site"
    );
  const issueUrl = `${credentials.baseUrl}/rest/api/3/issue/${encodeURIComponent(ref)}/comment`;
  const auth = [
    ["user", `${credentials.login}:${credentials.token}`],
    ["header", ACCEPT_JSON],
  ];
  const listing = secureCurl([`${issueUrl}?maxResults=100`], auth, {
    allowFailure: true,
  });
  if (listing.status !== 0)
    throw new TrackingError(`Jira ticket ${ref} comments are inaccessible`);
  const existing = safeJson(listing.stdout, `Jira comments on ${ref}`);
  const { mine, others } = partitionBacklinks(
    existing.comments ?? [],
    prUrl,
    comment => comment?.body
  );
  const document = jiraCommentDocument(prUrl);
  const payload = JSON.stringify({ body: document });
  if (mine && JSON.stringify(mine.body) === JSON.stringify(document))
    return { change: "unchanged", others };
  secureCurl(
    [mine ? `${issueUrl}/${encodeURIComponent(mine.id)}` : issueUrl],
    [
      ...auth,
      ["request", mine ? "PUT" : "POST"],
      ["header", CONTENT_TYPE_JSON],
      [DATA_BINARY, payload],
    ],
    { error: `could not write the backlink comment on ${ref}` }
  );
  return { change: mine ? "updated" : "created", others };
}

/**
 * Establish the ticket-side backlink, whatever the tracker.
 *
 * This is the producer for the comment `assertBacklink` consumes, and it lives
 * in this file for that reason: the requirement was documented in a SKILL.md
 * and enforced here, so nothing executable ever wrote it and a required check
 * failed on a step no command performed.
 *
 * Every provider `assertBacklink` reads is written here. A provider that is
 * not refuses loudly rather than returning quietly, because a silent no-op
 * here reproduces the original defect one layer down: the command reports
 * success and the check still fails.
 * @param {string} ref Canonical work-item reference.
 * @param {string} prUrl Pull request URL.
 * @param {object} contract Resolved tracker contract.
 * @returns {{change: string, others: number}} What changed, and how many other
 *   pull requests are linked to this item and were left alone.
 */
function postBacklink(ref, prUrl, contract) {
  if (contract.provider === "github") return githubBacklink(ref, prUrl);
  if (contract.provider === "linear")
    return linearBacklink(ref, prUrl, contract);
  if (contract.provider === "jira") return jiraBacklink(ref, prUrl, contract);
  throw new TrackingError(
    `no backlink writer for tracker '${contract.provider}'; ` +
      `github, jira and linear are supported.\nThe Work-Item Traceability check ` +
      `reads a managed ${MARKER} comment for this provider, so it cannot pass ` +
      `until a writer exists here — add one rather than posting by hand.`
  );
}

function assertBacklink(
  ref,
  prUrl,
  contract,
  issue = validateLive(ref, contract)
) {
  // The PR check never degrades, because it IS the re-check the local hooks
  // degrade in favour of. A required status check that passes when it could
  // not reach the tracker would make the whole arrangement circular: local
  // defers to CI, CI defers to nothing.
  if (!issue) {
    throw new TrackingError(
      `cannot verify ${ref} against the tracker, and this check is the one ` +
        `that must.\nLocal hooks may skip live validation when the tracker ` +
        `is unreachable; this check may not,\nbecause it is what they defer ` +
        `to. Fix the tracker credential for this run.`
    );
  }
  if (contract.provider === "github") {
    const native = (issue.closedByPullRequestsReferences ?? []).some(
      pr => pr.url === prUrl
    );
    const fallback = (issue.comments ?? []).some(comment =>
      textContainsBacklink(comment.body, prUrl)
    );
    if (!native && !fallback)
      throw new TrackingError(
        `GitHub issue ${ref} has no verified backlink to ${prUrl}`
      );
    return;
  }
  if (contract.provider === "linear") {
    const native = (issue.attachments?.nodes ?? []).some(
      attachment => attachment.url === prUrl
    );
    const fallback = (issue.comments?.nodes ?? []).some(comment =>
      textContainsBacklink(comment.body, prUrl)
    );
    if (!native && !fallback)
      throw new TrackingError(
        `Linear issue ${ref} has no verified backlink to ${prUrl}`
      );
    return;
  }
  const fallback = textContainsBacklink(
    issue.fields?.comment?.comments ?? issue.comments ?? [],
    prUrl
  );
  if (fallback) return;
  const credentials = jiraCredentials(contract);
  if (credentials) {
    const url = `${credentials.baseUrl}/rest/api/3/issue/${encodeURIComponent(ref)}/remotelink`;
    const result = secureCurl(
      [url],
      [
        ["user", `${credentials.login}:${credentials.token}`],
        ["header", ACCEPT_JSON],
      ],
      { allowFailure: true }
    );
    if (result.status === 0) {
      const links = safeJson(result.stdout, `Jira remote links for ${ref}`);
      if (
        Array.isArray(links) &&
        links.some(link => link.object?.url === prUrl)
      )
        return;
    }
  }
  throw new TrackingError(
    `Jira ticket ${ref} has no verified backlink to ${prUrl}`
  );
}

function assertStateMatches(ref, contract) {
  const state = readState(true);
  if (!state) return;
  assertStateBranch(state);
  if (
    state.provider !== contract.provider ||
    canonicalizeRef(state.ref, contract) !== ref
  ) {
    throw new TrackingError(
      `Work-Item ${ref} does not match this worktree's binding ${state.ref}`
    );
  }
}

/**
 * The binding check for a range that names SEVERAL work items.
 *
 * `assertStateMatches` asks whether the binding IS the range's one item, which
 * a multi-item range has no answer to — picking any single reference out of the
 * set and comparing against that is a coin toss dressed as a check, and it
 * would refuse or accept the same push depending on commit order.
 *
 * The question that still has an answer is containment: the worktree is bound
 * to an item, and that item must be one the range actually carries. A branch
 * bound to something the range never touches is the same mistake the single-ref
 * check catches — work pushed from a worktree tracking something else — and it
 * is still refused here. Fails open on an unbound worktree, exactly as
 * `assertStateMatches` does.
 * @param {string[]} refs Canonical references the range names, in order.
 * @param {object} contract Resolved tracker contract.
 */
function assertStateAmong(refs, contract) {
  const state = readState(true);
  if (!state) return;
  assertStateBranch(state);
  if (state.provider !== contract.provider) {
    throw new TrackingError(
      `Work-item binding provider ${state.provider} does not match configured tracker ${contract.provider}`
    );
  }
  const bound = canonicalizeRef(state.ref, contract);
  if (refs.includes(bound)) return;
  throw new TrackingError(
    `This worktree is bound to ${state.ref}, which none of this range's ` +
      `work items (${refs.join(", ")}) name`
  );
}

/**
 * The work item a branch name encodes, or undefined when it encodes none.
 *
 * The second ground truth `validate-commit` needs. `assertStateMatches` has
 * exactly one notion of what a worktree is working on — the `lisa-track`
 * binding — and when that file is absent it compares the trailer against
 * nothing and accepts any well-formed reference for the configured project.
 * Measured 2026-08-20 on one machine: 3 of 47 linked worktrees carried a
 * binding and the primary checkout carried none, so the comparison was a no-op
 * in ~94% of working copies while the hook printed `WORK_ITEM_TRACKING_OK`
 * either way. What it let through is permanent: a pull-request body is two
 * clicks to correct, a pushed commit message is history. The guarded surface
 * was the loud one.
 *
 * The branch name is already in hand, which is the property that matters for
 * something that runs on every single commit — no tracker call, no I/O beyond
 * the `git` invocation the binding path already makes.
 *
 * Only the CONFIGURED project or team key is matched. A branch naming some
 * other key (`feat/ABC-9-…`) yields undefined and the caller accepts, rather
 * than `canonicalizeRef` refusing it as out-of-project: this is a fallback for
 * a comparison that was silently not happening, and a fallback that invents
 * refusals nobody had before is a worse trade than the gap it closes.
 *
 * Case-insensitive, and that is load-bearing rather than defensive. Agent
 * branch names are routinely lower case (`claude/se-7220-…`), so the
 * upper-case-only `[A-Z]{2,10}-[0-9]+` shape that Jira-key tooling reaches for
 * by habit would match nothing at all here. Reusing it would parse nothing,
 * take the fail-open path on every commit, and print the same success line: a
 * second fail-open wearing the first fix's clothes, and strictly worse than
 * the gap, because the gap would now be believed closed.
 * @param {object} contract Resolved tracker contract.
 * @returns {string|undefined} Canonical reference, or undefined when the
 *   branch encodes none.
 */
function branchWorkItem(contract) {
  const branch = activeBranch();
  if (!branch) return undefined;
  if (contract.provider === "github")
    return githubBranchIssue(branch, contract);
  const key =
    contract.provider === "jira" ? contract.project : contract.teamKey;
  if (!key) return undefined;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Bounded on both sides so `rse-12` does not read as `SE-12` and `SE-123`
  // does not read as `SE-12`.
  const match = new RegExp(
    `(?:^|[^A-Za-z0-9])${escaped}-([1-9]\\d*)(?![0-9])`,
    "i"
  ).exec(branch);
  return match ? `${key}-${match[1]}` : undefined;
}

/**
 * The GitHub issue a branch name encodes, canonicalized, or undefined.
 *
 * This used to be `branchWorkItem`'s first statement, returning `undefined`
 * unconditionally on the premise that "a GitHub reference is `owner/repo#123`;
 * no branch-naming convention encodes one". True of the canonical SPELLING and
 * false of the convention in use — `fix/3537-…`, `stack/3463`, `qd/3554-…`.
 * The number is right there; it simply is not written as a full reference. So
 * the fallback built to close the unbound-worktree gap never applied to the
 * provider this repository configures, and the trailer went on being compared
 * against nothing, while the hook printed `WORK_ITEM_TRACKING_OK` either way
 * (CodySwannGT/lisa#3861).
 *
 * WHY THE WHOLE FIRST SEGMENT AFTER THE FIRST SLASH, and nothing looser. A
 * bare number is ambiguous in a way a `KEY-123` shape is not, so position has
 * to carry the meaning the key would otherwise carry. Measured against the 246
 * branches this repository has: the rule reads 149 of them, and every one of
 * the 97 it declines genuinely encodes no issue number. A "first number
 * anywhere" rule would instead read `chore/upgrade-lisa-4.33.1` as issue 4,
 * `stack/queue-drain-20260903` as issue 20260903, and
 * `fix/se-7728-e2e-coverage-wildcard` as issue 7728 — a version, a date and
 * another tracker's key, each refusing a commit that is perfectly correct.
 *
 * `issue-<n>` shapes (`codex/issue-1264`) are knowingly NOT read. They are
 * unambiguous but rare here, and every additional pattern is another place to
 * be wrong; declining them fails open, which is the safe direction.
 *
 * EXPORTED SO IT CAN BE TESTED IN PROCESS, and that is not a formality. The
 * CLI-level cases around this reach it only by SPAWNING the script, and a
 * subprocess loads the file from disk rather than the instrumented module, so
 * the mutation gate cannot see through it: measured, 12 of 12 mutants in this
 * function survived every CLI case while an untouched range of the same file
 * scored 85.71% off the in-process importers. Taking `branch` as an argument
 * rather than calling `activeBranch()` is what makes that possible — the
 * function is pure, so a table of names can pin each boundary directly. Several
 * neighbours here are exported for the same reason.
 * @param {string} branch Active branch name.
 * @param {object} contract Resolved tracker contract.
 * @returns {string|undefined} Canonical `owner/repo#123`, or undefined.
 */
export function githubBranchIssue(branch, contract) {
  // Bounded on both sides: the number must fill the segment, so `4.33.1` and
  // `se-7728` do not match, and `3463` is not read out of `34631`.
  const match = /^[^/]+\/([1-9]\d*)(?:-|$)/.exec(branch);
  return match ? `${contract.repository}#${match[1]}` : undefined;
}

/**
 * Refuse a trailer that names a different work item than the branch is for.
 *
 * Fails open on a branch that encodes no reference — `dev`, `staging`, `main`,
 * `chore/bump-deps`, a detached HEAD outside a rebase. The defect being closed
 * is a comparison that silently did not happen; replacing it with a new class
 * of blocked commit on every branch that never encoded a ticket would trade
 * one surprise for a louder one.
 * @param {string} ref Canonical reference taken from the trailer.
 * @param {object} contract Resolved tracker contract.
 */
function assertBranchMatches(ref, contract) {
  const branchRef = branchWorkItem(contract);
  if (!branchRef || branchRef === ref) return;
  throw new TrackingError(
    `Work-Item ${ref} does not match this branch's work item ${branchRef} ` +
      `(branch ${activeBranch()}).\n` +
      `Correct the trailer to ${branchRef}, or — if this branch really is ` +
      `working on ${ref} — bind it with ` +
      `\`node scripts/lisa-work-item.mjs link ${ref}\`, which is the ` +
      `authoritative signal and takes precedence over the branch name.`
  );
}

/**
 * Check the trailer against whichever notion of this worktree's work item is
 * available, strongest first.
 *
 * The binding wins wherever it exists: it is what `prepare-commit-msg` seeds
 * the trailer from, and it survives a branch name that says something else on
 * purpose. So a bound worktree behaves exactly as it did before this fallback
 * existed, down to the refusal wording.
 *
 * Scoped to the commit path deliberately. `validateCommits` (push and
 * pull-request validation) keeps checking the binding directly — against the
 * range's one reference, or against the set it names — and in CI the head is
 * frequently detached or on a synthetic merge ref, where a branch name is not
 * a statement about anything.
 * @param {string} ref Canonical reference taken from the trailer.
 * @param {object} contract Resolved tracker contract.
 */
function assertIdentityMatches(ref, contract) {
  if (readState(true)) return assertStateMatches(ref, contract);
  assertBranchMatches(ref, contract);
}

function validateMessage(message, options = {}) {
  if (options.allowInProgressMerge && isMergeInProgress())
    return { exempt: "merge" };
  if (RELEASE_SUBJECT.test(messageSubject(message)))
    return { exempt: "release" };
  const contract = trackerContract();
  const ref = exactWorkItem(message, contract);
  assertIdentityMatches(ref, contract);
  const issue = validateLive(ref, contract);
  return { ref, contract, issue };
}

function commitMessage(sha) {
  return git(["show", "-s", "--format=%B", sha]);
}

/**
 * @param {string[]} commits Commits to check.
 * @param {string | undefined} configRef Commit-ish whose config declares the
 *   deploy chain — the range's BASE, never the head. See `configAt`.
 * @param {string} remote Remote whose tracking refs name the chain branches.
 * @returns {object} What the range proved, and how much of it was exempt.
 */
function validateCommits(commits, configRef, remote) {
  const contract = trackerContract();
  const refs = new Set();
  const issues = new Map();
  const unique = [...new Set(commits)];
  const onProtectedBranch = protectedCommits(unique, configRef, remote);
  let relevant = 0;
  let mergeExempt = 0;
  let releaseExempt = 0;
  let protectedExempt = 0;
  for (const sha of unique) {
    const exemption = commitExemption(sha, onProtectedBranch);
    if (exemption === "merge") {
      mergeExempt += 1;
      continue;
    }
    if (exemption === "release") {
      releaseExempt += 1;
      continue;
    }
    if (exemption === "protected") {
      protectedExempt += 1;
      continue;
    }
    relevant += 1;
    const ref = exactWorkItem(commitMessage(sha), contract);
    refs.add(ref);
    if (!issues.has(ref)) {
      try {
        issues.set(ref, validateLive(ref, contract));
      } catch (error) {
        // The tracker's own "no" — closed, missing, out of scope, not a leaf.
        // Distinct from a badly written trailer, and a rewrite clears neither.
        throw taggedGate(error, GATE_LIVENESS);
      }
    }
  }
  // A range spanning SEVERAL work items is no longer refused here, and the
  // reason is that the refusal was unsatisfiable rather than strict.
  //
  // Every commit above has already proved gate 3 on its own terms: one trailer,
  // canonical, naming an item the tracker says is live, open, repo-scoped and a
  // leaf. Nothing about that is weakened by the range naming two of them. What
  // the old refusal enforced was a MAPPING rule — this pull request is about
  // exactly one item — and a mapping is a property of the pull request, not of
  // the commits. It is enforced in `validatePrData`, against the pull-request
  // BODY, which is the only surface where an author can express the answer and
  // the only one a reviewer can audit.
  //
  // Raising it here made the rule impossible to satisfy for a whole class of
  // legitimate pushes: an integration branch that gathers several finished
  // items before one pull request has no edit — to any commit, body, or config
  // — that makes the range name one item, so the only remedies left were to
  // abandon the shape or to bypass the gate. Neither is a remedy.
  const list = [...refs];
  if (list.length === 1) assertStateMatches(list[0], contract);
  else if (list.length > 1) assertStateAmong(list, contract);
  const [ref] = list;
  return {
    contract,
    ref,
    refs: list,
    issue: ref ? issues.get(ref) : undefined,
    issues,
    mergeExempt,
    protectedExempt,
    releaseExempt,
    relevant,
  };
}

/**
 * Fully qualified remote default-branch ref (e.g. refs/remotes/origin/main),
 * or undefined when it cannot be resolved offline. Reads the LOCAL
 * `refs/remotes/<remote>/HEAD` symref only — never the network. Resolution
 * failure means the exclusion is skipped (fail-safe strict, issue #1956).
 * Security: only the remote DEFAULT branch is ever excluded — never
 * `--remotes=<remote>`, whose ref set includes the branch being (force-)pushed
 * and would let a pusher exempt arbitrary commits.
 */
function remoteDefaultRef(remote) {
  const symref = run(
    "git",
    ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`],
    { allowFailure: true }
  );
  // probe-direction: fail-closed — no ref means no range exclusion, so the
  // commit range examined grows rather than shrinks (#1956).
  if (symref.status !== 0) return undefined;
  const target = symref.stdout.trim();
  if (!target.startsWith(`refs/remotes/${remote}/`)) return undefined;
  const exists = run("git", ["rev-parse", "-q", "--verify", target], {
    allowFailure: true,
  });
  return exists.status === 0 ? target : undefined;
}

/**
 * One pushed ref and the commits it introduces, per line git sent.
 *
 * PER REF, not pooled, and that is the correction rather than a refactor.
 * `git push` may carry several ref updates in one invocation — three rebased
 * branches pushed together to pay one slow pre-push gate instead of three — and
 * pooling their ranges into a single commit list made the pushed refs
 * indistinguishable from one branch that had somehow gathered all of their
 * work. Three branches, each perfectly traced to one work item, were refused
 * for "mixed Work-Item references" that no branch contained: an artefact of the
 * pooling, not a property of anything anyone pushed. Batching was therefore
 * impossible by construction, and N work items cost N full gate runs.
 *
 * Each group is validated on its own below, which is exactly how the same
 * branches would be validated if pushed one at a time. Nothing is exempted:
 * the rule is unchanged and now applied to the unit it was always about.
 * @param {string} input The pre-push stdin stream.
 * @param {string} remote Remote being pushed to.
 * @returns {{localRef: string|undefined, commits: string[], scope: string[]}[]}
 *   One entry per ref update that introduces commits. `scope` is the rev-list
 *   argument vector the commit list came from, kept so a later question about
 *   the same range — see {@link ancestryUnreachable} — is asked of the range
 *   itself rather than re-derived from a list that has already lost its bounds.
 */
function parsePushGroups(input, remote) {
  const groups = [];
  // Commits already reachable from the remote default branch are the base's
  // history (a merge-sync brings them along); excluding them keeps validation
  // scoped to branch-authored commits (issue #1956).
  const defaultRef = remoteDefaultRef(remote);
  for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
    const [localRef, localOid, , remoteOid] = line.trim().split(/\s+/);
    if (!localOid || ZERO_OID.test(localOid)) continue;
    const args =
      remoteOid && !ZERO_OID.test(remoteOid)
        ? [
            "rev-list",
            `${remoteOid}..${localOid}`,
            ...(defaultRef ? ["--not", defaultRef] : []),
          ]
        : // New-branch lane: `--remotes=<remote>` is safe HERE because the branch
          // being pushed has no remote-tracking ref yet — the exclusion set can
          // only contain refs that already passed validation on earlier pushes.
          // The existing-branch lane above must NOT use it (its tracking ref is
          // pusher-controlled); it excludes only the remote default branch.
          ["rev-list", localOid, "--not", `--remotes=${remote}`];
    groups.push({
      localRef,
      commits: git(args).split("\n").filter(Boolean),
      scope: args,
    });
  }
  if (groups.length === 0 && input.trim() === "") {
    const args = ["rev-list", "HEAD", "--not", `--remotes=${remote}`];
    groups.push({
      localRef: undefined,
      commits: git(args).split("\n").filter(Boolean),
      scope: args,
    });
  }
  return groups;
}

/**
 * Deploy branches this push must never reach by inheritance.
 *
 * Read from `deploy.branches` in the project config — the same map the rest of
 * the flow uses to resolve a work item's base branch — plus the remote's own
 * default branch, because a repository that declares no deploy map still has
 * exactly one branch that releases. Names are compared after stripping
 * `refs/heads/`, so a config that spells a branch either way resolves the same.
 * @param {string} remote Remote being pushed to.
 * @returns {Set<string>} Protected branch names, possibly empty.
 */
function deployBranchNames(remote) {
  const names = new Set();
  let config = {};
  try {
    config = readConfig();
  } catch {
    // An unreadable config must not disable the guard; the remote default
    // branch below is resolved independently and is the case that matters most.
    config = {};
  }
  const branches = config?.deploy?.branches;
  if (branches && typeof branches === "object") {
    for (const value of Object.values(branches)) {
      if (typeof value === "string" && value.trim()) {
        names.add(value.trim().replace(HEADS_PREFIX, ""));
      }
    }
  }
  const defaultRef = remoteDefaultRef(remote);
  if (defaultRef) {
    names.add(defaultRef.slice(`refs/remotes/${remote}/`.length));
  }
  return names;
}

/**
 * The branch a pre-push line is pushing FROM, or null when it is not a branch.
 *
 * `HEAD` is deliberately not resolved to the current branch. Git sends `HEAD`
 * as the local ref when the pusher wrote the destination out in full
 * (`git push origin HEAD:main`) and for the detached checkouts release
 * automation runs from — both are statements of intent about the destination,
 * which is the opposite of the accident this guard exists to catch. Treating
 * them as unknown keeps them out of scope; see the residual note on
 * `pushDestinationRefusal`.
 * @param {string} localRef Local ref field from the pre-push line.
 * @returns {string|null} Branch name, or null when the line is not a branch push.
 */
function pushedBranchName(localRef) {
  if (!localRef || !localRef.startsWith(HEADS_PREFIX)) return null;
  const name = localRef.slice(HEADS_PREFIX.length);
  return name === "" ? null : name;
}

/**
 * Refuse a push whose RESOLVED destination is a deploy branch it was not aimed at.
 *
 * Git resolves a push's destination from the branch's UPSTREAM, not from the
 * branch argument, whenever `push.default` is `upstream` or `tracking`. The
 * flow that creates a working branch with `git checkout -b <branch> origin/main`
 * sets that branch's upstream to `main`, so the ordinary
 * `git push -u origin <branch>` resolves to `refs/heads/main` and lands there —
 * silently, reporting success, with branch protection and every required check
 * bypassed (CodySwannGT/lisa#3495). Measured in this repository: two commits
 * reached the default branch that way, every detection control fired correctly
 * afterwards, and the commits shipped in a published release anyway, because
 * nothing prevented the original push.
 *
 * `push.default` is normalized away by a migration and the prescribed flow no
 * longer inherits a destination, but neither of those can bind a clone made
 * before them, a global config, or a habit. This is the backstop, and it reads
 * the one thing that is not a proxy: the destination git ACTUALLY resolved,
 * which is exactly what the pre-push stream carries.
 *
 * Blocks only the accident's signature — a NAMED local branch resolving onto a
 * differently-named deploy branch. Two shapes stay allowed, deliberately:
 * `main -> main` (the legitimate direct push, including a merge landed locally)
 * and a `HEAD` local ref (see `pushedBranchName`). Deletions never reach here;
 * the hook's deletion-only guard exits before this runs.
 * @param {string} input Raw pre-push stdin: `<local ref> <local sha> <remote ref> <remote sha>` per line.
 * @param {string} remote Remote being pushed to.
 * @returns {string|null} Refusal message, or null when every line is safe.
 */
function pushDestinationRefusal(input, remote) {
  const protectedNames = deployBranchNames(remote);
  if (protectedNames.size === 0) return null;
  for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
    const [localRef, localOid, remoteRef] = line.trim().split(/\s+/);
    if (!localOid || ZERO_OID.test(localOid)) continue;
    if (!remoteRef || !remoteRef.startsWith(HEADS_PREFIX)) continue;
    const destination = remoteRef.slice(HEADS_PREFIX.length);
    if (!protectedNames.has(destination)) continue;
    const source = pushedBranchName(localRef);
    if (source === null || source === destination) continue;
    return [
      `Push blocked: "${source}" would land on "${destination}", a deploy branch.`,
      "",
      `Git resolved that destination from the branch's upstream, not from the`,
      `name you pushed. It happens when push.default is "upstream" or`,
      `"tracking" and the branch was created tracking a deploy branch — the`,
      `push then reports success while bypassing branch protection and every`,
      `required check.`,
      "",
      "Fix the branch, not this hook:",
      `  git branch --unset-upstream ${source}`,
      `  git config --local push.default simple`,
      `  git push ${remote} ${source}:refs/heads/${source}`,
      "",
      `If you genuinely mean to push to "${destination}", check it out and push`,
      "it, so the destination is what you named rather than what was inherited.",
    ].join("\n");
  }
  return null;
}

/**
 * Pre-push destination check, run unconditionally by the hook.
 *
 * Separate from `validate-push` on purpose: traceability stands down when a
 * project declares `gates.traceability`, and a guard that a declaration can
 * switch off is not a guard against an accident.
 *
 * `--refs <file>` names the stream to read instead of stdin. The hook has
 * already captured the pushed refs to a file — it must, because reading the
 * stream spends it and the checks after this one need it too — so passing that
 * path is the direct spelling of what the hook actually holds, rather than
 * redirecting the file back onto stdin so this can read it as if it had not
 * been captured. Stdin remains the fallback, so driving the subcommand by hand
 * with a pipe still works.
 * @param {readonly string[]} args Command arguments; `args[0]` is the remote name.
 * @returns {void}
 */
function validatePushDestination(args) {
  const remote = args[0] && !args[0].startsWith("-") ? args[0] : "origin";
  const refsFile = option(args, "--refs", "LISA_PUSHED_REFS_FILE");
  const input = readFileSync(refsFile === undefined ? 0 : refsFile, "utf8");
  const refusal = pushDestinationRefusal(input, remote);
  if (!refusal) return;
  const error = new TrackingError(refusal);
  error.selfExplanatory = true;
  throw error;
}

/**
 * The one work item a pull-request BODY names.
 *
 * A body has no trailer convention — it is prose, edited by people and by bots
 * after the fact — so the line is found wherever it sits. Two lines still fail:
 * unlike a commit message, nothing appends a `Work-Item:` line to a body on
 * Lisa's behalf, so a second one is a person having written two, and which of
 * them the change is for is genuinely unknown.
 * @param {string} body Pull-request body.
 * @param {object} contract Resolved tracker contract.
 * @returns {string} The canonical work-item reference.
 */
/**
 * Every work item a PULL-REQUEST BODY names, deduplicated, in order.
 *
 * The body is where a pull request DECLARES what it is about, and that is why
 * this reads a set where the commit side reads exactly one. A commit is one
 * unit of work and can only honestly name one item; a pull request may
 * legitimately gather several — an integration branch, a stack of finished
 * items shipped together — and the body is the surface on which saying so is
 * explicit, reviewable, and visible in the forge without cloning anything.
 *
 * Writing N `Work-Item:` trailers into a body is not something that happens by
 * accident, which is what makes it a declaration rather than a loophole. What
 * keeps it honest is that `validatePrData` requires the declared set to equal
 * the set the commits actually carry — so it can neither omit an item the range
 * contains nor claim one it does not.
 *
 * An EMPTY body is still refused, with the same message as before: a pull
 * request naming no work item at all declares nothing.
 * @param {string} body Pull-request body.
 * @param {object} contract Resolved tracker contract.
 * @returns {string[]} The canonical work-item references, in order of appearance.
 */
function prWorkItems(body, contract) {
  const values = workItemLines(body);
  if (values.length === 0)
    throw new TrackingError(
      "No Work-Item trailer anywhere in the pull request body"
    );
  return [...new Set(values.map(value => canonicalizeRef(value, contract)))];
}

/**
 * A requirement no edit to this pull request can satisfy. Reported FIRST, and
 * said plainly, because the alternative is what #2681 measured: three
 * successful fixes spent on a pull request that then turned out to need
 * recreating anyway.
 */
const OUTSIDE_THIS_PR = "[not fixable by editing this pull request]";
/**
 * A requirement clearable without recreating the pull request — by editing the
 * BODY, or by rewriting a COMMIT and force-pushing.
 *
 * Those two are not interchangeable, and the tag alone does not say which. A
 * gate-3 finding (the trailer on a commit) carries this tag correctly and is
 * cleared only by the second; a reader who takes the tag at its literal word
 * edits the body, sees the check stay red, learns nothing about why, and
 * reaches for a policy override — having done exactly what the tool told them
 * to. So every commit-side finding names its own remedy in the message; see
 * `COMMIT_REWRITE_ADVICE`.
 */
const IN_THIS_PR = "[fixable by editing this pull request]";
/** Worst first. The whole point of the ordering. */
const SCOPE_ORDER = [OUTSIDE_THIS_PR, IN_THIS_PR];

/**
 * What actually clears a gate-3 finding, said where the finding is read.
 *
 * `🔗 Work-Item Traceability` reports TWO requirements under one check name —
 * the trailer on each COMMIT (gate 3) and the trailer in the pull-request BODY
 * (gate 4) — and the scope tag is shared between them. Without this sentence a
 * gate-3 refusal reads as a gate-4 one, and the body edit it invites is a no-op
 * against a commit message.
 */
const COMMIT_REWRITE_ADVICE =
  "This is the trailer on a COMMIT, not in the pull-request body: editing " +
  "the body will NOT clear it. Rewrite the commit — `git commit --amend` for " +
  "the tip, `git rebase -i` for anything deeper — and force-push. If the " +
  "commit belongs to a branch you must not rewrite, it should not be in this " +
  "range; a commit already on a `deploy.branches` branch is exempt and is not " +
  "what this is reporting.";

/**
 * Validate the commits, keeping a refusal rather than aborting the run.
 *
 * The pull-request gate checks several separate things and used to stop at the
 * first unmet one, so each CI cycle revealed exactly one requirement. It knew
 * the rest at the same moment; it was simply not saying. See `gateSummary` for
 * the full count, which is five and was itself miscounted as four.
 * @param {string[]} commits Commits in the pull request range.
 * @param {string | undefined} configRef Commit-ish whose config declares the
 *   deploy chain — the range's BASE, never the head. See `configAt`.
 * @param {string} remote Remote whose tracking refs name the chain branches.
 *   Threaded from the caller rather than defaulted here: a repository whose
 *   remote is not literally `origin` would otherwise resolve no chain ref at
 *   all, and the exemption would silently never fire — the same red check this
 *   change exists to clear, arrived at by a quieter route.
 * @returns {{result?: object, error?: Error}} Outcome, never a throw.
 */
function commitOutcome(commits, configRef, remote) {
  try {
    return { result: validateCommits(commits, configRef, remote) };
  } catch (error) {
    if (!(error instanceof TrackingError)) throw error;
    return { error };
  }
}

/**
 * Run one check, recording its refusal as a finding instead of throwing.
 * @param {object[]} findings Accumulator.
 * @param {string} scope Whether an edit to this pull request can fix it.
 * @param {string} gate Which rule this check proves.
 * @param {Function} check The check to run.
 * @returns {unknown} The check's value, or undefined when it refused.
 */
function collect(findings, scope, gate, check) {
  try {
    return check();
  } catch (error) {
    if (!(error instanceof TrackingError)) throw error;
    findings.push({ gate: error.gate ?? gate, message: error.message, scope });
    return undefined;
  }
}

/**
 * What to do about a missing tracker backlink, in an operator's terms.
 *
 * Linear derives its native backlink from the BRANCH NAME, so a branch with no
 * ticket id in it can never acquire one — that requirement is unreachable from
 * inside the pull request and the message has to say so, rather than leaving a
 * reader to try edits that cannot work.
 *
 * The closing sentence used to read "creates that comment or updates the
 * existing one", and that was the whole problem: the existing one could belong
 * to a DIFFERENT pull request, so following this printed remedy broke a pull
 * request that had done nothing wrong (CodySwannGT/lisa#3916). The remedy is
 * now safe by construction rather than by the reader noticing, and it says so —
 * a reader who has just been told a gate is unmet needs to know that running
 * the fix cannot un-fix somebody else.
 * @param {string} ref Canonical work-item reference.
 * @param {string} prUrl Pull request URL.
 * @param {object} contract Resolved tracker contract.
 * @returns {string} Remediation sentence.
 */
function backlinkAdvice(ref, prUrl, contract) {
  const branchDerived =
    contract.provider === "linear"
      ? `The tracker builds that link from the BRANCH NAME, so a branch carrying no ticket id can never acquire one: no edit to this pull request, its body, or its commits will do it. Fixing it that way needs a NEW branch named for ${ref} and a new pull request from it. `
      : "";
  return (
    `${branchDerived}The one remedy that needs no new branch is the managed comment ` +
    `\`${MARKER} ${prUrl}\` on ${ref}. Do not post it by hand — run:\n\n` +
    `    ${BACKLINK_COMMAND} --ref ${ref} --pr-url ${prUrl}\n\n` +
    `which creates that comment, or updates the one already naming THIS pull ` +
    `request. A backlink belonging to another pull request on ${ref} is left ` +
    `alone, so running this twice — or for a second pull request against the ` +
    `same item — is safe`
  );
}

/**
 * The FIVE gates a work item passes on its way to merged, and when each bites.
 *
 * They are five separate requirements, met at five different moments — so
 * clearing four says nothing about the fifth, and the reader has no way to
 * learn the fifth exists until it goes red. Measured: two agents in one day
 * each satisfied three of them and were surprised by another, on a pull request
 * that was otherwise finished.
 *
 * FOUR of the five are ENFORCED; gate 2 is not, and the list says so on its own
 * line. Claim state stopped being a precondition for committing — see the note
 * where `assertClaimedLifecycle` used to be — and nothing in this file refuses
 * anything for it now; the remaining readers of `lifecycle.claimed` are the
 * completion writer and the sweep. It stays on the checklist because the
 * claimed role is still real and still what intake dispatches on, and an
 * operator who never sees it here meets it later with no idea it existed. A
 * checklist that names an unenforced requirement AND says it is unenforced is
 * still a checklist; one that silently drops it teaches a wrong model of the
 * lifecycle, and one that leaves it looking enforced is a threat nothing backs.
 *
 * This said FOUR until #2681 counted them properly. Gates 3 and 4 shared a
 * line — "every commit AND the pull-request body carry ONE matching trailer" —
 * which reads as one requirement and is two: the commit-msg hook enforces the
 * message, and a separate check enforces the BODY. An operator whose commits
 * carried the trailer read that line as cleared. Measured: an agent went
 * BLOCKED on "No Work-Item trailer anywhere in the pull request body" holding a
 * commit that carried the trailer, an item in the claimed role, and a backlink
 * already posted — four of the five satisfied, and the fifth invisible until CI
 * said so, one cycle later. (That measurement predates the claim gate's removal
 * and is left as it was recorded; the counting defect it describes is about
 * gates 3 and 4, which are both still enforced.)
 *
 * `Closes owner/repo#N` is called out by name because it is the substitution a
 * reader reaches for: it closes the item on merge and satisfies nothing here.
 *
 * Listing all five in the report an operator actually reads costs six lines and
 * turns a sequence of surprises into one checklist. The role NAMES come from
 * the resolved contract rather than from Lisa's own defaults, because a project
 * configures its own — lifecycle is a workflow STATE on Jira and Linear and a
 * LABEL only on GitHub — and a summary that confidently names the wrong label
 * is worse than none.
 * @param {object} contract Resolved tracker contract.
 * @returns {string} The checklist.
 */
function gateSummary(contract) {
  const backlink =
    contract.verify === "full"
      ? `5. the item carries a managed \`${MARKER}\` backlink comment to this pull request — checked at push once a pull request exists, again at CI time, and only under workItem.verify "full"`
      : `5. the tracker backlink is NOT required here: workItem.verify is "trailer", so this run contacted no tracker`;
  return [
    "",
    "All five gates, and when each one bites:",
    `  1. the item carries the ready role "${contract.lifecycle.ready}" — required before the work may be created or claimed`,
    `  2. the item carries the claimed role "${contract.lifecycle.claimed}" — set when intake dispatches the work; NOT checked here, and no commit is ever refused for it`,
    "  3. every commit message carries ONE matching `Work-Item:` trailer — required by the commit-msg hook, on every single commit; exempt are merges, `chore(release)` commits, and commits already on a `deploy.branches` branch (a back-merge or promote re-asserts nothing)",
    "  4. the pull-request BODY declares EXACTLY the work items its commits carry — one `Work-Item:` line per item, usually one line; a SEPARATE check from gate 3, run at push once a pull request exists and again at CI time; `Closes owner/repo#N` does NOT satisfy it. A range spanning several items is allowed and must name all of them here; naming one the commits do not carry is refused too",
    `  ${backlink}`,
  ].join("\n");
}

/**
 * The same refusal, with the whole checklist appended.
 *
 * Used where a check knows only its OWN gate — the commit-msg hook, and a push
 * with no pull request yet — so that the gates it cannot check are still named
 * at the earliest moment they are known, rather than at the next moment they
 * happen to be enforced.
 *
 * Re-resolving the contract here is safe rather than lucky, and the reason is
 * worth writing down because the obvious defensive try/catch around it is DEAD
 * CODE. Every caller reaches this only after a refusal, and both refusal paths
 * — `validateMessage` and `validateCommits` — call `trackerContract()` as their
 * first real step. So either the contract resolves, and resolving it a second
 * time from the same files resolves again; or it does not, in which case the
 * refusal being decorated IS the configuration error and re-resolving rethrows
 * that identical error. There is no third case, and no input reaches a branch
 * where the original message could be lost.
 *
 * That was established by mutation: a guard clause was written here first, with
 * a test for it, and deleting the guard left the test passing. An unreachable
 * branch and a test that cannot fail are the same defect wearing two hats.
 * @param {Error} error The refusal as raised.
 * @returns {Error} The refusal, with the checklist appended.
 */
function withGateSummary(error) {
  // The rule's name goes in FRONT of its own message, not only in the checklist
  // below it: the checklist says what all five gates are, and the reader still
  // has to work out which one they are looking at. See `GATE_COMMIT`.
  const rule = error.gate ? `Work-Item Traceability ${error.gate}: ` : "";
  return new TrackingError(
    `${rule}${error.message}\n${gateSummary(trackerContract())}`
  );
}

/**
 * One refusal naming every unmet requirement, unrecoverable ones first.
 * @param {object[]} findings Unmet requirements.
 * @param {object} contract Resolved tracker contract.
 * @returns {string} The report.
 */
function requirementReport(findings, contract) {
  const ordered = SCOPE_ORDER.flatMap(scope =>
    findings.filter(finding => finding.scope === scope)
  );
  const head =
    ordered.length === 1
      ? "1 work-item traceability requirement is unmet:"
      : `${ordered.length} work-item traceability requirements are unmet. Every one of them is listed here, hardest first, so a single pass can clear them:`;
  const body = ordered
    .map(
      (finding, index) =>
        `${index + 1}. ${finding.gate ? `${finding.gate} ` : ""}${finding.scope} ${finding.message}`
    )
    .join("\n\n");
  return `${head}\n\n${body}\n${gateSummary(contract)}`;
}

/**
 * What the pull-request body must say when the range spans several items.
 *
 * Named in the refusal, because "declare it in the body" is a remedy a reader
 * has to be able to act on without going looking for the syntax.
 * @param {string[]} refs The references the body is missing.
 * @returns {string} Remediation sentence.
 */
function declarationAdvice(refs) {
  const lines = refs.map(ref => `    Work-Item: ${ref}`).join("\n");
  return (
    `A pull request may gather several work items, but it has to SAY so: add ` +
    `one \`Work-Item:\` line per item to the pull-request body, so the body ` +
    `names exactly the set its commits carry. Add:\n\n${lines}\n\n` +
    `If this range was not meant to span several items, the answer is the ` +
    `other one: take the foreign commits out of it.`
  );
}

/**
 * The mapping rule — the pull request declares exactly the items it carries.
 *
 * This is the rule that used to be enforced on the commit range as "no mixed
 * references", where it was unsatisfiable for an integration branch. Moving it
 * here does not retire it; it gives it the one surface on which it has an
 * answer. Set EQUALITY, in both directions, is what keeps it a check:
 *
 * - an item in the commits but not the body is undeclared work, which is the
 *   accidental mix the old rule was aimed at, and it is still refused;
 * - an item in the body but not the commits is a claim the range does not
 *   support — padding the declaration to make a refusal go away — and it is
 *   refused too, which is what stops "list everything" from being a bypass.
 *
 * Silent when either side is empty: those are gate-3 and gate-4 absences, and
 * they are already reported by their own findings. Saying it twice would make
 * one missing trailer read as two unmet requirements.
 * @param {object[]} findings Accumulator.
 * @param {string[]} commitRefs References the range's commits carry.
 * @param {string[]} bodyRefs References the pull-request body declares.
 */
function reportMapping(findings, commitRefs, bodyRefs) {
  if (commitRefs.length === 0 || bodyRefs.length === 0) return;
  const undeclared = commitRefs.filter(ref => !bodyRefs.includes(ref));
  const unsupported = bodyRefs.filter(ref => !commitRefs.includes(ref));
  // The 1:1 case keeps its own sentence. "Body declares X, commits carry Y" is
  // one disagreement, and splitting it into a missing item plus a spurious one
  // describes a single typo as two faults.
  if (commitRefs.length === 1 && bodyRefs.length === 1 && undeclared.length) {
    findings.push({
      gate: GATE_MAPPING,
      message: `Pull request Work-Item ${bodyRefs[0]} does not match commit Work-Item ${commitRefs[0]}`,
      scope: IN_THIS_PR,
    });
    return;
  }
  if (undeclared.length > 0)
    findings.push({
      gate: GATE_MAPPING,
      message:
        `Pull request body does not declare ${undeclared.join(", ")}, which ` +
        `this range's commits carry. ${declarationAdvice(commitRefs)}`,
      scope: IN_THIS_PR,
    });
  if (unsupported.length > 0)
    findings.push({
      gate: GATE_MAPPING,
      message:
        `Pull request body declares ${unsupported.join(", ")}, which no ` +
        `commit in this range carries. The body must name exactly the items ` +
        `the commits do — no more, or the declaration stops meaning anything.`,
      scope: IN_THIS_PR,
    });
}

/**
 * Check every pull-request requirement and report all of the unmet ones.
 *
 * `rangeIsPartial` is what the PUSH path passes, and it changes exactly one
 * thing: whether a commit side with nothing in it is a violation.
 *
 * The push path evaluates the UNPUSHED range — deliberately, and for a reason
 * that must not be undone: `parsePushGroups` excludes commits already on the
 * remote branch (validated by earlier pushes) and commits reachable from the
 * remote default branch, and it must never use `--remotes=<remote>`, whose ref
 * set includes the branch being force-pushed and would let a pusher exempt
 * arbitrary commits. That range is right. What was wrong is the verdict drawn
 * from it: this function's message says "Pull request has no non-merge commit
 * linked", which is a claim about the PULL REQUEST, made from a range that is
 * only a SUBSET of it.
 *
 * A merge-conflict resolution is the case that exposed it (#3851). Its unpushed
 * range is one merge commit; merges are trailer-exempt; the non-merge set is
 * therefore empty — while the pull request itself contains a perfectly
 * trailered non-merge commit that was validated on an earlier push. The gate
 * refused correctly-attributed work, and its advice ("amend the commit and
 * force-push") named a commit that does not exist and an operation the
 * destructive-command guard refuses. That deadlocked against
 * `artifact-freshness`, which requires the regeneration to live IN the merge.
 *
 * So when the range is partial and has nothing to check, the commit-side
 * question is DEFERRED rather than answered: it has no subject here, and its
 * subject is the pull request, where `validate-pr` asks it correctly from
 * `base..head` — a required, merge-blocking check (`🔗 Work-Item
 * Traceability`), so this defers to something that genuinely runs rather than
 * to nothing.
 *
 * Deliberately NOT an early return, for the same reason the `tracedWhereAuthored`
 * exemption below is not one: gates 4 and 5 are properties of the pull request
 * BODY and the tracker, met by a separate edit, and they stay enforced here
 * exactly as everywhere else. Returning would retire two working gates on
 * precisely the pull requests this makes pushable.
 * @param {{result?: object, error?: Error}} outcome Commit-side outcome.
 * @param {string} prUrl Pull request URL.
 * @param {string} prBody Pull request body.
 * @param {boolean} [rangeIsPartial] True when the range is a subset of the PR's.
 */
function validatePrData(outcome, prUrl, prBody, rangeIsPartial = false) {
  const result = outcome.result;
  if (result?.relevant === 0 && result.releaseExempt > 0 && !result.mergeExempt)
    return;
  const contract = result?.contract ?? trackerContract();
  const findings = [];
  // The commit side has nothing left to say: every non-merge commit in the
  // range is already on a deploy-chain branch, which is what a back-merge or a
  // promote IS. Both refusals below are about a range that traces to no work
  // item, and this range traces to one per commit — on the pull requests that
  // authored them. Without this the exemption would merely trade "no trailer on
  // commit X" for "no non-merge commit linked to a work item": the same red
  // check, one gate along.
  //
  // Deliberately NOT an early return out of this function. Gate 3 is the only
  // gate this exemption speaks to; gate 4 — the `Work-Item:` line in the pull
  // request BODY — is a separate requirement met by a separate edit, and it
  // stays enforced on a back-merge exactly as everywhere else. Returning here
  // would retire a working gate on the very pull requests this change makes
  // mergeable, which is the two-gates-under-one-name collapse that made this
  // defect expensive to read in the first place.
  const tracedWhereAuthored =
    result?.relevant === 0 && result.protectedExempt > 0;
  // Nothing to check HERE, and the subject is one level up. Scoped to a merge
  // because that is the only way a partial range empties out while the pull
  // request is attributed: the trailered commit is excluded for having been
  // validated on an earlier push. `relevant === 0` cannot mask an untrailered
  // commit — `validateCommits` increments the counter BEFORE reading the
  // trailer, so a missing one raises through `outcome.error` on a different
  // branch entirely, and the control below still refuses it.
  const deferredToPullRequest =
    rangeIsPartial === true && result?.relevant === 0 && result.mergeExempt > 0;
  // All three are COMMIT-side. They carry `IN_THIS_PR` because a rewrite plus a
  // force-push does clear them without recreating the pull request — but the
  // tag's wording invites a body edit, which cannot touch a commit message. The
  // advice is what makes the difference legible at the point of reading.
  if (outcome.error)
    findings.push({
      gate: outcome.error.gate ?? GATE_COMMIT,
      message: outcome.error.commitRewritable
        ? `${outcome.error.message}. ${COMMIT_REWRITE_ADVICE}`
        : outcome.error.message,
      scope: IN_THIS_PR,
    });
  else if (
    !tracedWhereAuthored &&
    !deferredToPullRequest &&
    result.relevant === 0
  )
    findings.push({
      gate: GATE_COMMIT,
      message: `Pull request has no non-merge commit linked to a work item. ${COMMIT_REWRITE_ADVICE}`,
      scope: IN_THIS_PR,
    });
  else if (!tracedWhereAuthored && !deferredToPullRequest && !result.ref)
    findings.push({
      gate: GATE_COMMIT,
      message: `Pull request commits are not linked to a work item. ${COMMIT_REWRITE_ADVICE}`,
      scope: IN_THIS_PR,
    });
  const commitRefs = result?.refs ?? [];
  const bodyRefs =
    collect(findings, IN_THIS_PR, GATE_MAPPING, () =>
      prWorkItems(prBody, contract)
    ) ?? [];
  reportMapping(findings, commitRefs, bodyRefs);
  const refs = commitRefs.length > 0 ? commitRefs : bodyRefs;
  // Requirement 4 belongs to `full` alone: it needs tracker WRITE access, and
  // a project that keeps no tracker credentials cannot ever satisfy it. The
  // reference checks above are what stays, and they still refuse everything
  // that is genuinely untraceable.
  //
  // EVERY item the range names needs its own backlink, not just the first one.
  // A pull request that gathers three items and links one of them leaves the
  // other two with no route back from the tracker, which is the whole property
  // this gate exists to keep — and a multi-item range that proved less than a
  // single-item one would make the declaration a way of buying weaker checks.
  if (contract.verify === "full") {
    for (const ref of refs) {
      const before = findings.length;
      collect(findings, OUTSIDE_THIS_PR, GATE_BACKLINK, () =>
        assertBacklink(ref, prUrl, contract, result?.issues?.get(ref))
      );
      if (findings.length > before)
        findings[before].message += `. ${backlinkAdvice(ref, prUrl, contract)}`;
    }
  }
  if (findings.length > 0)
    throw new TrackingError(requirementReport(findings, contract));
}

/**
 * How many commits this range did not have to trace, and why.
 *
 * A back-merge that passes with `0 commit(s)` and no further word reads as a
 * gate that checked nothing — the exact shape of the vacuous-success failure
 * this file refuses everywhere else. Naming the count says what actually
 * happened: those commits were traced already, on the pull requests that
 * authored them.
 * @param {object} result Commit-side result.
 * @returns {string} A clause to append, or the empty string.
 */
function alreadyTraced(result) {
  return result.protectedExempt > 0
    ? ` (${result.protectedExempt} already on a deploy-chain branch, traced where authored)`
    : "";
}

/**
 * Why a push with nothing of its own to trace still passed.
 *
 * The symmetric clause to {@link alreadyTraced}, and the reason it exists is
 * the same defect one state along. A back-merge push whose range holds only
 * merge commits takes the deferral added for CodySwannGT/lisa#3851 and prints:
 *
 * ```
 * WORK_ITEM_TRACKING_OK 0 commit(s), PR body, and tracker backlink
 * ```
 *
 * A push whose range was simply EMPTY prints the same bytes. Both are true;
 * they are not the same fact. One says "the subject is one level up, at the
 * pull request whose range carries it", the other says "there was nothing to
 * look at". A reader cannot tell them apart, and the only thing that separates
 * them — the range — is not in the output (CodySwannGT/lisa#3886). Attribution
 * required measuring the range by hand and reading the source, neither of which
 * an operator reading a push transcript has.
 *
 * `alreadyTraced` renders nothing here: it fires only for `protectedExempt`,
 * and a back-merge onto a feature branch has none. So the zero went unexplained.
 *
 * ## Why `relevant === 0 && mergeExempt > 0` is the whole condition
 *
 * The deferral itself is `rangeIsPartial && relevant === 0 && mergeExempt > 0`.
 * This renders only on the push path, where the range is ALWAYS a subset of the
 * pull request's — `reportPushGroup` passes `rangeIsPartial: true`
 * unconditionally, and says why. `validate-pr` reads the full `base..head`
 * range and does not defer, which is why its success line does not carry this.
 *
 * ## This adds a sentence and relaxes nothing
 *
 * The verdict, the exit status and every gate are untouched: a clause is
 * appended to a line that already said OK. A diagnostic fix that also softened
 * enforcement would not be a diagnostic fix.
 * @param {object} result Commit-side result.
 * @returns {string} A clause to append, or the empty string.
 */
function carriedByPullRequest(result) {
  return result.relevant === 0 && result.mergeExempt > 0
    ? ` (${result.mergeExempt} merge commit(s); this push introduces no authored work, so the pull request's own range carries the requirement)`
    : "";
}

/**
 * What a successful run actually proved, in its own words.
 *
 * A `trailer` run that printed "and tracker backlink" would be claiming a
 * check it deliberately did not make — the same class of untruth as a gate
 * that reports success having verified nothing, said in the success line
 * instead of the exit code.
 * @param {object} contract Resolved tracker contract.
 * @returns {string} The requirements this run proved.
 */
function provedHere(contract) {
  return contract.verify === "full"
    ? "PR body, and tracker backlink"
    : 'and PR body (workItem.verify is "trailer": the tracker was not contacted)';
}

function currentRepository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const result = run("gh", ["repo", "view", "--json", "nameWithOwner"], {
    allowFailure: true,
  });
  // probe-direction: neutral — undefined omits `--repo`, which is the CORRECT
  // call shape: `gh` then resolves the repository from the current branch's
  // remote. Note the asymmetry that #3848 turns on — this call SUCCEEDING is
  // what supplied the `--repo` value that broke `currentPullRequest` before
  // #3833, so it was upstream of that defect rather than beside it. Neutral
  // is a fact about the code as it stands, not a property of the call site.
  if (result.status !== 0) return undefined;
  return safeJson(result.stdout, "GitHub repository").nameWithOwner;
}

/**
 * The pull request a check is about, by number or by the branch in hand.
 *
 * `gh pr view` will not infer the current branch once `--repo` is given — it
 * exits non-zero with "argument required when using the --repo flag" — and
 * `currentRepository()` resolves in every normal checkout, so `--repo` was
 * always present. The push path passes no number, so every push made an
 * invalid call, `allowFailure` turned the usage error into `undefined`, and
 * the caller concluded no pull request existed.
 *
 * That is why gates 4 and 5 were never checked at push time. Not deferred
 * until a pull request existed — never looked up at all, so the deferral
 * notice was emitted unconditionally: true by accident before a pull request
 * existed, false afterwards, and determined in neither case (#3791). The CI
 * path passed `--pr-number` and so called `gh` correctly, which is why CI
 * caught what every push had waved through.
 *
 * Naming the selector positionally is what makes the lookup resolve while
 * keeping `--repo` explicit. With no number and no branch — a detached HEAD —
 * there is genuinely nothing to resolve by, so `--repo` is withheld rather
 * than sent without the argument it requires.
 * @param {string|number} [number] Explicit pull-request number, when known.
 * @param {string} [repository] `owner/name` the pull request belongs to.
 * @returns {object|undefined} The pull request, or undefined when none resolves.
 */
/**
 * The argv for one `gh pr view`, with the selector it cannot do without.
 *
 * Extracted and exported because every other test of this file drives the CLI
 * as a SUBPROCESS, so nothing in-process ever covers argv construction — the
 * mutation gate reported seven surviving mutants here and no assertion reachable
 * from a spawned process could have killed one. Argument shape is exactly what
 * was wrong in #3791, so it is the part that has to be directly testable.
 * @param {string|number} [number] Explicit pull-request number, when known.
 * @param {string} [branch] Branch to resolve by when no number is given.
 * @param {string} [repository] `owner/name` the pull request belongs to.
 * @param {string} [fields] Comma-separated `gh pr view --json` fields.
 * @returns {string[]} Arguments for `gh`.
 */
export function pullRequestViewArgs(
  number,
  branch,
  repository,
  fields = "url,body,state"
) {
  const selector = number ?? branch;
  const args = ["pr", "view"];
  if (selector) args.push(String(selector));
  // `--repo` is withheld without a selector rather than sent alone: `gh` treats
  // that as a usage error, not as "look it up from the branch".
  if (repository && selector) args.push("--repo", repository);
  args.push("--json", fields);
  return args;
}

function currentPullRequest(
  number,
  repository = currentRepository(),
  fields = "url,body,state"
) {
  const args = pullRequestViewArgs(number, activeBranch(), repository, fields);
  const result = run("gh", args, { allowFailure: true });
  return result.status === 0
    ? safeJson(result.stdout, "GitHub pull request")
    : undefined;
}

/**
 * Read a `--name <value>` option, falling back to an environment variable.
 *
 * A flag present but carrying no value — last on the line, or immediately
 * followed by another flag — used to yield `undefined` (or the next flag's
 * name) rather than falling back. `lisa … --ref` therefore silently discarded
 * a perfectly good value in the environment, and `--ref --json` bound the
 * literal string "--json". Both now behave as if the flag were absent.
 * @param {string[]} args Argument list.
 * @param {string} name Flag to read, including leading dashes.
 * @param {string} envName Environment variable to fall back to.
 * @returns {string | undefined} The resolved value, if any.
 */
function option(args, name, envName) {
  const index = args.indexOf(name);
  if (index < 0) return process.env[envName];
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-")) return process.env[envName];
  return value;
}

/**
 * Read one explicit pull-request alias, refusing a present-but-empty flag.
 *
 * Written as "absent, or a usable value" — never "absent, or absent-looking".
 * The shared `option` helper treats a valueless flag as absent so a good value
 * in the environment still wins, which is right for `--ref` and wrong here: an
 * operator who typed `--pr-url` has NAMED the evidence, and quietly answering
 * with `LISA_PR_URL` writes a backlink to whatever pull request the surrounding
 * automation happened to export. Measured before this refusal existed:
 * `backlink --ref <item> --pr-url --json` with `LISA_PR_URL` set to a different
 * pull request wrote the managed comment pointing at the environment's pull
 * request and exited 0, so the traceability gate went green having proved the
 * work item was linked to the wrong change.
 *
 * A present flag whose value is empty, whitespace, or another option is the
 * same typo with three spellings, and all three are refused rather than
 * resolved — a refusal costs one re-run, and the alternative is evidence
 * nobody chose.
 * @param {string[]} args Command arguments.
 * @param {string} name Alias to read, including leading dashes.
 * @returns {string | undefined} The supplied value, or undefined when absent.
 */
function explicitPullRequestUrl(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("-") || value.trim() === "") {
    throw new TrackingError(
      `${name} was supplied without a pull-request URL. Pass ` +
        `${name} https://github.com/owner/repo/pull/123, or omit the flag ` +
        `entirely to fall back to LISA_PR_URL`
    );
  }
  return value;
}

/**
 * Resolve the canonical pull-request URL for backlink, validation and
 * completion, without letting an environment fallback outrank either alias.
 *
 * Two rules, and both exist because the backlink is how completion is PROVEN.
 *
 * Precedence: `LISA_PR_URL` is read only when neither explicit alias is
 * present. Resolving `--pr-url` with an environment fallback before inspecting
 * `--url` let the environment hide an explicit alias.
 *
 * Canonicalisation: the value returned is the parsed canonical URL, not the
 * caller's string. `assertBacklink` compares URLs by equality — token equality
 * in `textContainsBacklink`, `===` on both native link fields — and the
 * completion path already canonicalises through `mergedPullRequestEvidence`.
 * A backlink WRITTEN from the raw string therefore did not match the same pull
 * request READ back a moment later if the two spellings differed by a trailing
 * slash, and the failure surfaces as "no verified backlink" on work that is
 * genuinely linked. Canonicalising here puts one spelling on both sides. It
 * also means a value that is not a GitHub pull-request URL at all is refused
 * where it is supplied, rather than written into the managed comment and
 * discovered later by the check it was supposed to satisfy.
 *
 * Conflicting explicit aliases are refused on the RAW strings, so two
 * spellings of one pull request conflict just as two different pull requests
 * do. The looser rule would have to canonicalise first and then accept, and
 * accepting evidence the caller spelled two ways is the direction that reports
 * unproven work as proven.
 *
 * An empty `LISA_PR_URL` is absent, unlike an empty `--pr-url`: exporting an
 * empty variable is how a shell says "unset" and no operator typed it, so the
 * caller still gets the command's own "requires --pr-url <url>" refusal
 * instead of a parse error about a string nobody wrote.
 * @param {string[]} args Command arguments.
 * @returns {string | undefined} The canonical URL, or undefined when none.
 */
function pullRequestUrlOption(args) {
  const canonical = explicitPullRequestUrl(args, "--pr-url");
  const alias = explicitPullRequestUrl(args, "--url");
  if (canonical && alias && canonical !== alias) {
    throw new TrackingError(
      "Conflicting pull-request evidence: --pr-url and --url name different values"
    );
  }
  const supplied = canonical ?? alias;
  if (supplied !== undefined) return githubPullRequestUrl(supplied).url;
  const fromEnvironment = String(process.env.LISA_PR_URL ?? "").trim();
  if (fromEnvironment === "") return undefined;
  return githubPullRequestUrl(fromEnvironment).url;
}

function bind(args) {
  const contract = trackerContract();
  const ref = canonicalizeRef(args[0], contract);
  validateLive(ref, contract);
  const file = writeState(ref, contract.provider);
  console.log(`work-item bound: ${ref} (${file})`);
}

/**
 * Establish the ticket-side backlink for one work item and pull request.
 *
 * Idempotent by construction — the writer updates the managed comment it finds
 * rather than adding a second — so this is safe to run on every push, and safe
 * to rerun after a failure without inspecting what the last run managed to do.
 * @param {string[]} args CLI arguments.
 */
/**
 * The work item bound to this worktree, refusing a binding from another branch.
 *
 * `readState` answers "what is written in the binding file", which is not the
 * same question as "what is this branch working on". A binding survives a
 * branch switch, so reading it without validating is how a command aimed at
 * one work item acts on a different one.
 *
 * `assertStateMatches` has always validated before trusting it. `backlink` and
 * `complete` did not, and the consequences differ in kind: a stale binding made
 * `backlink` write the managed comment to the WRONG ticket, and would make
 * `complete` apply a terminal role and CLOSE the wrong ticket. Neither is
 * self-correcting, and the closure is indistinguishable from a real one
 * afterwards.
 *
 * An explicit `--ref` needs no binding at all, so callers consult this only
 * when falling back.
 * @returns {string|null} The bound ref, or null when nothing is bound.
 */
function boundRef() {
  const state = readState(true);
  if (!state) return null;
  assertStateBranch(state);
  return state.ref;
}

function backlink(args) {
  const contract = trackerContract();
  const supplied = option(args, "--ref", "LISA_WORK_ITEM_REF");
  const bound = supplied ? null : boundRef();
  if (!supplied && !bound) {
    throw new TrackingError(
      `${BACKLINK_COMMAND} requires --ref <work-item>, or a worktree binding from \`lisa-work-item.mjs link\``
    );
  }
  const ref = canonicalizeRef(supplied ?? bound, contract);
  const prUrl = pullRequestUrlOption(args);
  if (!prUrl)
    throw new TrackingError(`${BACKLINK_COMMAND} requires --pr-url <url>`);
  console.log(backlinkReport(postBacklink(ref, prUrl, contract), ref, prUrl));
}

/**
 * Cross-references on a work item that are MERGED pull requests in one repo.
 *
 * Repo-scoped deliberately. A cross-reference carries no repository constraint,
 * so a downstream consumer's pull request mentioning an upstream issue appears
 * here exactly like a local one. Measured while building this: a sweep that
 * ignored `repository_url` credited two issues with fixes that lived in other
 * repositories entirely, which is the difference between "shipped" and
 * "somebody mentioned it".
 *
 * Exported so it can be asserted against fixture payloads without a network —
 * a permissive filter returns MORE numbers rather than throwing, so nothing
 * observable changes unless something asserts on the returned list.
 * @param {unknown[]} events Timeline events for the work item.
 * @param {string} repository `owner/name` the pull request must belong to.
 * @returns {number[]} Merged pull-request numbers, de-duplicated.
 */
export function mergedPullRequestsIn(events, repository) {
  const suffix = `/${repository}`;
  const numbers = (Array.isArray(events) ? events : [])
    .filter(event => event?.event === "cross-referenced")
    .map(event => event?.source?.issue)
    .filter(issue => issue?.pull_request?.merged_at)
    .filter(issue => String(issue?.repository_url ?? "").endsWith(suffix))
    .map(issue => issue?.number)
    .filter(number => typeof number === "number");
  return [...new Set(numbers)];
}

function githubTimeline(ref) {
  const [repository, number] = ref.split("#");
  const result = run(
    "gh",
    ["api", `repos/${repository}/issues/${number}/timeline?per_page=100`],
    { allowFailure: true }
  );
  if (result.status !== 0) throw githubFailure(result, ref);
  const events = safeJson(result.stdout, `GitHub timeline for ${ref}`);
  return Array.isArray(events) ? events : [];
}

/**
 * The branch a merged pull request was merged INTO.
 *
 * A second call per pull request, because the timeline cannot answer it: a
 * `cross-referenced` event carries the referencing item in ISSUE shape, and an
 * issue has no base branch. Reading the base is the whole point — without it
 * "a merged pull request references this item" is the only evidence there is,
 * and that sentence is true of a merge into an integration branch that shipped
 * nothing.
 * @param {string} repository `owner/name` the pull request belongs to.
 * @param {number} number The pull-request number.
 * @returns {string} The base branch name, empty when it could not be read.
 */
function pullRequestBaseBranch(repository, number) {
  const result = run(
    "gh",
    ["api", `repos/${repository}/pulls/${number}`, "--jq", ".base.ref"],
    { allowFailure: true }
  );
  if (result.status !== 0)
    throw githubFailure(result, `${repository}#${number}`);
  return result.stdout.trim();
}

/**
 * Decide which lifecycle role a set of merged pull requests has earned.
 *
 * The defect this exists to end: completion read "is there a merged pull
 * request referencing this item" and never asked which branch it merged into,
 * so a stacked pull request landing on an integration branch stamped the
 * PRODUCTION terminal role and closed the item. Nothing had reached the deploy
 * branch and nothing had deployed, but every recovery flow — sweep, repair
 * intake, the rollup reconcilers — reads a closed item carrying the terminal
 * role as finished, so the corruption is in the direction that stops recovery
 * from firing.
 *
 * **Production is recognised, never ranked.** An earlier draft of this
 * function ordered environments by their POSITION in the configured `done`
 * map, which makes correctness depend on JSON key order — not semantically
 * meaningful, constrained by no schema, and able to fail in the direction of
 * writing the WRONG TERMINAL ROLE rather than merely refusing, which is the
 * original defect with extra steps. So the only distinction drawn here is
 * production versus not: a merge into the production environment is terminal,
 * a single non-production environment records its own role, and several
 * different non-production environments are reported rather than ranked. That
 * is enough, because the role this ticket is about is the terminal one.
 *
 * Pure and exported so the decision can be asserted without a network.
 * @param {{base: string, number: number}[]} pullRequests Merged pull requests.
 * @param {Map<string, string>} branchEnvironments Branch to deploy environment.
 * @param {{done: [string, string][], productionEnvironment: string}} lifecycle
 *   The resolved lifecycle contract.
 * @returns {{ambiguous: boolean, environment: string|null, evidence: {base: string, environment: string|null, number: number}[], role: string|null, terminal: boolean}}
 *   The role earned, or a null role when nothing was earned or nothing ranks.
 */
export function mergedBaseDecision(
  pullRequests,
  branchEnvironments,
  lifecycle
) {
  const roles = new Map(lifecycle?.done ?? []);
  const production = lifecycle?.productionEnvironment;
  const evidence = (pullRequests ?? []).map(request => {
    const base = String(request?.base ?? "");
    return {
      base,
      environment: branchEnvironments?.get(base) ?? null,
      number: request?.number,
    };
  });
  const reached = [
    ...new Set(
      evidence
        .map(entry => entry.environment)
        .filter(environment => roles.has(environment))
    ),
  ];
  if (reached.includes(production)) {
    return {
      ambiguous: false,
      environment: production,
      evidence,
      role: roles.get(production),
      terminal: true,
    };
  }
  // Exactly one non-production environment is unambiguous. Two different ones
  // would need an ordering the configuration does not state, so they are
  // reported instead of guessed at.
  if (reached.length !== 1) {
    return {
      ambiguous: reached.length > 1,
      environment: null,
      evidence,
      role: null,
      terminal: false,
    };
  }
  return {
    ambiguous: false,
    environment: reached[0],
    evidence,
    role: roles.get(reached[0]),
    terminal: false,
  };
}

/**
 * Name every merged pull request and the branch it landed on.
 *
 * An operator reading a run that completed nothing has to be able to tell WHY
 * without opening the code, and "which branch did it actually merge into" is
 * the whole answer.
 * @param {{base: string, environment: string|null, number: number}[]} evidence
 *   What each merged pull request was observed to target.
 * @returns {string} A readable one-line summary.
 */
function describeMergeBases(evidence) {
  return evidence
    .map(
      entry =>
        `#${entry.number} -> ${entry.base || "(unknown base)"} [${entry.environment ?? NOT_A_DEPLOY_BRANCH}]`
    )
    .join(", ");
}

/**
 * Name the branches this project does deploy, and which one it took to be
 * production.
 *
 * Naming the production branch explicitly is what makes a wrong ASSUMPTION
 * visible. A project that never wrote `deploy.branches` has its default branch
 * read as production; if that is not its real production branch, every
 * completion refuses and the operator has to be able to see the assumption in
 * the refusal rather than infer it from a list.
 * @param {Map<string, string>} branchEnvironments Branch to deploy environment.
 * @param {string} production The production environment's name.
 * @returns {string} A readable list, with the production branch called out.
 */
function describeDeployBranches(branchEnvironments, production) {
  const listed =
    [...branchEnvironments]
      .map(([branch, environment]) => `${branch} [${environment}]`)
      .join(", ") || "(none configured)";
  const [productionBranch] =
    [...branchEnvironments].find(
      ([, environment]) => environment === production
    ) ?? [];
  return productionBranch === undefined
    ? `${listed}; no branch maps to "${production}"`
    : `${listed}; production is taken to be "${productionBranch}"`;
}

/**
 * Record a deploy role that is NOT the production terminal.
 *
 * Adds the environment's role and stops. It deliberately does not close the
 * item and does not retire the claimed role: the work is genuinely still in
 * flight until it reaches the production branch, and native closure fires only
 * at the production terminal.
 * @param {string} ref Canonical work-item reference.
 * @param {{labels: string[]}} before The pre-write tracker state.
 * @param {string} role The environment's configured done role.
 * @returns {void}
 */
function recordDeployRole(ref, before, role) {
  if (carriesLabel(before.labels, role)) return;
  const [repository, number] = ref.split("#");
  const edited = run(
    "gh",
    [
      "issue",
      "edit",
      String(number),
      "--repo",
      repository,
      "--add-label",
      role,
    ],
    { allowFailure: true }
  );
  if (edited.status !== 0) throw githubFailure(edited, ref);
}

/**
 * Move a work item to the lifecycle role its merges have actually earned.
 *
 * The role is RESOLVED from configuration, never assumed. Lisa's own
 * repository maps `production` to `status:done`, but the map is environment
 * aware — a project whose target is `dev` has a different terminal role, and a
 * hardcoded label would silently apply the wrong one there while looking
 * correct here. `lifecycleContract` already computes this for every provider.
 *
 * **It refuses without evidence.** A completion command that closes whatever it
 * is pointed at is a way to make unfinished work disappear, which is the same
 * defect class as a gate that passes because it found nothing. Evidence is a
 * merged pull request in this repository.
 *
 * **And a merged pull request is not evidence on its own.** The base branch it
 * merged into decides which role it earned: only a merge into the production
 * deploy branch is terminal. A merge into an integration branch records the
 * environment's role at most, and a merge into a branch this project does not
 * deploy at all records nothing and closes nothing — reported, never silent,
 * because a completion that quietly did not happen is the same failure as one
 * that wrongly did.
 * @param {string} ref Canonical work-item reference.
 * @param {object} contract The resolved tracker contract.
 * @returns {{applied: boolean, bases: string, merged: number[], report: string, terminal: string|null}}
 *   What was applied, and why.
 */
function completeGithubWorkItem(ref, contract) {
  const [repository] = ref.split("#");
  const merged = mergedPullRequestsIn(githubTimeline(ref), repository);
  if (merged.length === 0) {
    throw new TrackingError(
      `refusing to complete ${ref}: no merged pull request in ${repository} references it.\n` +
        `Completion is evidence-based on purpose. A command that closes whatever it is pointed at\n` +
        `is a way to make unfinished work disappear, and the closure would be indistinguishable\n` +
        `from a real one afterwards. If the work shipped some other way, say so on the item and close it deliberately.`
    );
  }
  const decision = mergedBaseDecision(
    merged.map(number => ({
      base: pullRequestBaseBranch(repository, number),
      number,
    })),
    contract.deployBranches,
    contract.lifecycle
  );
  const evidence = merged.map(number => `#${number}`).join(", ");
  const bases = describeMergeBases(decision.evidence);
  if (decision.role === null) {
    const why = decision.ambiguous
      ? `Several different non-production deploy environments were reached, and the configuration states\n` +
        `no ordering between them, so this writer reports them rather than guessing which is furthest.`
      : `No merged pull request reached a branch this project deploys, so no lifecycle role was\n` +
        `applied and ${ref} stays open. It completes when the change reaches a deploy branch.`;
    return {
      applied: false,
      bases,
      merged,
      report:
        `work-item NOT completed: ${ref} (merged: ${evidence}) bases: ${bases}\n` +
        `${why}\n` +
        `Deploy branches: ${describeDeployBranches(contract.deployBranches, contract.lifecycle.productionEnvironment)}.\n` +
        `If that production branch is wrong, "deploy.branches" in .lisa.config.json is what to fix.`,
      terminal: null,
    };
  }
  const before = githubLifecycleState(
    ref,
    `GitHub issue ${ref} completion read`
  );
  assertNotAbandoned(ref, before);
  if (!decision.terminal) {
    recordDeployRole(ref, before, decision.role);
    return {
      applied: true,
      bases,
      merged,
      report:
        `work-item advanced: ${ref} -> ${decision.role} (merged: ${evidence}) bases: ${bases}\n` +
        `${decision.environment} is not the production environment, so ${ref} stays open.`,
      terminal: decision.role,
    };
  }
  reconcileGithubLifecycle(ref, before, contract);
  // A SECOND read, deliberately. The edit and the close each reported their own
  // success, and a writer that trusts those is asserting about tracker state it
  // never asked the tracker for — the same defect class as the one above it.
  const after = githubLifecycleState(
    ref,
    `GitHub issue ${ref} completion readback`
  );
  assertCompletionReadback(ref, after, contract);
  return {
    applied: true,
    bases,
    merged,
    report: `work-item completed: ${ref} -> ${contract.lifecycle.terminalName} (merged: ${evidence}) bases: ${bases}`,
    terminal: contract.lifecycle.terminalName,
  };
}

/**
 * Label names exactly as the tracker spells them.
 *
 * Distinct from `namesFrom`, which folds to lowercase for MATCHING. These names
 * are used as `--remove-label` arguments, where the tracker's own spelling is
 * the one that identifies the label.
 * @param {unknown} value A labels payload, of strings or `{name}` objects.
 * @returns {string[]} Non-empty names, trimmed, order preserved.
 */
export function labelNamesOf(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === "string" ? item : item?.name))
    .filter(name => typeof name === "string" && name.trim() !== "")
    .map(name => name.trim());
}

/**
 * Whether a label set carries one named label, compared case-insensitively.
 * @param {string[]} labels Label names the item carries.
 * @param {string} name The label to look for.
 * @returns {boolean} True when the item carries it.
 */
export function carriesLabel(labels, name) {
  const folded = String(name ?? "").toLowerCase();
  return labels.some(label => label.toLowerCase() === folded);
}

/**
 * The lifecycle roles an item carries that contradict a selected terminal role.
 *
 * Returned in the TRACKER's spelling rather than the configured one, because
 * that is what has to be named to remove it. Only roles actually present are
 * returned: asking GitHub to remove a label an issue does not carry is a 404,
 * which would turn a clean completion into a failure an operator has to
 * interpret, and would make a repeat run fail where the first succeeded.
 * @param {string[]} labels Label names the item carries.
 * @param {readonly string[]} roles Every configured lifecycle role.
 * @param {string} terminal The role being applied, which is never competing.
 * @returns {string[]} Competing roles present on the item, de-duplicated.
 */
export function competingLifecycleRoles(labels, roles, terminal) {
  const lifecycle = new Set(
    (roles ?? []).map(role => String(role).toLowerCase())
  );
  const keep = String(terminal ?? "").toLowerCase();
  const competing = new Map();
  for (const name of labels) {
    const folded = name.toLowerCase();
    if (folded === keep || !lifecycle.has(folded)) continue;
    if (!competing.has(folded)) competing.set(folded, name);
  }
  return [...competing.values()];
}

/**
 * Read the tracker's own view of one GitHub issue's lifecycle.
 * @param {string} ref Canonical work-item reference.
 * @param {string} purpose What the read is for, quoted if the payload is junk.
 * @returns {{labels: string[], reason: string, state: string}} What it holds.
 */
function githubLifecycleState(ref, purpose) {
  const [repository, number] = ref.split("#");
  const result = run(
    "gh",
    [
      "issue",
      "view",
      String(number),
      "--repo",
      repository,
      "--json",
      "labels,number,state,stateReason",
    ],
    { allowFailure: true }
  );
  if (result.status !== 0) throw githubFailure(result, ref);
  const issue = safeJson(result.stdout, purpose);
  if (String(issue?.number) !== String(number))
    throw new TrackingError(`GitHub returned the wrong issue for ${ref}`);
  return {
    labels: labelNamesOf(issue?.labels),
    reason: String(issue?.stateReason ?? "").toUpperCase(),
    state: String(issue?.state ?? "").toUpperCase(),
  };
}

/**
 * Refuse to convert a deliberate not-planned closure into a completion.
 *
 * A not-planned closure is somebody recording that the item will NOT be done,
 * and it disagrees with the merged pull request offered as evidence here. The
 * writer is not the thing that gets to settle that disagreement: stamping the
 * terminal role would silently rewrite "we are not doing this" as "done", and
 * afterwards the two would be indistinguishable — the same property that makes
 * an unevidenced close unacceptable a few lines above.
 * @param {string} ref Canonical work-item reference.
 * @param {{reason: string, state: string}} before The pre-write tracker state.
 * @returns {void}
 */
function assertNotAbandoned(ref, before) {
  if (before.state !== "CLOSED" || before.reason !== "NOT_PLANNED") return;
  throw new TrackingError(
    `refusing to complete ${ref}: it is already closed as not planned.\n` +
      `That closure is a deliberate decision the work would NOT be done, and it disagrees with the\n` +
      `merged pull request offered as evidence. Applying the terminal role here would rewrite that\n` +
      `decision as a completion, and afterwards the two would be indistinguishable. If the work did\n` +
      `ship, reopen the item first so the change of mind is on the record.`
  );
}

/**
 * Apply the terminal role, retire every competing one, and close the item.
 *
 * Every step is conditional on the state actually read, which is what makes a
 * repeat run a no-op instead of a failure: nothing is added that is already
 * there, nothing is removed that is not there, and nothing is closed twice.
 * @param {string} ref Canonical work-item reference.
 * @param {{labels: string[], state: string}} before The pre-write state.
 * @param {object} contract The resolved tracker contract.
 * @returns {void}
 */
function reconcileGithubLifecycle(ref, before, contract) {
  const [repository, number] = ref.split("#");
  const terminal = contract.lifecycle.terminalName;
  const mutation = [];
  if (!carriesLabel(before.labels, terminal))
    mutation.push("--add-label", terminal);
  for (const role of competingLifecycleRoles(
    before.labels,
    contract.lifecycle.roles,
    terminal
  ))
    mutation.push("--remove-label", role);
  if (mutation.length > 0) {
    const edited = run(
      "gh",
      ["issue", "edit", String(number), "--repo", repository, ...mutation],
      { allowFailure: true }
    );
    if (edited.status !== 0) throw githubFailure(edited, ref);
  }
  if (before.state === "CLOSED") return;
  const closed = run(
    "gh",
    [
      "issue",
      "close",
      String(number),
      "--repo",
      repository,
      "--reason",
      "completed",
    ],
    { allowFailure: true }
  );
  if (closed.status !== 0) throw githubFailure(closed, ref);
}

/**
 * Prove, from a fresh read, that the item really is closed under exactly one
 * lifecycle role.
 *
 * Reports every fault at once rather than the first. An operator who fixes one
 * problem, re-runs, and is handed the next one learns the shape of the failure
 * one round trip at a time.
 * @param {string} ref Canonical work-item reference.
 * @param {{labels: string[], state: string}} after The post-write state.
 * @param {object} contract The resolved tracker contract.
 * @returns {void}
 */
function assertCompletionReadback(ref, after, contract) {
  const terminal = contract.lifecycle.terminalName;
  const competing = competingLifecycleRoles(
    after.labels,
    contract.lifecycle.roles,
    terminal
  );
  const faults = [];
  if (after.state !== "CLOSED")
    faults.push(
      `it is still ${after.state.toLowerCase() || "in no known state"}`
    );
  if (!carriesLabel(after.labels, terminal))
    faults.push(`it does not carry the terminal role "${terminal}"`);
  if (competing.length > 0) {
    const quoted = competing.map(role => `"${role}"`).join(", ");
    faults.push(`it still carries the competing lifecycle role ${quoted}`);
  }
  if (faults.length === 0) return;
  throw new TrackingError(
    `GitHub issue ${ref} did not read back as completed: ${faults.join("; ")}.\n` +
      `This is a fresh read of the item, not the write's own answer — the tracker was asked again and\n` +
      `disagreed. Either the write did not land, or something reconciled the item after it did.`
  );
}

/**
 * Parse one canonical GitHub pull-request URL.
 *
 * Completion is a tracker WRITE. Accepting a lookalike host or a path with
 * extra components would let supplied text choose evidence the GitHub CLI did
 * not mean to verify.
 * @param {string} raw Candidate URL.
 * @returns {{number:number, repository:string, url:string}} Parsed evidence.
 */
function githubPullRequestUrl(raw) {
  let url;
  try {
    url = new URL(String(raw ?? ""));
  } catch {
    throw new TrackingError(
      `Invalid pull-request evidence '${raw}'; expected https://github.com/owner/repo/pull/123`
    );
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.search !== "" ||
    url.hash !== "" ||
    !match
  ) {
    throw new TrackingError(
      `Invalid pull-request evidence '${raw}'; expected https://github.com/owner/repo/pull/123`
    );
  }
  return {
    number: Number(match[3]),
    repository: `${match[1]}/${match[2]}`,
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  };
}

/**
 * Prove that supplied evidence is a merged PR in this repository.
 * @param {string} prUrl Canonical pull-request URL.
 * @returns {{number:number, repository:string, url:string}} Verified evidence.
 */
function mergedPullRequestEvidence(prUrl) {
  const parsed = githubPullRequestUrl(prUrl);
  const repository = currentRepository();
  if (!repository) {
    throw new TrackingError(
      `cannot verify merged pull-request evidence ${parsed.url}: the current GitHub repository is unknown`
    );
  }
  if (parsed.repository.toLowerCase() !== repository.toLowerCase()) {
    throw new TrackingError(
      `refusing to complete from ${parsed.url}: it belongs to ${parsed.repository}, not repository ${repository}`
    );
  }
  const result = run(
    "gh",
    ["pr", "view", parsed.url, "--json", "number,state,mergedAt,url"],
    { allowFailure: true }
  );
  if (result.status !== 0) {
    throw new TrackingError(
      `cannot verify merged pull-request evidence ${parsed.url}`
    );
  }
  const pr = safeJson(result.stdout, `GitHub pull request ${parsed.url}`);
  if (
    pr.url !== parsed.url ||
    pr.number !== parsed.number ||
    String(pr.state ?? "").toUpperCase() !== "MERGED" ||
    typeof pr.mergedAt !== "string" ||
    pr.mergedAt === ""
  ) {
    throw new TrackingError(
      `refusing to complete from ${parsed.url}: the pull request is not verified merged`
    );
  }
  return parsed;
}

/**
 * Read the Linear fields the completion writer must verify before and after.
 * @param {string} ref Canonical Linear identifier.
 * @param {string} token Linear API token.
 * @param {string} context Diagnostic context.
 * @returns {object | undefined} Linear issue snapshot.
 */
function linearCompletionIssue(ref, token, context) {
  return linearGraphql(
    token,
    "query($id:String!){issue(id:$id){id identifier team{key states{nodes{id name type}}} state{id name type} attachments{nodes{url}} comments{nodes{body}}}}",
    { id: ref },
    context
  ).issue;
}

/**
 * Complete one Linear item only after merged, backlinked GitHub evidence.
 * @param {string} ref Canonical Linear identifier.
 * @param {object} contract Resolved Linear tracker contract.
 * @param {string | undefined} prUrl Pull request offered as completion proof.
 * @returns {{merged:number[], terminal:string}} What was applied, and why.
 */
function completeLinearWorkItem(ref, contract, prUrl) {
  if (!prUrl) {
    throw new TrackingError(
      `completing Linear work requires --pr-url <merged-pull-request>`
    );
  }
  const token = readLinearKey(contract.workspace);
  if (!token) {
    throw new TrackingError(
      `completing Linear work requires LINEAR_API_KEY (or ` +
        `LINEAR_API_KEY_${contract.workspace.toLowerCase().replace(/-/g, "_")})`
    );
  }
  const evidence = mergedPullRequestEvidence(prUrl);
  const issue = linearCompletionIssue(
    ref,
    token,
    `Linear issue ${ref} completion lookup`
  );
  if (!issue?.id || issue.identifier !== ref) {
    throw new TrackingError(
      `Linear issue ${ref} does not exist or is inaccessible`
    );
  }
  if (String(issue.team?.key ?? "").toUpperCase() !== contract.teamKey) {
    throw new TrackingError(
      `Linear issue ${ref} belongs to team ${issue.team?.key ?? "(unknown)"}, not ${contract.teamKey}`
    );
  }
  assertBacklink(ref, evidence.url, contract, issue);
  // Folded for MATCHING only. Linear workflow states are display strings a
  // human named on the board, so `Done` and `done` are the same state and the
  // comparison has to say so — but nothing a person reads should be the folded
  // form. `terminal` never leaves this function; every sentence below names
  // either the configured spelling or the one Linear itself returned.
  const terminal = contract.lifecycle.terminal;
  const configuredName = contract.lifecycle.terminalName;
  const states = issue.team?.states?.nodes ?? [];
  const target = states.find(
    state =>
      String(state?.name ?? "").toLowerCase() === terminal &&
      state?.type === "completed"
  );
  if (!target?.id) {
    // No state matched, so there is no API name to quote — the configured
    // spelling is the only display name that exists, and it is also the one
    // the operator would go and change.
    throw new TrackingError(
      `Linear team ${contract.teamKey} has no workflow state named ${configuredName}`
    );
  }
  // From here the API's own spelling outranks the configured one: it is what
  // the board shows, and if the two differ only by case that difference is
  // itself worth surfacing rather than hiding behind the config.
  const displayName = String(target.name ?? configuredName);
  if (
    String(issue.state?.name ?? "").toLowerCase() === terminal &&
    issue.state?.type === "completed"
  ) {
    return { merged: [evidence.number], terminal: displayName };
  }
  const update = linearGraphql(
    token,
    "mutation($id:String!,$stateId:String!){issueUpdate(id:$id,input:{stateId:$stateId}){success issue{id identifier state{id name type}}}}",
    { id: issue.id, stateId: target.id },
    `Linear issue ${ref} completion update`
  ).issueUpdate;
  if (update?.success !== true) {
    throw new TrackingError(`Linear issue ${ref} completion update failed`);
  }
  const readback = linearCompletionIssue(
    ref,
    token,
    `Linear issue ${ref} completion readback`
  );
  if (
    readback?.identifier !== ref ||
    String(readback?.state?.name ?? "").toLowerCase() !== terminal ||
    readback?.state?.type !== "completed"
  ) {
    throw new TrackingError(
      `Linear issue ${ref} did not read back in workflow state ${displayName}`
    );
  }
  return { merged: [evidence.number], terminal: displayName };
}

function completeWorkItem(ref, contract, prUrl) {
  if (contract.provider === "github") {
    return completeGithubWorkItem(ref, contract);
  }
  if (contract.provider === "linear") {
    return completeLinearWorkItem(ref, contract, prUrl);
  }
  throw new TrackingError(
    `no completion writer for tracker '${contract.provider}'; github and linear are supported.\n` +
      `Add one rather than closing by hand — a lifecycle step performed by hand is one nothing can verify happened.`
  );
}

function complete(args) {
  const contract = trackerContract();
  const supplied = option(args, "--ref", "LISA_WORK_ITEM_REF");
  const bound = supplied ? null : boundRef();
  if (!supplied && !bound) {
    throw new TrackingError(
      "complete requires --ref <work-item>, or a worktree binding from `lisa-work-item.mjs link`"
    );
  }
  const ref = canonicalizeRef(supplied ?? bound, contract);
  const prUrl = pullRequestUrlOption(args);
  const outcome = completeWorkItem(ref, contract, prUrl);
  // The writer composes its own sentence when the base branch shaped the
  // outcome, because only the writer knows which bases it read. The Linear
  // path has no such decision to report, so it keeps the original line.
  console.log(
    outcome.report ??
      `work-item completed: ${ref} -> ${outcome.terminal} (merged: ${outcome.merged
        .map(number => `#${number}`)
        .join(", ")})`
  );
}

/**
 * Report every claimed work item that already has a merged pull request.
 *
 * The drift detector. Closing at merge time is the fix; this is what catches
 * the ones that slipped, and what proves whether the fix is holding. Measured
 * before either existed: 27 of 27 claimed items in this repository had a merged
 * pull request, so the claimed lane reported 27 things in flight when the real
 * number was one.
 *
 * Reports by default and only acts under `--apply`, because a sweep that closes
 * things as a side effect of being run is not something anyone will run twice.
 */
function sweep(args) {
  const contract = trackerContract();
  if (contract.provider !== "github") {
    throw new TrackingError(
      `no sweep for tracker '${contract.provider}'; only github is supported so far.`
    );
  }
  const repository = currentRepository();
  if (!repository)
    throw new TrackingError("could not resolve the current GitHub repository");
  const claimed = contract.lifecycle.claimed;
  const listing = run(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repository,
      "--state",
      "open",
      "--label",
      claimed,
      "--limit",
      "200",
      "--json",
      "number,title",
    ],
    { allowFailure: true }
  );
  if (listing.status !== 0) throw githubFailure(listing, repository);
  const issues = safeJson(listing.stdout, "GitHub issue listing");
  const apply = args.includes("--apply");
  let drifted = 0;
  for (const issue of Array.isArray(issues) ? issues : []) {
    const ref = `${repository}#${issue.number}`;
    const merged = mergedPullRequestsIn(githubTimeline(ref), repository);
    if (merged.length === 0) continue;
    drifted += 1;
    const evidence = merged.map(number => `#${number}`).join(", ");
    if (!apply) {
      console.log(`DRIFT  ${ref}  merged: ${evidence}  ${issue.title}`);
      continue;
    }
    const outcome = completeWorkItem(ref, contract);
    // A sweep must not abort on the first item whose merges have not reached a
    // deploy branch. It reports that item and carries on, which is what makes
    // the backstop safe to run over a whole queue.
    console.log(outcome.report);
  }
  if (drifted === 0) {
    console.log(
      `No drift: every item carrying "${claimed}" is genuinely in flight.`
    );
    return;
  }
  if (!apply) {
    console.log(
      `\n${drifted} claimed item(s) already have a merged pull request. Re-run with --apply to complete them.`
    );
  }
}

function prepareCommitMessage(args) {
  const [file, source = ""] = args;
  if (!file)
    throw new TrackingError(
      "prepare-commit-msg requires the commit message file"
    );
  if (
    source === "merge" ||
    RELEASE_SUBJECT.test(messageSubject(readFileSync(file, "utf8")))
  )
    return;
  const state = readState(true);
  if (!state) return;
  assertStateBranch(state);
  const contract = trackerContract();
  const ref = canonicalizeRef(state.ref, contract);
  run("git", [
    "interpret-trailers",
    "--in-place",
    "--if-exists=doNothing",
    "--if-missing=add",
    "--trailer",
    `Work-Item: ${ref}`,
    file,
  ]);
}

function validateCommit(args) {
  const file = args[0];
  if (!file)
    throw new TrackingError("validate-commit requires the commit message file");
  let result;
  try {
    result = validateMessage(readFileSync(file, "utf8"), {
      allowInProgressMerge: true,
    });
  } catch (error) {
    // The commit-msg hook is the EARLIEST moment an operator meets any of this,
    // and all five gates are knowable here even though only two are enforced
    // here. Withholding the other three buys nothing and costs a CI cycle each.
    if (!(error instanceof TrackingError)) throw error;
    throw withGateSummary(error);
  }
  console.log(`WORK_ITEM_TRACKING_OK ${result.exempt ?? result.ref}`);
}

/**
 * The pushed refs worth validating, with the empty push still one answer.
 *
 * A push whose refs introduce no commits is not nothing to report: this command
 * has always answered `0 commit(s)` there, and the pull-request checks still
 * run against it. Dropping every empty group without a replacement would turn
 * that answer into silence.
 * @param {string} input The pre-push stdin stream.
 * @param {string} remote Remote being pushed to.
 * @returns {{localRef: string|undefined, commits: string[], scope: string[]}[]}
 *   Groups to check.
 */
function pushGroups(input, remote) {
  const parsed = parsePushGroups(input, remote);
  const carrying = parsed.filter(group => group.commits.length > 0);
  return carrying.length > 0
    ? carrying
    : [{ localRef: parsed[0]?.localRef, commits: [], scope: [] }];
}

/**
 * Whether this range reaches back to the beginning of history.
 *
 * THE QUESTION THIS ANSWERS IS "IS MY SCOPE STILL VALID", not "is this commit
 * traceable", and that is the whole of CodySwannGT/lisa#3719. The new-branch
 * lane bounds itself with `--not --remotes=<remote>`, which is exact while
 * reachability holds and silently unbounded the moment it does not. A history
 * rewrite gives every commit a new object id, so a branch created before one
 * shares NOTHING with the rewritten remote: the exclusion set removes nothing,
 * the entire history falls into the range, and the gate then refuses on a
 * stranger's years-old commit whose work item closed long ago. It computes a
 * correct answer to the wrong question, and nothing in the refusal says so.
 *
 * A ROOT COMMIT IN RANGE IS THE DISCRIMINATOR, and it is deliberately not a
 * size heuristic. A range that legitimately belongs to one branch begins at a
 * base the remote can still reach, so the walk stops there — reaching a
 * parentless commit means it did not stop anywhere, which is the unbounded case
 * itself rather than a proxy for it. A long branch stays a long branch.
 *
 * `--max-parents=0` re-asks the range's OWN rev-list, so the answer costs one
 * git call whatever the history's size. Filtering the returned commit list
 * instead would spawn one child per commit — thousands of them in exactly the
 * case this detects, inside a push gate.
 * @param {{commits: string[], scope: string[]}} group One pushed ref's range.
 * @param {string} remote Remote being pushed to.
 * @returns {boolean} True when the range runs to a parentless commit.
 */
export function ancestryUnreachable(group, remote) {
  if (group.commits.length === 0 || group.scope.length === 0) return false;
  // A repository's FIRST push carries its root commit legitimately: nothing is
  // published yet, so the exclusion set is empty because there is nothing to
  // exclude, not because history moved. Reading that as a rewrite would make
  // every new repository unpushable — the same defect, inverted.
  // `--format` is presentation only, and deliberately not asserted on: this
  // reads the ANSWER's emptiness, not its shape, so emptying the format still
  // prints for-each-ref's default line for each ref and still prints nothing
  // for none. A hand-run mutant emptying it survives, and is equivalent rather
  // than a test gap — the ref pattern beside it is the argument that decides
  // the answer, and a mutant emptying THAT is killed.
  const published = git([
    "for-each-ref",
    "--count=1",
    "--format=%(refname)",
    `refs/remotes/${remote}/`,
  ]);
  if (published === "") return false;
  return git([...group.scope, "--max-parents=0"]) !== "";
}

/**
 * The refusal for a range whose base the remote can no longer reach.
 *
 * Deliberately says NOTHING about work items. The defect being repaired is that
 * this push was refused over a stranger's closed ticket, so a message that
 * still argues about tickets — even the right ones — reproduces the
 * misdirection at a different address. `selfExplanatory` suppresses the
 * five-gate checklist for the same reason it is suppressed on the
 * push-destination refusal: no gate here is cleared by naming a ticket.
 * @param {string|undefined} localRef The ref being pushed.
 * @returns {TrackingError} The refusal to raise.
 */
export function unreachableAncestryRefusal(localRef) {
  const branch = localRef
    ? pushedBranchName(localRef) || localRef
    : "this branch";
  const error = new TrackingError(
    `The commits on ${branch} are no longer reachable from "origin", so this ` +
      `push cannot tell which of them the branch actually adds.\n\n` +
      `WHAT HAPPENED: the shared history was rewritten after this branch was ` +
      `created. Rewriting gives every commit a new identity, so nothing this ` +
      `branch was built on still exists on the remote — and the check that ` +
      `normally asks "what is new here?" gets the whole history back instead.\n\n` +
      `WHY IT IS NOT REFUSING YOUR WORK: the commits it would otherwise ` +
      `complain about are other people's, from before the rewrite. Nothing is ` +
      `wrong with what you wrote.\n\n` +
      `WHAT TO DO: copy your commits onto the current branch instead of ` +
      `pushing this one as it stands — \`git cherry-pick\` each of your own ` +
      `commits onto a fresh branch taken from an up-to-date "main", then push ` +
      `that. Merging "main" into this branch does NOT help: a merge adds a ` +
      `parent, it cannot make the old commits exist on the remote again.`
  );
  error.selfExplanatory = true;
  return error;
}

/**
 * Which pushed ref the pull request in hand is actually about.
 *
 * `gh pr view` answers for the CURRENT BRANCH, so its body and backlink are
 * evidence about that branch and nothing else. Checking a second branch's range
 * against it would report another branch's work item as missing from a body
 * that was never supposed to name it.
 * @param {object[]} groups The pushed refs.
 * @param {object|undefined} pr The pull request, when one exists.
 * @returns {object|undefined} The group the pull request describes.
 */
function prTargetGroup(groups, pr) {
  if (!pr) return undefined;
  if (groups.length === 1) return groups[0];
  const branch = activeBranch();
  return groups.find(
    group => branch && pushedBranchName(group.localRef ?? "") === branch
  );
}

/**
 * What a push could not prove here, named rather than left to CI to reveal.
 *
 * The multi-item sentence is the one that matters. A range naming several work
 * items is legitimate, and it is also the shape most likely to be an accident —
 * so the moment it is observed, the operator is told what CI will require of
 * it: a body declaring every one of them. Refusing here instead would be a
 * refusal with no remedy, because the body it asks for belongs to a pull
 * request that cannot exist until this push lands.
 * @param {object} result Commit-side result.
 * @returns {string} The clause after the commit count.
 */
function pushDeferralNote(result) {
  const refs = result.refs ?? [];
  const spanning =
    refs.length > 1
      ? ` This range names ${refs.length} work items (${refs.join(", ")}): allowed, but the pull-request body must then declare every one of them, and ${GATE_MAPPING} refuses it at CI time if it does not.`
      : "";
  return `no pull request exists yet, so gates 4 and 5 could not be checked here — CI will verify both.${spanning}`;
}

/**
 * The two unchecked gates as open work, addressed to whoever runs the push.
 *
 * The wording is the whole point of this function, so it is worth saying what
 * it is deliberately NOT: `WORK_ITEM_TRACKING_OK`. This same text used to be
 * appended to that token, which made a finding arrive inside a success — and a
 * finding inside a success is not a finding. Nobody reads an unmet requirement
 * out of a line that opens by declaring the check passed, so the gate did the
 * hard part (it knows exactly which two requirements it could not reach, and
 * says so) and then threw the answer away in its own headline
 * (CodySwannGT/lisa#3791).
 *
 * The exit code stays 0, and that is not the same compromise. A push is the
 * only way to make a branch exist on the remote, and a pull request cannot be
 * opened for a branch the remote has never seen — so refusing here would be a
 * refusal with no remedy, and the first push of every branch would be
 * impossible. What is available at this moment is the OTHER half of a control:
 * name the unmet requirements as unmet, and name the command that discharges
 * them the moment they become checkable. `discharge-pr-gates` is that command,
 * and it is what makes this list closeable rather than merely honest.
 *
 * Gate 5 is stated as inapplicable rather than unresolved under the `trailer`
 * level, because a run that contacted no tracker has not left a backlink
 * unposted — it is not required at all there. Listing it as open work would
 * ask an operator to resolve something no check will ever look at.
 * Exported so the report can be asserted in-process. The push path reaches it
 * only through a spawned child, where a mutation run records no coverage and
 * scores every line of this text as unreached — so the subprocess cases prove
 * the WIRING and the direct cases prove the WORDS.
 * @param {object} result Commit-side result.
 * @param {string} label Prefix naming the ref, empty for a single-ref push.
 * @returns {string} The whole report, replacing the success line.
 */
export function unresolvedPushReport(result, label) {
  const contract = result.contract;
  const refs = result.refs ?? [];
  const declaration = refs.map(ref => `Work-Item: ${ref}`).join("\n     ");
  const backlinkLine =
    contract.verify === "full"
      ? `  UNRESOLVED gate 5 — each item needs a managed \`${MARKER}\` backlink comment pointing at the pull request. \`discharge-pr-gates\` posts it; nothing else has to remember to.`
      : `  n/a         gate 5 — the tracker backlink is not required here: workItem.verify is "trailer".`;
  return [
    `WORK_ITEM_TRACKING_INCOMPLETE ${label}${result.relevant} commit(s)${alreadyTraced(result)}: gates 1-3 proved here, 2 of 5 gates NOT CHECKED.`,
    `  This push is not a clean bill of health for ${refs.join(", ")}. ${pushDeferralNote(result)}`,
    `  UNRESOLVED gate 4 — the pull-request BODY must carry, on its own line${refs.length > 1 ? "s" : ""}:`,
    `     ${declaration}`,
    `     \`Refs #n\` and \`Closes #n\` do NOT satisfy it.`,
    backlinkLine,
    `  Discharge both the moment the pull request exists — it evaluates them and`,
    `  posts what it can, so neither waits for CI to reveal it:`,
    `     node scripts/lisa-work-item.mjs ${DISCHARGE_COMMAND}`,
    gateSummary(contract),
  ].join("\n");
}

/**
 * The success line a pushed ref with an open pull request prints.
 *
 * Exported for one reason, and it is the acceptance criterion rather than a
 * convenience: CodySwannGT/lisa#3886's third scenario is an INEQUALITY between
 * the empty-range line and the merge-only line, and nothing can assert that
 * unless something can produce both. A test that read one of them out of a
 * subprocess transcript would pin the shape it happened to reproduce and say
 * nothing about the other — which is how two states came to share a sentence in
 * the first place.
 * @param {object} result Commit-side result.
 * @param {string} label Prefix naming the ref, empty for a single-ref push.
 * @returns {string} The success line.
 */
export function pushSuccessLine(result, label) {
  return (
    `WORK_ITEM_TRACKING_OK ${label}${result.relevant} commit(s)` +
    `${alreadyTraced(result)}${carriedByPullRequest(result)}, ` +
    `${provedHere(result.contract)}`
  );
}

/**
 * Report one pushed ref's outcome, refusing when it did not prove out.
 * @param {{result?: object, error?: Error}} outcome Commit-side outcome.
 * @param {object|undefined} pr The pull request this ref is about, if any.
 * @param {string} label Prefix naming the ref, empty for a single-ref push.
 */
function reportPushGroup(outcome, pr, label) {
  if (pr) {
    // `true`: a push range is ALWAYS a subset of the pull request's — it drops
    // commits already on the remote branch and everything reachable from the
    // remote default branch. So a commit side with nothing in it means "no
    // subject in THIS push", never "no subject in the pull request".
    validatePrData(outcome, pr.url, pr.body, true);
    console.log(pushSuccessLine(outcome.result, label));
    return;
  }
  // No pull request means gates 4 and 5 cannot be CHECKED here. They are
  // still perfectly well KNOWN here, and this is the last local moment before
  // CI — so the checklist goes out either way. Saying nothing is precisely
  // what made those two gates separate CI-cycle surprises (#2681).
  if (outcome.error) throw withGateSummary(outcome.error);
  // A range naming no work item is a different fact from a range whose
  // declaration nobody checked, and the two must not share a sentence. Nothing
  // here is deferred: a release commit and a back-merge have no item for a
  // pull-request body to declare or a tracker to link, so gates 4 and 5 have
  // NOTHING to check rather than something unchecked. Reporting those as open
  // work would put an unresolvable item on every release push, which is how a
  // checklist teaches the reader to skip it.
  if ((outcome.result.refs ?? []).length === 0) {
    console.log(
      `WORK_ITEM_TRACKING_OK ${label}${outcome.result.relevant} commit(s)${alreadyTraced(outcome.result)}; this range names no work item, so gates 4 and 5 have nothing to check here.`
    );
    return;
  }
  console.log(unresolvedPushReport(outcome.result, label));
}

function validatePush(args) {
  const remote = args[0] || "origin";
  const input = readFileSync(0, "utf8");
  // The deploy chain is read from the remote default branch, the same ref this
  // path already trusts to bound the range. A local working tree could declare
  // anything, but so could a `--no-verify`; CI is the enforcing copy.
  const configRef = remoteDefaultRef(remote);
  const groups = pushGroups(input, remote);
  const pr = currentPullRequest();
  const target = prTargetGroup(groups, pr);
  for (const group of groups) {
    // BEFORE the commits are judged, not after: every verdict below is computed
    // over a range, and a range this wide is not evidence about anything. The
    // order is the fix — judging first and diagnosing afterwards is what
    // produced a refusal naming a stranger's closed ticket (#3719).
    if (ancestryUnreachable(group, remote))
      throw unreachableAncestryRefusal(group.localRef);
    const outcome = commitOutcome(group.commits, configRef, remote);
    reportPushGroup(
      outcome,
      group === target ? pr : undefined,
      groups.length > 1 ? `${group.localRef ?? "(stdin)"}: ` : ""
    );
  }
}

/**
 * Refuse, but as "there is nothing here to check" rather than "this failed".
 *
 * Its own exit code because the two answers ask opposite things of whoever is
 * reading. `1` says a requirement is unmet and the change must not proceed;
 * `3` says this command was run somewhere it has no subject — before the pull
 * request exists, or on a branch that has none. A caller that fires this
 * automatically (the PostToolUse hook does, after any `gh pr` command,
 * including ones that failed) must be able to tell them apart without parsing
 * prose, or every failed `gh pr create` would report a work-item violation
 * that did not happen.
 * Exported so the code and the wording can be asserted without a tracker: an
 * error object is a value, and the whole content of this one is which number
 * it carries.
 * @returns {Error} The refusal, carrying its own exit code.
 */
export function noPullRequestToDischarge() {
  const error = new TrackingError(
    `${DISCHARGE_COMMAND} found no pull request for this branch, so gates 4 ` +
      `and 5 have no subject yet. Open the pull request, then run it again.`
  );
  error.exitCode = 3;
  error.selfExplanatory = true;
  return error;
}

/**
 * Close out gates 4 and 5 at the first moment they can be checked.
 *
 * A push cannot check them: both are properties of a pull request, and the
 * push is what makes the pull request possible. Until this command existed the
 * next thing that looked was CI, one cycle later — so a body missing its
 * `Work-Item:` line, or an item missing its backlink, cost a full red run to
 * discover something that was knowable the second the pull request opened
 * (CodySwannGT/lisa#3791).
 *
 * It does not merely CHECK gate 5, it satisfies it. The managed backlink is
 * something a producer can write and no human should have to remember, and the
 * reason it has to be written at all is a coupling neither rule states on its
 * own: the convention is to reference an item with `Refs #n` rather than
 * `Closes #n`, so the merge cannot close it before deploy and verification —
 * and `Refs` populates no native development link for gate 5 to read. The
 * non-closing rule is what MAKES the managed comment mandatory.
 *
 * Gate 4 is checked and never written. The body is the author's declaration of
 * what this change is for; a command that inserted the line would be answering
 * its own question, and the gate would be proving that this command can write.
 * @param {string[]} args Command arguments.
 */
function dischargePrGates(args) {
  const remote = option(args, "--remote", "LISA_PR_REMOTE") || "origin";
  const pr = currentPullRequest(
    option(args, "--pr-number", "LISA_PR_NUMBER"),
    undefined,
    "url,body,state,commits"
  );
  if (!pr) throw noPullRequestToDischarge();
  const configRef = remoteDefaultRef(remote);
  const commits = (pr.commits ?? []).map(commit => commit.oid).filter(Boolean);
  const first = commitOutcome(commits, configRef, remote);
  const contract = first.result?.contract ?? trackerContract();
  const refs = first.result?.refs ?? [];
  const wrote = postDischargeBacklinks(refs, pr.url, contract);
  // A SECOND read when anything actually changed, and the reason is the defect
  // this whole file exists to avoid. `validatePrData` reads gate 5 out of the
  // issue payload the FIRST pass cached — fetched before the comment above was
  // posted — so validating against it would report a backlink missing that
  // this command had just written, and the operator would be sent to fix
  // something already fixed. Nothing is re-read when every backlink came back
  // `unchanged`, because then the cached payload and the tracker agree.
  const outcome = wrote ? commitOutcome(commits, configRef, remote) : first;
  validatePrData(outcome, pr.url, pr.body);
  console.log(
    `WORK_ITEM_TRACKING_OK ${outcome.result.relevant} commit(s)${alreadyTraced(outcome.result)}, ${provedHere(contract)} — gates 4 and 5 discharged at the pull request, not deferred to CI`
  );
}

/**
 * Establish the managed backlink for every item this pull request carries.
 *
 * The writer is a parameter for the same reason `assertBacklink` takes its
 * issue payload as one: it is the only part that touches a tracker, and
 * without the seam the answer this function returns — did anything actually
 * change, which is what decides whether the verification re-reads — can only
 * be observed through a network round trip.
 * @param {string[]} refs Work items the range names.
 * @param {string} prUrl Pull request URL.
 * @param {object} contract Resolved tracker contract.
 * @param {Function} [post] Backlink writer, defaulting to the real one.
 * @returns {boolean} True when any tracker write actually changed something.
 */
export function postDischargeBacklinks(
  refs,
  prUrl,
  contract,
  post = postBacklink
) {
  // `trailer` contacts no tracker anywhere else in this file, and it may not
  // start here: a project that keeps no tracker credentials cannot satisfy a
  // write, and gate 5 is not asked of it.
  if (contract.verify !== "full") return false;
  let changed = false;
  for (const ref of refs) {
    const outcome = post(ref, prUrl, contract);
    changed ||= outcome.change !== "unchanged";
    console.log(backlinkReport(outcome, ref, prUrl));
  }
  return changed;
}

function validatePr(args) {
  const base = option(args, "--base", "LISA_PR_BASE_SHA");
  const head = option(args, "--head", "LISA_PR_HEAD_SHA") || "HEAD";
  if (!base)
    throw new TrackingError("validate-pr requires --base or LISA_PR_BASE_SHA");
  // `actions/checkout` always names the remote `origin`, so the fallback is
  // right for every CI run. The option exists for a developer running this by
  // hand in a clone whose remote is named something else, where defaulting
  // would resolve no deploy-chain ref and quietly withdraw the exemption.
  const remote = option(args, "--remote", "LISA_PR_REMOTE") || "origin";
  const commits = git(["rev-list", `${base}..${head}`])
    .split("\n")
    .filter(Boolean);
  const outcome = commitOutcome(commits, base, remote);
  const bodyFile = option(args, "--body-file", "LISA_PR_BODY_FILE");
  const prNumber = option(args, "--pr-number", "LISA_PR_NUMBER");
  const suppliedUrl = pullRequestUrlOption(args);
  const repository =
    option(args, "--repo", "GITHUB_REPOSITORY") ?? currentRepository();
  const fetched = bodyFile
    ? undefined
    : currentPullRequest(prNumber, repository);
  const pr = bodyFile
    ? { url: suppliedUrl, body: readFileSync(bodyFile, "utf8") }
    : fetched && { ...fetched, url: suppliedUrl ?? fetched.url };
  if (!pr) {
    throw new TrackingError(
      "validate-pr requires --pr-number or --body-file, and an accessible GitHub PR"
    );
  }
  // The URL identifies the pull request a BACKLINK must point at, so it is
  // required exactly when a backlink is. Demanding it under `trailer` would
  // reintroduce a credentialled step into the credential-free path for no
  // check that consumes it.
  if (
    !pr.url &&
    (outcome.result?.contract ?? trackerContract()).verify === "full"
  ) {
    throw new TrackingError(
      "validate-pr requires --pr-url/--url alongside --body-file so the tracker backlink can be verified"
    );
  }
  validatePrData(outcome, pr.url, pr.body);
  console.log(
    `WORK_ITEM_TRACKING_OK ${outcome.result.relevant} commit(s)${alreadyTraced(outcome.result)}, ${provedHere(outcome.result.contract)}`
  );
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  // `link` and `bind` are the same operation under two names, and the reason is
  // the argument vector rather than the semantics.
  //
  // `bind` is a bash builtin that evaluates a string, so agent harnesses that
  // scan a command for string-evaluating programs match the bare token wherever
  // it lands — argv[0] or, as here, a subcommand three words in. Claude Code's
  // worktree isolation does precisely that, and it refused
  // `node scripts/lisa-work-item.mjs bind <ref>` outright: the one step Lisa
  // documents as mandatory before any durable work became impossible to run in
  // the isolated worktrees Lisa itself tells agents to use. Three agents hit it
  // in a single session, each independently rediscovering the same
  // carry-the-trailer-by-hand workaround.
  //
  // That guard belongs to the harness, is not Lisa's to narrow, and is doing
  // something legitimate — so the fix is to stop standing on its toes. `link`
  // is the spelling the docs teach and the one that works everywhere.
  //
  // `bind` is kept forever, not deprecated: it is written into host projects'
  // checked-in git hooks and CI, and those copies update on their own schedule.
  // Removing it to tidy up a name would break the very traceability gate this
  // file exists to enforce, in repositories that had done nothing wrong.
  if (command === "link" || command === "bind") return bind(args);
  if (command === "current")
    return console.log(JSON.stringify(readState(false), null, 2));
  if (command === "attach-branch") {
    const state = readState(false);
    const contract = trackerContract();
    if (state.provider !== contract.provider) {
      throw new TrackingError(
        `Work-item binding provider ${state.provider} does not match configured tracker ${contract.provider}`
      );
    }
    const ref = canonicalizeRef(state.ref, contract);
    validateLive(ref, contract);
    const file = writeState(ref, contract.provider, { requireBranch: true });
    return console.log(
      `work-item binding attached to ${activeBranch()} (${file})`
    );
  }
  if (command === "clear") {
    rmSync(statePath(), { force: true });
    return console.log("work-item binding cleared");
  }
  if (command === "backlink") return backlink(args);
  if (command === "complete") return complete(args);
  if (command === "sweep") return sweep(args);
  // One place resolves the level, and everything else asks. The CI job needs
  // it to decide whether a missing tracker credential is a problem, and a
  // second implementation of the precedence rules in shell is exactly the
  // two-parsers drift this change exists to remove.
  if (command === "verify-level") return console.log(trackerContract().verify);
  // Deliberately reads NOTHING — no config, no git, no tracker. The workflow
  // half calls this to find out how old this file is, and that answer has to
  // survive the states where every other subcommand refuses: no
  // `.lisa.config.json`, no tracker, no repository. A staleness probe that
  // itself needs a healthy project reports "unknown" exactly when a project is
  // broken, which is when the answer matters most.
  if (command === "contract-version")
    return console.log(WORK_ITEM_CONTRACT_VERSION);
  if (command === "prepare-commit-msg") return prepareCommitMessage(args);
  if (command === "validate-commit") return validateCommit(args);
  if (command === "validate-push") return validatePush(args);
  if (command === "validate-push-destination")
    return validatePushDestination(args);
  if (command === "validate-pr") return validatePr(args);
  if (command === DISCHARGE_COMMAND) return dischargePrGates(args);
  throw new TrackingError(
    "Usage: lisa-work-item.mjs link|current|attach-branch|clear|verify-level|contract-version|backlink|complete|sweep|prepare-commit-msg|validate-commit|validate-push|validate-push-destination|validate-pr|discharge-pr-gates" +
      "\n(`bind` is accepted as an alias for `link`, but some agent harnesses refuse the token `bind` in a command line.)"
  );
}

/**
 * Run the CLI, reporting any refusal the way the Git hooks expect.
 *
 * Exported so the thin entrypoint at `scripts/lisa-work-item.mjs` can invoke it
 * explicitly. That entrypoint re-exports this module rather than duplicating
 * it, so inside here `import.meta.url` names THIS file while `argv[1]` names
 * the entrypoint — the two never match, and a guard comparing them would leave
 * Lisa's own hooks doing nothing at all, silently and with exit 0. An exported
 * call is unambiguous where a path comparison is a guess.
 */
export function runCli() {
  try {
    main();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      error?.selfExplanatory === true
        ? `\n❌ ${detail}\n`
        : `\n❌ Work-item tracking blocked this operation: ${detail}\n\n${GUIDANCE}\n`
    );
    // A refusal may name its own exit code, and one does: `discharge-pr-gates`
    // answers 3 for "no pull request to check yet", which is not a violation
    // and must not read as one to a caller that only has the status to go on.
    process.exitCode = error?.exitCode ?? 1;
  }
}

// Only when invoked as a program. Running on import made every function here
// unreachable from a test: importing the module executed the CLI, so the only
// way to exercise any of it was to spawn a process and drive it through the
// filesystem and PATH. That is why a bug in the message above shipped — the
// branch that produced it had no way to be asserted on.
//
// This branch covers a host project, where the file is copied to
// `scripts/lisa-work-item.mjs` and invoked directly. Lisa's own checkout keeps
// a re-exporting entrypoint instead, which calls runCli() itself.
if (invokedAsScript(import.meta.url)) {
  runCli();
}
