/** Read the configured Linear or Jira issue before a readiness header exists. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AccessFailure, plainObject } from "./config-layers.mjs";
import { readTaskConfig } from "./surfaces.mjs";
import { taskBinding } from "./task-requirements.mjs";
import { candidate, failure } from "./task-readiness.mjs";

const issueKey = /^([A-Z][A-Z0-9]*)-[1-9]\d*$/u;
const pageSize = 100;
const maxPages = 100;
const maxReadBytes = 64 * 1024 * 1024;
const linearAdapter = fileURLToPath(
  new URL("../../lisa-linear-access/scripts/linear-graphql.sh", import.meta.url)
);
const linearFields = "id identifier team{key}";
const linearIssue = `query($id:String!){issue(id:$id){${linearFields} title description url priority estimate dueDate createdAt updatedAt completedAt state{name type} assignee{id name} creator{id name} project{id name url} parent{id identifier title} children(first:100){pageInfo{hasNextPage endCursor} nodes{id identifier title}} labels(first:100){pageInfo{hasNextPage endCursor} nodes{name}} attachments(first:100){pageInfo{hasNextPage endCursor} nodes{id title url}} relations(first:100){pageInfo{hasNextPage endCursor} nodes{type relatedIssue{id identifier title}}} inverseRelations(first:100){pageInfo{hasNextPage endCursor} nodes{type issue{id identifier title}}}}}`;
const linearComments = `query($id:String!,$after:String){issue(id:$id){${linearFields} comments(first:${pageSize},after:$after){pageInfo{hasNextPage endCursor} nodes{id body createdAt url parent{id} user{id name} botActor{__typename}}}}}`;
const nativeLinearTool =
  /^mcp__(linear-server|linear)__(list_teams|get_issue|list_comments)$/u;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

/** Admit the documented Linear owner's read-only fallback. Calling it proves no work access. */
export function linearIntakeRead(event, cfg) {
  const { tracker, linear } = cfg.effective ?? {};
  const tool = nativeLinearTool.exec(event.tool_name);
  const args = event.tool_input;
  if (
    tracker !== "linear" ||
    !linear?.workspace ||
    !linear?.teamKey ||
    !tool ||
    !plainObject(args) ||
    (event.mcp_server !== undefined && event.mcp_server?.name !== tool[1])
  )
    return false;
  const configuredIssue = value =>
    typeof value === "string" && issueKey.exec(value)?.[1] === linear.teamKey;
  if (tool[2] === "get_issue") {
    return (
      configuredIssue(args.id) &&
      Object.keys(args).every(key =>
        ["id", "includeRelations"].includes(key)
      ) &&
      (args.includeRelations === undefined ||
        typeof args.includeRelations === "boolean")
    );
  }
  if (
    (args.limit !== undefined &&
      (!Number.isInteger(args.limit) ||
        args.limit < 1 ||
        args.limit > pageSize)) ||
    (args.cursor !== undefined &&
      (typeof args.cursor !== "string" ||
        args.cursor.length === 0 ||
        args.cursor.length > 512)) ||
    (args.orderBy !== undefined &&
      !["createdAt", "updatedAt"].includes(args.orderBy))
  )
    return false;
  if (tool[2] === "list_teams") {
    return (
      args.query === linear.teamKey &&
      Object.keys(args).every(key =>
        ["query", "limit", "cursor", "orderBy"].includes(key)
      )
    );
  }
  // The native API can use the issue UUID returned by its configured team read.
  return (
    (configuredIssue(args.issueId) ||
      (typeof args.issueId === "string" && uuid.test(args.issueId))) &&
    Object.keys(args).every(key =>
      ["issueId", "limit", "cursor", "orderBy"].includes(key)
    )
  );
}

/** Parse only fixed read operations on an issue in the configured project. */
export function trackerIntakeRequest(args, cfg) {
  const [mode, refFlag, ref, readFlag, operation] = args;
  const c = cfg.effective;
  const tracker = c?.tracker;
  const project = tracker === "linear" ? c.linear?.teamKey : c?.jira?.project;
  if (
    args.length !== 5 ||
    mode !== "--tracker-intake-read" ||
    refFlag !== "--ref" ||
    readFlag !== "--read" ||
    !["linear", "jira"].includes(tracker) ||
    !["issue", "comments"].includes(operation) ||
    !project ||
    issueKey.exec(ref)?.[1] !== project
  )
    return null;
  return { ref, tracker, project, operation };
}

function transportFor(cfg) {
  const deadline = performance.now() + 120000;
  let remainingBytes = maxReadBytes;
  return (command, args, input, exitCodes = {}) => {
    const timeout = Math.floor(Math.min(25000, deadline - performance.now()));
    if (timeout <= 0 || remainingBytes <= 0)
      throw new AccessFailure("capability-unreachable");
    try {
      const raw = execFileSync(command, args, {
        cwd: cfg.projectRoot,
        input,
        encoding: "utf8",
        timeout,
        maxBuffer: Math.min(8 * 1024 * 1024, remainingBytes),
        stdio: ["pipe", "pipe", "pipe"],
      });
      remainingBytes -= Buffer.byteLength(raw);
      return raw;
    } catch (error) {
      throw new AccessFailure(
        error.code === "ENOENT"
          ? "tool-missing"
          : (exitCodes[error.status] ?? "capability-unreachable")
      );
    }
  };
}

function response(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AccessFailure("capability-unreachable");
  }
}

function readLinear(cfg, { ref, project, operation }) {
  const workspace = cfg.effective.linear.workspace;
  if (typeof workspace !== "string" || !/^[A-Za-z0-9-]+$/u.test(workspace))
    throw new AccessFailure("config-invalid");
  const transport = transportFor(cfg);
  const call = (query, after) => {
    const raw = transport(
      "bash",
      [
        linearAdapter,
        "--workspace",
        workspace,
        "--team-key",
        project,
        "--query-file",
        "-",
        "--variables",
        JSON.stringify({ id: ref, ...(after === undefined ? {} : { after }) }),
      ],
      query,
      { 3: "credential-missing", 4: "identity-mismatch" }
    );
    const issue = response(raw)?.data?.issue;
    if (issue?.identifier !== ref || issue.team?.key !== project)
      throw new AccessFailure("identity-mismatch");
    return issue;
  };
  if (operation === "issue") return call(linearIssue);
  const comments = [];
  const cursors = new Set();
  let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const result = call(linearComments, cursor).comments;
    if (
      !Array.isArray(result?.nodes) ||
      typeof result?.pageInfo?.hasNextPage !== "boolean"
    )
      break;
    comments.push(...result.nodes);
    if (!result.pageInfo.hasNextPage) return comments;
    cursor = result.pageInfo.endCursor;
    if (!cursor || typeof cursor !== "string" || cursors.has(cursor)) break;
    cursors.add(cursor);
  }
  throw new AccessFailure("capability-unreachable");
}

function readJira(cfg, request) {
  const { ref, project, operation } = request;
  const { cloudId, email, site } = cfg.effective.atlassian ?? {};
  if (
    typeof cloudId !== "string" ||
    !/^[A-Za-z0-9-]+$/u.test(cloudId) ||
    typeof email !== "string" ||
    !/^[^\s:@]+@[^\s:@]+$/u.test(email)
  ) {
    if (site) return readJiraWithAcli(cfg, request);
    throw new AccessFailure("config-invalid");
  }
  const key = `ATLASSIAN_API_TOKEN_${email.toLowerCase().replaceAll(/[.@]/gu, "_")}`;
  const env = process.env.ATLASSIAN_API_TOKEN?.trim()
    ? process.env
    : {
        ...process.env,
        ATLASSIAN_API_TOKEN: process.env[key],
      };
  const credential = jiraCredential(cfg, env);
  if (!credential.available) {
    if (!site) throw new AccessFailure(credential.code);
    return readJiraWithAcli(cfg, request);
  }
  const encoded = Buffer.from(`${email}:${credential.value}`).toString(
    "base64"
  );
  const base = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3`;
  const transport = transportFor(cfg);
  const get = endpoint => {
    const raw = transport(
      "curl",
      [
        "-q",
        "--silent",
        "--show-error",
        "--fail",
        "--max-time",
        "20",
        "--header",
        "@-",
        "--header",
        "Accept: application/json",
        `${base}${endpoint}`,
      ],
      `Authorization: Basic ${encoded}\n`
    );
    if (raw.includes(credential.value) || raw.includes(encoded))
      throw new AccessFailure("capability-unreachable");
    return response(raw);
  };
  if (get("/myself")?.emailAddress?.toLowerCase() !== email.toLowerCase())
    throw new AccessFailure("identity-mismatch");
  const endpoint = `/issue/${ref}`;
  const issue = get(`${endpoint}?fields=*all`);
  if (issue?.key !== ref || issue.fields?.project?.key !== project)
    throw new AccessFailure("identity-mismatch");
  if (operation === "issue") {
    const remoteLinks = get(`${endpoint}/remotelink`);
    if (!Array.isArray(remoteLinks))
      throw new AccessFailure("capability-unreachable");
    return { issue, remoteLinks };
  }
  const comments = [];
  let total;
  for (let page = 0; page < maxPages; page++) {
    const result = get(
      `${endpoint}/comment?startAt=${comments.length}&maxResults=${pageSize}&orderBy=created`
    );
    if (
      !Array.isArray(result?.comments) ||
      result.startAt !== comments.length ||
      !Number.isSafeInteger(result.total) ||
      result.total < 0 ||
      (total !== undefined && result.total !== total)
    )
      break;
    total = result.total;
    const size = comments.length;
    comments.push(...result.comments);
    if (comments.length === total) return comments;
    if (comments.length > total || comments.length === size) break;
  }
  throw new AccessFailure("capability-unreachable");
}

function jiraCredential(cfg, env) {
  try {
    return candidate(cfg, "ATLASSIAN_API_TOKEN", { env });
  } catch (error) {
    if (
      !(error instanceof AccessFailure) ||
      !["bootstrap-missing", "provider-unreachable"].includes(error.code)
    )
      throw error;
    return { available: false, code: error.code };
  }
}

function jiraSite(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function readJiraWithAcli(cfg, { ref, project, operation }) {
  const site = jiraSite(cfg.effective.atlassian.site);
  if (!site) throw new AccessFailure("config-invalid");
  const call = transportFor(cfg);
  const confirmSite = () => {
    const status = call("acli", ["jira", "auth", "status"], "");
    const sites = [...status.matchAll(/^\s*Site:\s+(\S+)\s*$/gmu)];
    if (sites.length !== 1 || jiraSite(sites[0][1]) !== site)
      throw new AccessFailure("identity-mismatch");
  };
  confirmSite();
  const issue = response(
    call(
      "acli",
      ["jira", "workitem", "view", ref, "--fields", "*all", "--json"],
      ""
    )
  );
  confirmSite();
  if (
    issue?.key !== ref ||
    issue.fields?.project?.key !== project ||
    jiraSite(issue.self) !== site
  )
    throw new AccessFailure("identity-mismatch");
  if (operation === "issue") return { issue, remoteLinks: null };
  const page = issue.fields.comment;
  if (
    page?.startAt !== 0 ||
    !Array.isArray(page.comments) ||
    page.total !== page.comments.length
  )
    throw new AccessFailure("capability-unreachable");
  return page.comments;
}

/** No results or partial comments are printed after a failed scoped read. */
export function runTrackerIntakeRead(args = process.argv.slice(2)) {
  let cfg, tracker;
  try {
    cfg = readTaskConfig();
    const request = trackerIntakeRequest(args, cfg);
    if (!request) throw new AccessFailure("requirements-stale");
    tracker = request.tracker;
    const binding = taskBinding(cfg.projectRoot);
    if (
      binding &&
      (binding.provider !== tracker ||
        issueKey.exec(binding.ref)?.[1] !== request.project)
    )
      throw new AccessFailure("requirements-stale");
    const data =
      tracker === "linear" ? readLinear(cfg, request) : readJira(cfg, request);
    console.log(JSON.stringify(data));
  } catch (error) {
    const diagnostic = failure(
      error instanceof AccessFailure ? error.code : "config-invalid",
      {
        cfg,
        name: tracker === "linear" ? "LINEAR_API_KEY" : "ATLASSIAN_API_TOKEN",
        owner:
          tracker === "linear" ? "lisa-linear-access" : "lisa-atlassian-access",
      }
    );
    console.error(`${diagnostic.code}: ${diagnostic.action}`);
    process.exitCode = 2;
  }
}
