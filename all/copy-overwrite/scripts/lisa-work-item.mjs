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
  return {
    active: [roles.claimed, roles.review, roles.blocked, ...done]
      .filter(value => typeof value === "string" && value !== terminal)
      .map(value => value.toLowerCase()),
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
      lifecycle: lifecycleContract(config, provider),
      repositoryIsIdentity:
        repository.toLowerCase() === `${org}/${githubRepo}`.toLowerCase(),
    };
  }
  if (provider === "jira") {
    return {
      provider,
      identityRepo,
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
  const branch = currentBranch() || rebaseBranch();
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
  const branch = currentBranch();
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

function parseTrailers(message) {
  const parsed = git(["interpret-trailers", "--parse"], { input: message });
  return parsed
    .split("\n")
    .filter(Boolean)
    .flatMap(line => {
      const value = workItemLineValue(line);
      return value === null ? [] : [value];
    });
}

function exactWorkItem(message, contract = trackerContract()) {
  const refs = parseTrailers(message);
  if (refs.length !== 1) {
    throw new TrackingError(
      `Expected exactly one Work-Item trailer; found ${refs.length}`
    );
  }
  return canonicalizeRef(refs[0], contract);
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

function assertClaimedLifecycle(ref, contract, currentRoles) {
  const roles = namesFrom(currentRoles);
  if (
    contract.lifecycle.terminal &&
    roles.includes(contract.lifecycle.terminal)
  ) {
    throw new TrackingError(
      `Work item ${ref} is in terminal lifecycle role ${contract.lifecycle.terminal}`
    );
  }
  if (!roles.some(role => contract.lifecycle.active.includes(role))) {
    throw new TrackingError(
      `Work item ${ref} is not claimed; require ${contract.lifecycle.claimed} or a later non-terminal lifecycle role`
    );
  }
}

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
  assertClaimedLifecycle(ref, contract, issue.labels);
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
        ["header", "Accept: application/json"],
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
    assertClaimedLifecycle(ref, contract, [issue.fields?.status?.name]);
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
      throw new TrackingError(
        "Jira acli validation requires atlassian.site so the active account can be identity-matched"
      );
    }
    const auth = run("acli", ["auth", "status"], { allowFailure: true });
    if (
      auth.status !== 0 ||
      !auth.stdout.toLowerCase().includes(contract.site.toLowerCase())
    ) {
      throw new TrackingError(
        `Jira acli is not authenticated to configured site ${contract.site}`
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
    assertClaimedLifecycle(ref, contract, [
      issue.fields?.status?.name ?? issue.status?.name,
    ]);
    assertLeaf(
      ref,
      issue.fields?.issuetype?.name ?? issue.issueType?.name,
      (issue.fields?.subtasks ?? issue.subtasks ?? []).map(child =>
        jiraStatusCategory(child) === "done" ? "done" : "open"
      )
    );
    return issue;
  }
  throw new TrackingError(
    "Jira validation requires identity-matched acli or ATLASSIAN_API_TOKEN/JIRA_API_TOKEN with JIRA_LOGIN and atlassian.cloudId/site"
  );
}

function readLinearKey(workspace) {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  const suffix = workspace.toLowerCase().replace(/-/g, "_");
  if (process.env[`LINEAR_API_KEY_${suffix}`])
    return process.env[`LINEAR_API_KEY_${suffix}`];
  if (process.platform === "darwin") {
    return (
      run(
        "security",
        ["find-generic-password", "-s", "lisa-linear", "-a", workspace, "-w"],
        { allowFailure: true }
      ).stdout.trim() || undefined
    );
  }
  return undefined;
}

function linearIssue(ref, contract) {
  const token = readLinearKey(contract.workspace);
  if (!token)
    throw new TrackingError(
      "Linear validation requires LINEAR_API_KEY or a lisa-linear keychain entry"
    );
  const query =
    "query($id:String!){issue(id:$id){id identifier team{key} state{name type} labels{nodes{name}} children{nodes{state{type}}} attachments{nodes{url}} comments{nodes{body}}}}";
  const payload = JSON.stringify({ query, variables: { id: ref } });
  const result = secureCurl(
    ["https://api.linear.app/graphql"],
    [
      ["request", "POST"],
      ["header", "Content-Type: application/json"],
      ["header", `Authorization: ${token}`],
      ["data-binary", payload],
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
  // Lifecycle comes from the workflow STATE, the same shape the Jira path uses
  // (`[issue.fields?.status?.name]`). Repo scope stays on labels above, because
  // repo scoping genuinely IS a label.
  assertClaimedLifecycle(ref, contract, [issue.state?.name]);
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
 * Punctuation that can hug a URL in prose or markdown, stripped before compare.
 *
 * A URL is recognised as a whitespace-delimited token, so anything a writer
 * wraps around it — `<url>`, a trailing full stop, a closing bracket — would
 * otherwise make an exact comparison fail against a backlink that is perfectly
 * valid. Being too strict here fails closed and merely annoys; being too loose
 * is the defect below.
 */
const URL_EDGES = /^[<([]+|[>)\].,;:]+$/g;

/**
 * The URLs a comment offers as backlinks, as discrete tokens.
 * @param {string} text Comment body.
 * @returns {string[]} Whitespace-delimited tokens, trimmed of edge punctuation.
 */
function backlinkTokens(text) {
  return text.split(/\s+/).map(token => token.replace(URL_EDGES, ""));
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
        ["header", "Accept: application/json"],
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

function validateMessage(message, options = {}) {
  if (options.allowInProgressMerge && isMergeInProgress())
    return { exempt: "merge" };
  if (RELEASE_SUBJECT.test(messageSubject(message)))
    return { exempt: "release" };
  const contract = trackerContract();
  const ref = exactWorkItem(message, contract);
  assertStateMatches(ref, contract);
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

function prWorkItem(body, contract) {
  const matches = String(body ?? "")
    .split(/\r?\n/)
    .flatMap(line => {
      const value = workItemLineValue(line);
      return value === null ? [] : [value];
    });
  if (matches.length !== 1)
    throw new TrackingError(
      `Pull request must contain exactly one Work-Item line; found ${matches.length}`
    );
  return canonicalizeRef(matches[0], contract);
}

function validatePrData(result, prUrl, prBody) {
  if (result.relevant === 0) {
    if (result.releaseExempt > 0 && result.mergeExempt === 0) return;
    throw new TrackingError(
      "Pull request has no non-merge commit linked to a work item"
    );
  }
  if (!result.ref)
    throw new TrackingError(
      "Pull request commits are not linked to a work item"
    );
  const bodyRef = prWorkItem(prBody, result.contract);
  if (bodyRef !== result.ref)
    throw new TrackingError(
      `Pull request Work-Item ${bodyRef} does not match commit Work-Item ${result.ref}`
    );
  assertBacklink(result.ref, prUrl, result.contract, result.issue);
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
  const result = validateMessage(readFileSync(file, "utf8"), {
    allowInProgressMerge: true,
  });
  console.log(`WORK_ITEM_TRACKING_OK ${result.exempt ?? result.ref}`);
}

function validatePush(args) {
  const remote = args[0] || "origin";
  const input = readFileSync(0, "utf8");
  const result = validateCommits(parsePushLines(input, remote));
  const pr = currentPullRequest();
  if (!pr) {
    console.log(
      `WORK_ITEM_TRACKING_OK ${result.relevant} commit(s); no pull request exists yet, CI will verify PR linkage`
    );
    return;
  }
  validatePrData(result, pr.url, pr.body);
  console.log(
    `WORK_ITEM_TRACKING_OK ${result.relevant} commit(s), PR body, and tracker backlink`
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
  const result = validateCommits(commits);
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
  if (!pr?.url) {
    throw new TrackingError(
      "validate-pr requires --pr-number, or --pr-url/--url with --body-file, and an accessible GitHub PR"
    );
  }
  validatePrData(result, pr.url, pr.body);
  console.log(
    `WORK_ITEM_TRACKING_OK ${result.relevant} commit(s), PR body, and tracker backlink`
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
      `work-item binding attached to ${currentBranch()} (${file})`
    );
  }
  if (command === "clear") {
    rmSync(statePath(), { force: true });
    return console.log("work-item binding cleared");
  }
  if (command === "prepare-commit-msg") return prepareCommitMessage(args);
  if (command === "validate-commit") return validateCommit(args);
  if (command === "validate-push") return validatePush(args);
  if (command === "validate-pr") return validatePr(args);
  throw new TrackingError(
    "Usage: lisa-work-item.mjs link|current|attach-branch|clear|prepare-commit-msg|validate-commit|validate-push|validate-pr" +
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
