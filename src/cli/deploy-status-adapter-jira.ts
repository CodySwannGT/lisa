/**
 * Jira tracker adapter for deploy-status-sync over the Jira Cloud REST API.
 *
 * Contract-tested only in DSS-2 (unit tests inject a recording fetch); DSS-7
 * flips it live through the same factory. Writes go through the cloudId
 * gateway (`api.atlassian.com/ex/jira/<cloudId>`); transitions resolve the
 * transition id first, then POST it. Credentials travel only in the Basic
 * `Authorization` header — never in argv. Native closure is a no-op: in Jira
 * the terminal done-category status IS closure.
 * @module cli/deploy-status-adapter-jira
 */
import {
  DEPLOY_STATUS_SYNC_MARKER,
  type TrackerItemState,
} from "../core/deploy-status-transition.js";
import type {
  CommentUpsertResult,
  TrackerAdapter,
  TrackerAdapterDeps,
} from "./deploy-status-adapter.js";
import { getProcessEnv } from "./update-check.js";

/** Construction options for {@link createJiraAdapter}. */
export interface JiraAdapterOptions {
  /** Atlassian cloud id (gateway base URL for writes) */
  readonly cloudId?: string;
  /** Site host fallback when no cloudId is configured */
  readonly site?: string;
  /** Login fallback when `JIRA_LOGIN` is unset */
  readonly email?: string;
}

/** Authenticated REST transport bound to the resolved credentials. */
type JiraRequest = (
  path: string,
  init?: { readonly method?: string; readonly body?: string }
) => Promise<unknown>;

/** Jira ADF document: one paragraph node per comment line. */
interface AdfDoc {
  readonly type: "doc";
  readonly version: 1;
  readonly content: readonly {
    readonly type: "paragraph";
    readonly content: readonly {
      readonly type: "text";
      readonly text: string;
    }[];
  }[];
}

/**
 * Build the ADF document for a managed comment body: one paragraph node per
 * line — ADF text nodes must not carry raw newline characters (Jira rejects
 * or mangles them), so the body is split on `\n` and a blank line becomes an
 * empty paragraph.
 * @param text - Plain comment text (may span multiple lines)
 * @returns ADF document
 */
function adfDocument(text: string): AdfDoc {
  return {
    type: "doc",
    version: 1,
    content: text.split("\n").map(line => ({
      type: "paragraph" as const,
      content: line.length === 0 ? [] : [{ type: "text" as const, text: line }],
    })),
  };
}

/**
 * Extract the first text node from an ADF comment body.
 * @param body - ADF body value
 * @returns The first text run, or empty string
 */
function adfFirstText(body: unknown): string {
  const doc = body as {
    content?: readonly { content?: readonly { text?: unknown }[] }[];
  };
  const text = doc.content?.[0]?.content?.[0]?.text;
  return typeof text === "string" ? text : "";
}

/**
 * Whether a Jira status payload sits in the done category.
 * @param status - Jira status field value
 * @returns True for done-category statuses
 */
function isDoneCategory(status: unknown): boolean {
  const key = (status as { statusCategory?: { key?: unknown } }).statusCategory
    ?.key;
  return key === "done";
}

/** The only host shape the site fallback may target. */
const SITE_HOST_PATTERN = /^[a-z0-9-]+\.atlassian\.net$/i;

/**
 * Resolve the REST base URL: the cloudId gateway when configured, else the
 * `atlassian.site` fallback — which must be a bare `*.atlassian.net` host.
 * Anything else (paths, foreign hosts) is rejected decision-readably before
 * any request is made, so a poisoned config value cannot steer credentialed
 * requests to an attacker-chosen server.
 * @param options - Cloud id / site fallback
 * @returns Base URL, or undefined when neither source is configured
 */
function resolveBaseUrl(options: JiraAdapterOptions): string | undefined {
  if (options.cloudId !== undefined) {
    return `https://api.atlassian.com/ex/jira/${encodeURIComponent(options.cloudId)}`;
  }
  const site = (options.site ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (site.length === 0) return undefined;
  if (!SITE_HOST_PATTERN.test(site)) {
    throw new Error(
      `Invalid atlassian.site "${options.site ?? ""}" in .lisa.config.json: expected a bare "<site>.atlassian.net" host. Set atlassian.cloudId (preferred) or fix atlassian.site.`
    );
  }
  return `https://${site}`;
}

/**
 * Build the authenticated REST transport (Basic auth header only — the
 * token never reaches argv or the URL).
 * @param options - Cloud id / site / login fallback
 * @param deps - Injectable fetch and env
 * @returns Bound transport
 */
function createRequest(
  options: JiraAdapterOptions,
  deps: TrackerAdapterDeps
): JiraRequest {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (path, init = {}) => {
    const env = deps.env ?? getProcessEnv();
    const token = env.JIRA_API_TOKEN ?? env.ATLASSIAN_API_TOKEN;
    const login = env.JIRA_LOGIN ?? options.email;
    const baseUrl = resolveBaseUrl(options);
    if (token === undefined || login === undefined || baseUrl === undefined) {
      throw new Error(
        "Jira credentials not found: set JIRA_API_TOKEN or ATLASSIAN_API_TOKEN (plus JIRA_LOGIN or atlassian.email) and configure atlassian.cloudId"
      );
    }
    const basic = Buffer.from(`${login}:${token}`).toString("base64");
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
        ...(init.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    if (!response.ok) {
      throw new Error(
        `Jira request ${init.method ?? "GET"} ${path} failed with HTTP ${String(response.status)}`
      );
    }
    const text = await response.text();
    return text.length > 0 ? (JSON.parse(text) as unknown) : {};
  };
}

/**
 * Fetch the vendor-neutral state snapshot for one issue.
 * @param request - Bound transport
 * @param ref - Issue key
 * @returns Item state
 */
async function fetchState(
  request: JiraRequest,
  ref: string
): Promise<TrackerItemState> {
  const issue = (await request(
    `/rest/api/3/issue/${ref}?fields=status,issuetype,subtasks`
  )) as {
    fields?: {
      status?: { name?: string; statusCategory?: { key?: string } };
      issuetype?: { name?: string };
      subtasks?: readonly { fields?: { status?: unknown } }[];
    };
  };
  const status = issue.fields?.status;
  const type = issue.fields?.issuetype?.name;
  const openChildren = (issue.fields?.subtasks ?? []).filter(
    subtask => !isDoneCategory(subtask.fields?.status)
  ).length;
  return {
    ref,
    ...(type === undefined ? {} : { type }),
    openChildren,
    ...(status?.name === undefined ? {} : { currentStatus: status.name }),
    closed: isDoneCategory(status),
  };
}

/**
 * Resolve the transition id reaching the done status, then POST it.
 * @param request - Bound transport
 * @param ref - Issue key
 * @param doneStatus - Target status name (config-sourced)
 */
async function transition(
  request: JiraRequest,
  ref: string,
  doneStatus: string
): Promise<void> {
  const payload = (await request(`/rest/api/3/issue/${ref}/transitions`)) as {
    transitions?: readonly { id?: string; to?: { name?: string } }[];
  };
  const match = (payload.transitions ?? []).find(
    candidate =>
      (candidate.to?.name ?? "").toLowerCase() === doneStatus.toLowerCase()
  );
  if (match?.id === undefined) {
    throw new Error(
      `Jira issue ${ref} has no transition reaching "${doneStatus}" — fix the workflow or jira.workflow.done`
    );
  }
  await request(`/rest/api/3/issue/${ref}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: match.id } }),
  });
}

/**
 * Find-or-update the single marker-managed ADF comment on the issue.
 * @param request - Bound transport
 * @param ref - Issue key
 * @param body - Deterministic plain-text comment body
 * @returns Upsert outcome
 */
async function upsertComment(
  request: JiraRequest,
  ref: string,
  body: string
): Promise<CommentUpsertResult> {
  // Bounded page, newest first: the marker comment is recent by
  // construction. Live multi-page walking is DSS-7 acceptance scope.
  const payload = (await request(
    `/rest/api/3/issue/${ref}/comment?maxResults=100&orderBy=-created`
  )) as {
    comments?: readonly { id?: string; body?: unknown }[];
  };
  const existing = (payload.comments ?? []).find(comment =>
    adfFirstText(comment.body).startsWith(DEPLOY_STATUS_SYNC_MARKER)
  );
  const doc = adfDocument(body);
  if (existing === undefined) {
    await request(`/rest/api/3/issue/${ref}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: doc }),
    });
    return "created";
  }
  if (JSON.stringify(existing.body) === JSON.stringify(doc)) {
    return "unchanged";
  }
  await request(`/rest/api/3/issue/${ref}/comment/${existing.id ?? ""}`, {
    method: "PUT",
    body: JSON.stringify({ body: doc }),
  });
  return "updated";
}

/**
 * Create the Jira adapter.
 * @param options - Cloud id / site / login fallback
 * @param deps - Injectable fetch and env
 * @returns Tracker adapter over the Jira REST API
 */
export function createJiraAdapter(
  options: JiraAdapterOptions,
  deps: TrackerAdapterDeps = {}
): TrackerAdapter {
  const request = createRequest(options, deps);
  return {
    fetchItemState: ref => fetchState(request, ref),
    transitionToDone: (ref, doneStatus) => transition(request, ref, doneStatus),
    upsertManagedComment: (ref, body) => upsertComment(request, ref, body),
    // Jira has no separate close: the terminal done-category status IS the
    // native closure, so this is deliberately a zero-request no-op.
    closeNatively: () => Promise.resolve(),
  };
}
