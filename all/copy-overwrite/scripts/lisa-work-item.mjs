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

const RELEASE_SUBJECT =
  /^chore\(release\): \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? \[skip ci\]$/;
const ZERO_OID = /^0+$/;
const MARKER = "[lisa-pr-link]";
/**
 * The command that establishes the ticket-side backlink.
 *
 * Named in every refusal that the backlink is missing. A validator that
 * reports "no verified backlink" without the remedy sends the reader looking
 * for a producer that, until this command existed, was prose in a SKILL.md.
 */
const BACKLINK_COMMAND = "node scripts/lisa-work-item.mjs backlink";
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

class TrackingError extends Error {}

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
    if (headName.startsWith("refs/heads/")) {
      return headName.slice("refs/heads/".length);
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
  return {
    claimed: requireString(roles.claimed, `${provider} claimed lifecycle role`),
    ready: requireString(roles.ready, `${provider} ready lifecycle role`),
    terminal: String(terminal ?? "").toLowerCase(),
  };
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
  return soleWorkItem(message, contract, "commit message");
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

function commitExemption(sha) {
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).split(/\s+/);
  if (parents.length > 2) return "merge";
  return RELEASE_SUBJECT.test(git(["show", "-s", "--format=%s", sha]))
    ? "release"
    : undefined;
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
 * Establish the backlink on a GitHub issue.
 * @param {string} ref Canonical `owner/repo#number` reference.
 * @param {string} prUrl Pull request URL.
 * @returns {string} What changed: created, updated, or unchanged.
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
  const managed = (Array.isArray(comments) ? comments : []).find(comment =>
    carriesMarker(comment?.body)
  );
  const body = backlinkBody(prUrl);
  if (managed && managed.body === body) return "unchanged";
  const [method, endpoint] = managed
    ? ["PATCH", `repos/${repository}/issues/comments/${managed.id}`]
    : ["POST", `repos/${repository}/issues/${number}/comments`];
  run("gh", ["api", "--method", method, endpoint, "--field", `body=${body}`], {
    error: `could not write the backlink comment on ${ref}`,
  });
  return managed ? "updated" : "created";
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
 * @returns {string} What changed: created, updated, or unchanged.
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
  const managed = (issue.comments?.nodes ?? []).find(comment =>
    carriesMarker(comment?.body)
  );
  const body = backlinkBody(prUrl);
  if (managed && managed.body === body) return "unchanged";
  if (managed) {
    linearGraphql(
      token,
      "mutation($id:String!,$body:String!){commentUpdate(id:$id,input:{body:$body}){success}}",
      { body, id: managed.id },
      `Linear backlink update on ${ref}`
    );
    return "updated";
  }
  linearGraphql(
    token,
    "mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success}}",
    { body, id: issue.id },
    `Linear backlink comment on ${ref}`
  );
  return "created";
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
 * @returns {string} What changed: created, updated, or unchanged.
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
  const managed = (existing.comments ?? []).find(comment =>
    carriesMarker(comment?.body)
  );
  const document = jiraCommentDocument(prUrl);
  const payload = JSON.stringify({ body: document });
  if (managed && JSON.stringify(managed.body) === JSON.stringify(document))
    return "unchanged";
  secureCurl(
    [managed ? `${issueUrl}/${encodeURIComponent(managed.id)}` : issueUrl],
    [
      ...auth,
      ["request", managed ? "PUT" : "POST"],
      ["header", CONTENT_TYPE_JSON],
      [DATA_BINARY, payload],
    ],
    { error: `could not write the backlink comment on ${ref}` }
  );
  return managed ? "updated" : "created";
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
 * @returns {string} What changed: created, updated, or unchanged.
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
  // A GitHub reference is `owner/repo#123`; no branch-naming convention
  // encodes one, so there is nothing here to read.
  if (contract.provider === "github") return undefined;
  const branch = activeBranch();
  if (!branch) return undefined;
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
 * pull-request validation) keeps calling `assertStateMatches` directly: it
 * already refuses mixed references across commits, and in CI the head is
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

function validateCommits(commits) {
  const contract = trackerContract();
  const refs = new Set();
  const issues = new Map();
  let relevant = 0;
  let mergeExempt = 0;
  let releaseExempt = 0;
  for (const sha of new Set(commits)) {
    const exemption = commitExemption(sha);
    if (exemption === "merge") {
      mergeExempt += 1;
      continue;
    }
    if (exemption === "release") {
      releaseExempt += 1;
      continue;
    }
    relevant += 1;
    const ref = exactWorkItem(commitMessage(sha), contract);
    refs.add(ref);
    if (!issues.has(ref)) issues.set(ref, validateLive(ref, contract));
  }
  if (refs.size > 1)
    throw new TrackingError(
      `Push/PR contains mixed Work-Item references: ${[...refs].join(", ")}`
    );
  const [ref] = refs;
  if (ref) assertStateMatches(ref, contract);
  return {
    contract,
    ref,
    issue: ref ? issues.get(ref) : undefined,
    mergeExempt,
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
  if (symref.status !== 0) return undefined;
  const target = symref.stdout.trim();
  if (!target.startsWith(`refs/remotes/${remote}/`)) return undefined;
  const exists = run("git", ["rev-parse", "-q", "--verify", target], {
    allowFailure: true,
  });
  return exists.status === 0 ? target : undefined;
}

function parsePushLines(input, remote) {
  const commits = [];
  // Commits already reachable from the remote default branch are the base's
  // history (a merge-sync brings them along); excluding them keeps validation
  // scoped to branch-authored commits (issue #1956).
  const defaultRef = remoteDefaultRef(remote);
  for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
    const [, localOid, , remoteOid] = line.trim().split(/\s+/);
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
    commits.push(...git(args).split("\n").filter(Boolean));
  }
  if (commits.length === 0 && input.trim() === "") {
    commits.push(
      ...git(["rev-list", "HEAD", "--not", `--remotes=${remote}`])
        .split("\n")
        .filter(Boolean)
    );
  }
  return commits;
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
 * The one work item a PULL-REQUEST BODY names.
 *
 * Same rule as the commit message, through the same function. See
 * `soleWorkItem` for why the two used to disagree and why they no longer do.
 * @param {string} body Pull-request body.
 * @param {object} contract Resolved tracker contract.
 * @returns {string} The canonical work-item reference.
 */
function prWorkItem(body, contract) {
  return soleWorkItem(body, contract, "pull request body");
}

/**
 * A requirement no edit to this pull request can satisfy. Reported FIRST, and
 * said plainly, because the alternative is what #2681 measured: three
 * successful fixes spent on a pull request that then turned out to need
 * recreating anyway.
 */
const OUTSIDE_THIS_PR = "[not fixable by editing this pull request]";
/** A requirement an amend or a body edit clears. */
const IN_THIS_PR = "[fixable by editing this pull request]";
/** Worst first. The whole point of the ordering. */
const SCOPE_ORDER = [OUTSIDE_THIS_PR, IN_THIS_PR];

/**
 * Validate the commits, keeping a refusal rather than aborting the run.
 *
 * The pull-request gate checks several separate things and used to stop at the
 * first unmet one, so each CI cycle revealed exactly one requirement. It knew
 * the rest at the same moment; it was simply not saying. See `gateSummary` for
 * the full count, which is five and was itself miscounted as four.
 * @param {string[]} commits Commits in the pull request range.
 * @returns {{result?: object, error?: Error}} Outcome, never a throw.
 */
function commitOutcome(commits) {
  try {
    return { result: validateCommits(commits) };
  } catch (error) {
    if (!(error instanceof TrackingError)) throw error;
    return { error };
  }
}

/**
 * Run one check, recording its refusal as a finding instead of throwing.
 * @param {object[]} findings Accumulator.
 * @param {string} scope Whether an edit to this pull request can fix it.
 * @param {Function} check The check to run.
 * @returns {unknown} The check's value, or undefined when it refused.
 */
function collect(findings, scope, check) {
  try {
    return check();
  } catch (error) {
    if (!(error instanceof TrackingError)) throw error;
    findings.push({ message: error.message, scope });
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
    `which creates that comment or updates the existing one, so running it twice is safe`
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
    "  3. every commit message carries ONE matching `Work-Item:` trailer — required by the commit-msg hook, on every single commit",
    "  4. the pull-request BODY carries that same `Work-Item:` trailer — a SEPARATE check from gate 3, run at push once a pull request exists and again at CI time; `Closes owner/repo#N` does NOT satisfy it",
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
  return new TrackingError(
    `${error.message}\n${gateSummary(trackerContract())}`
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
      (finding, index) => `${index + 1}. ${finding.scope} ${finding.message}`
    )
    .join("\n\n");
  return `${head}\n\n${body}\n${gateSummary(contract)}`;
}

/**
 * Check every pull-request requirement and report all of the unmet ones.
 * @param {{result?: object, error?: Error}} outcome Commit-side outcome.
 * @param {string} prUrl Pull request URL.
 * @param {string} prBody Pull request body.
 */
function validatePrData(outcome, prUrl, prBody) {
  const result = outcome.result;
  if (result?.relevant === 0 && result.releaseExempt > 0 && !result.mergeExempt)
    return;
  const contract = result?.contract ?? trackerContract();
  const findings = [];
  if (outcome.error)
    findings.push({ message: outcome.error.message, scope: IN_THIS_PR });
  else if (result.relevant === 0)
    findings.push({
      message: "Pull request has no non-merge commit linked to a work item",
      scope: IN_THIS_PR,
    });
  else if (!result.ref)
    findings.push({
      message: "Pull request commits are not linked to a work item",
      scope: IN_THIS_PR,
    });
  const commitRef = result?.ref;
  const bodyRef = collect(findings, IN_THIS_PR, () =>
    prWorkItem(prBody, contract)
  );
  if (commitRef && bodyRef && bodyRef !== commitRef)
    findings.push({
      message: `Pull request Work-Item ${bodyRef} does not match commit Work-Item ${commitRef}`,
      scope: IN_THIS_PR,
    });
  const ref = commitRef ?? bodyRef;
  // Requirement 4 belongs to `full` alone: it needs tracker WRITE access, and
  // a project that keeps no tracker credentials cannot ever satisfy it. The
  // reference checks above are what stays, and they still refuse everything
  // that is genuinely untraceable.
  if (ref && contract.verify === "full") {
    const before = findings.length;
    collect(findings, OUTSIDE_THIS_PR, () =>
      assertBacklink(ref, prUrl, contract, commitRef ? result.issue : undefined)
    );
    if (findings.length > before)
      findings[before].message += `. ${backlinkAdvice(ref, prUrl, contract)}`;
  }
  if (findings.length > 0)
    throw new TrackingError(requirementReport(findings, contract));
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
  if (result.status !== 0) return undefined;
  return safeJson(result.stdout, "GitHub repository").nameWithOwner;
}

function currentPullRequest(number, repository = currentRepository()) {
  const args = ["pr", "view"];
  if (number) args.push(String(number));
  if (repository) args.push("--repo", repository);
  args.push("--json", "url,body,state");
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
  const prUrl =
    option(args, "--pr-url", "LISA_PR_URL") ??
    option(args, "--url", "LISA_PR_URL");
  if (!prUrl)
    throw new TrackingError(`${BACKLINK_COMMAND} requires --pr-url <url>`);
  const outcome = postBacklink(ref, prUrl, contract);
  console.log(`work-item backlink ${outcome} on ${ref}: ${MARKER} ${prUrl}`);
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
 * Move a work item to its configured terminal role and close it.
 *
 * The terminal role is RESOLVED from configuration, never assumed. Lisa's own
 * repository maps `production` to `status:done`, but the map is environment
 * aware — a project whose target is `dev` has a different terminal role, and a
 * hardcoded label would silently apply the wrong one there while looking
 * correct here. `lifecycleContract` already computes this for every provider.
 *
 * **It refuses without evidence.** A completion command that closes whatever it
 * is pointed at is a way to make unfinished work disappear, which is the same
 * defect class as a gate that passes because it found nothing. Evidence is a
 * merged pull request in this repository.
 * @param {string} ref Canonical work-item reference.
 * @param {object} contract The resolved tracker contract.
 * @returns {{merged: number[], terminal: string}} What was applied, and why.
 */
function completeWorkItem(ref, contract) {
  if (contract.provider !== "github") {
    throw new TrackingError(
      `no completion writer for tracker '${contract.provider}'; only github is supported so far.\n` +
        `Add one rather than closing by hand — a lifecycle step performed by hand is one nothing can verify happened.`
    );
  }
  const [repository, number] = ref.split("#");
  const merged = mergedPullRequestsIn(githubTimeline(ref), repository);
  if (merged.length === 0) {
    throw new TrackingError(
      `refusing to complete ${ref}: no merged pull request in ${repository} references it.\n` +
        `Completion is evidence-based on purpose. A command that closes whatever it is pointed at\n` +
        `is a way to make unfinished work disappear, and the closure would be indistinguishable\n` +
        `from a real one afterwards. If the work shipped some other way, say so on the item and close it deliberately.`
    );
  }
  const terminal = contract.lifecycle.terminal;
  const claimed = contract.lifecycle.claimed;
  const edit = [
    "issue",
    "edit",
    String(number),
    "--repo",
    repository,
    "--add-label",
    terminal,
  ];
  // Removing the claimed role is what makes the claimed lane mean something.
  // Leaving it produces the exact drift this command exists to end: an item
  // that is closed AND still reports as in progress.
  if (claimed && claimed !== terminal) {
    edit.push("--remove-label", claimed);
  }
  const edited = run("gh", edit, { allowFailure: true });
  if (edited.status !== 0) throw githubFailure(edited, ref);
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
  return { merged, terminal };
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
  const { merged, terminal } = completeWorkItem(ref, contract);
  console.log(
    `work-item completed: ${ref} -> ${terminal} (merged: ${merged
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
    const { terminal } = completeWorkItem(ref, contract);
    console.log(`completed ${ref} -> ${terminal}  (merged: ${evidence})`);
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

function validatePush(args) {
  const remote = args[0] || "origin";
  const input = readFileSync(0, "utf8");
  const outcome = commitOutcome(parsePushLines(input, remote));
  const pr = currentPullRequest();
  if (!pr) {
    // No pull request means gates 4 and 5 cannot be CHECKED here. They are
    // still perfectly well KNOWN here, and this is the last local moment before
    // CI — so the checklist goes out either way. Saying nothing is precisely
    // what made those two gates separate CI-cycle surprises (#2681).
    if (outcome.error) throw withGateSummary(outcome.error);
    console.log(
      `WORK_ITEM_TRACKING_OK ${outcome.result.relevant} commit(s); no pull request exists yet, so gates 4 and 5 could not be checked here — CI will verify both${gateSummary(outcome.result.contract)}`
    );
    return;
  }
  validatePrData(outcome, pr.url, pr.body);
  console.log(
    `WORK_ITEM_TRACKING_OK ${outcome.result.relevant} commit(s), ${provedHere(outcome.result.contract)}`
  );
}

function validatePr(args) {
  const base = option(args, "--base", "LISA_PR_BASE_SHA");
  const head = option(args, "--head", "LISA_PR_HEAD_SHA") || "HEAD";
  if (!base)
    throw new TrackingError("validate-pr requires --base or LISA_PR_BASE_SHA");
  const commits = git(["rev-list", `${base}..${head}`])
    .split("\n")
    .filter(Boolean);
  const outcome = commitOutcome(commits);
  const bodyFile = option(args, "--body-file", "LISA_PR_BODY_FILE");
  const prNumber = option(args, "--pr-number", "LISA_PR_NUMBER");
  const suppliedUrl =
    option(args, "--pr-url", "LISA_PR_URL") ??
    option(args, "--url", "LISA_PR_URL");
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
    `WORK_ITEM_TRACKING_OK ${outcome.result.relevant} commit(s), ${provedHere(outcome.result.contract)}`
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
  if (command === "prepare-commit-msg") return prepareCommitMessage(args);
  if (command === "validate-commit") return validateCommit(args);
  if (command === "validate-push") return validatePush(args);
  if (command === "validate-pr") return validatePr(args);
  throw new TrackingError(
    "Usage: lisa-work-item.mjs link|current|attach-branch|clear|verify-level|backlink|complete|sweep|prepare-commit-msg|validate-commit|validate-push|validate-pr" +
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
      `\n❌ Work-item tracking blocked this operation: ${detail}\n\n${GUIDANCE}\n`
    );
    process.exitCode = 1;
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
