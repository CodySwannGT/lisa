#!/usr/bin/env node
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

const RELEASE_SUBJECT =
  /^chore\(release\): \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? \[skip ci\]$/;
const ZERO_OID = /^0+$/;
const MARKER = "[lisa-pr-link]";
const GUIDANCE = [
  "Mention the ticket this work relates to, or ask Lisa to create one:",
  "  Work-Item: <configured-project-ticket>",
].join("\n");

class TrackingError extends Error {}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new TrackingError(
      options.error ?? `${command} ${args.join(" ")} failed`
    );
  }
  return result;
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
  return run("curl", ["-fsS", "--config", "-", ...args], {
    ...options,
    input,
  });
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
  const configured =
    provider === "jira"
      ? config.jira?.workflow
      : provider === "github"
        ? config.github?.labels?.build
        : config.linear?.labels?.build;
  const defaults =
    provider === "jira"
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
          ...(provider === "linear" ? { review: "status:code-review" } : {}),
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
      const match = /^Work-Item:\s*(.+?)\s*$/i.exec(line);
      return match ? [match[1]] : [];
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

function githubHierarchy(ref, contract, number) {
  const [owner, repo] = contract.repository.split("/");
  const query =
    "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){subIssues(first:100){nodes{state}}}}}";
  const result = run(
    "gh",
    [
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
    ],
    { allowFailure: true }
  );
  if (result.status !== 0)
    throw new TrackingError(`GitHub issue ${ref} hierarchy is inaccessible`);
  const response = safeJson(result.stdout, `GitHub issue ${ref} hierarchy`);
  const issue = response.data?.repository?.issue;
  if (!issue || !Array.isArray(issue.subIssues?.nodes)) {
    throw new TrackingError(
      `GitHub issue ${ref} did not expose native sub-issue hierarchy`
    );
  }
  return issue.subIssues.nodes.map(child => child.state);
}

function githubIssue(ref, contract) {
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
  if (result.status !== 0)
    throw new TrackingError(
      `GitHub issue ${ref} does not exist or is inaccessible`
    );
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
    "query($id:String!){issue(id:$id){id identifier team{key} state{type} labels{nodes{name}} children{nodes{state{type}}} attachments{nodes{url}} comments{nodes{body}}}}";
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
  assertClaimedLifecycle(ref, contract, issue.labels?.nodes);
  assertLeaf(
    ref,
    typeFromLabels(issue.labels?.nodes),
    (issue.children?.nodes ?? []).map(child => child.state?.type)
  );
  return issue;
}

function validateLive(ref, contract = trackerContract()) {
  if (contract.provider === "github") return githubIssue(ref, contract);
  if (contract.provider === "jira") return jiraIssue(ref, contract);
  return linearIssue(ref, contract);
}

function textContainsBacklink(value, prUrl) {
  if (typeof value === "string")
    return value.includes(MARKER) && value.includes(prUrl);
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
      const match = /^Work-Item:\s*(.+?)\s*$/i.exec(line);
      return match ? [match[1]] : [];
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

function option(args, name, envName) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : process.env[envName];
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
  if (command === "bind") return bind(args);
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
    "Usage: lisa-work-item.mjs bind|current|attach-branch|clear|prepare-commit-msg|validate-commit|validate-push|validate-pr"
  );
}

try {
  main();
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    `\n❌ Work-item tracking blocked this operation: ${detail}\n\n${GUIDANCE}\n`
  );
  process.exitCode = 1;
}
