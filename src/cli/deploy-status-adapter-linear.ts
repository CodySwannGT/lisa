/**
 * Linear tracker adapter for deploy-status-sync over the Linear GraphQL API.
 *
 * Contract-tested only in DSS-2 (unit tests inject a recording fetch); DSS-6
 * flips it live by supplying real deps through the same factory. The API key
 * travels only in the raw `Authorization` header (Linear expects no Bearer
 * prefix) — never in argv.
 * @module cli/deploy-status-adapter-linear
 */
import { runKaneCommand } from "../core/kane-cli-process.js";
import { DEPLOY_STATUS_SYNC_MARKER } from "../core/deploy-status-transition.js";
import type { TrackerItemState } from "../core/deploy-status-transition.js";
import type {
  CommentUpsertResult,
  TrackerAdapter,
  TrackerAdapterDeps,
} from "./deploy-status-adapter.js";
import { getProcessEnv } from "./update-check.js";

/** Construction options for {@link createLinearAdapter}. */
export interface LinearAdapterOptions {
  /** Linear workspace slug (credential scoping + keychain account) */
  readonly workspace: string;
  /** Ladder done vocabulary, lowest rung first (config-sourced) */
  readonly doneStatuses: readonly string[];
}

const GRAPHQL_URL = "https://api.linear.app/graphql";
const TERMINAL_STATE_TYPES = new Set(["completed", "canceled", "cancelled"]);

const ISSUE_STATE_QUERY =
  "query($id:String!){issue(id:$id){id identifier state{name type} labels{nodes{name}} children{nodes{state{type}}}}}";
const ISSUE_ID_QUERY = "query($id:String!){issue(id:$id){id}}";
const LABEL_ID_QUERY =
  "query($name:String!){issueLabels(filter:{name:{eq:$name}}){nodes{id name}}}";
const ADD_LABEL_MUTATION =
  "mutation($issueId:String!,$labelId:String!){issueAddLabel(id:$issueId,labelId:$labelId){success}}";
const COMMENTS_QUERY =
  "query($id:String!){issue(id:$id){id comments{nodes{id body}}}}";
const COMMENT_CREATE_MUTATION =
  "mutation($issueId:String!,$body:String!){commentCreate(input:{issueId:$issueId,body:$body}){success}}";
const COMMENT_UPDATE_MUTATION =
  "mutation($commentId:String!,$body:String!){commentUpdate(id:$commentId,input:{body:$body}){success}}";
const TEAM_STATES_QUERY =
  "query($id:String!){issue(id:$id){id team{states{nodes{id name type}}}}}";
const ISSUE_UPDATE_STATE_MUTATION =
  "mutation($issueId:String!,$stateId:String!){issueUpdate(id:$issueId,input:{stateId:$stateId}){success}}";

/** GraphQL transport bound to the resolved credentials. */
type Graphql = (
  query: string,
  variables: Record<string, string>
) => Promise<Record<string, unknown>>;

/** Bound collaborators shared by the adapter methods. */
interface LinearContext {
  readonly doneStatuses: readonly string[];
  readonly graphql: Graphql;
}

/**
 * Read the darwin keychain entry for a Linear workspace.
 * @param service - Keychain service name
 * @param account - Keychain account (workspace)
 * @returns Stored secret, or undefined when absent
 */
async function readKeychainSecret(
  service: string,
  account: string
): Promise<string | undefined> {
  if (process.platform !== "darwin") return undefined;
  const result = await runKaneCommand(
    "security",
    ["find-generic-password", "-s", service, "-a", account, "-w"],
    { cwd: ".", timeoutMs: 15_000, env: getProcessEnv() }
  );
  const secret = result.stdout.trim();
  return result.exitCode === 0 && secret.length > 0 ? secret : undefined;
}

/**
 * Resolve the Linear API key: `LINEAR_API_KEY`, the workspace-suffixed
 * variable, then the darwin `lisa-linear` keychain entry.
 * @param workspace - Workspace slug
 * @param deps - Injectable env and secret reader
 * @returns The API key
 */
async function resolveLinearKey(
  workspace: string,
  deps: TrackerAdapterDeps
): Promise<string> {
  const env = deps.env ?? getProcessEnv();
  const direct = env.LINEAR_API_KEY;
  if (direct !== undefined && direct.length > 0) return direct;
  const suffix = workspace.toLowerCase().replace(/-/g, "_");
  const scoped = env[`LINEAR_API_KEY_${suffix}`];
  if (scoped !== undefined && scoped.length > 0) return scoped;
  const readSecret = deps.readSecret ?? readKeychainSecret;
  const keychain = await readSecret("lisa-linear", workspace);
  if (keychain !== undefined && keychain.length > 0) return keychain;
  throw new Error(
    `Linear credentials not found: set LINEAR_API_KEY (or LINEAR_API_KEY_${suffix}, or a darwin "lisa-linear" keychain entry for ${workspace})`
  );
}

/**
 * Build the GraphQL transport (key resolved per request, header-only).
 * @param workspace - Workspace slug for credential resolution
 * @param deps - Injectable fetch, env, and secret reader
 * @returns Bound GraphQL transport
 */
function createGraphql(workspace: string, deps: TrackerAdapterDeps): Graphql {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (query, variables) => {
    const key = await resolveLinearKey(workspace, deps);
    const response = await fetchImpl(GRAPHQL_URL, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const payload = (await response.json()) as {
      data?: Record<string, unknown>;
      errors?: readonly { message?: string }[];
    };
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      throw new Error(
        `Linear GraphQL request failed: ${payload.errors[0]?.message ?? "unknown error"}`
      );
    }
    return payload.data ?? {};
  };
}

/**
 * Resolve the internal issue id for a canonical identifier.
 * @param context - Bound collaborators
 * @param ref - Canonical identifier (KEY-N)
 * @returns Internal issue id
 */
async function issueId(context: LinearContext, ref: string): Promise<string> {
  const data = await context.graphql(ISSUE_ID_QUERY, { id: ref });
  const id = (data.issue as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") {
    throw new Error(`Linear issue ${ref} does not exist or is inaccessible`);
  }
  return id;
}

/**
 * Fetch the vendor-neutral state snapshot for one issue.
 * @param context - Bound collaborators
 * @param ref - Canonical identifier
 * @returns Item state
 */
async function fetchState(
  context: LinearContext,
  ref: string
): Promise<TrackerItemState> {
  const data = await context.graphql(ISSUE_STATE_QUERY, { id: ref });
  const issue = data.issue as
    | {
        state?: { type?: string };
        labels?: { nodes?: readonly { name?: string }[] };
        children?: { nodes?: readonly { state?: { type?: string } }[] };
      }
    | undefined;
  if (issue === undefined) {
    throw new Error(`Linear issue ${ref} does not exist or is inaccessible`);
  }
  const labels = (issue.labels?.nodes ?? []).flatMap(node =>
    typeof node.name === "string" ? [node.name] : []
  );
  const type = labels.find(name => name.toLowerCase().startsWith("type:"));
  const currentStatus = [...context.doneStatuses]
    .reverse()
    .find(status => labels.includes(status));
  const openChildren = (issue.children?.nodes ?? []).filter(
    node => !TERMINAL_STATE_TYPES.has(node.state?.type ?? "")
  ).length;
  return {
    ref,
    ...(type === undefined ? {} : { type }),
    openChildren,
    ...(currentStatus === undefined ? {} : { currentStatus }),
    closed: TERMINAL_STATE_TYPES.has(issue.state?.type ?? ""),
  };
}

/**
 * Add the done label to the issue (labels binding).
 * @param context - Bound collaborators
 * @param ref - Canonical identifier
 * @param doneStatus - Target done label name
 */
async function transition(
  context: LinearContext,
  ref: string,
  doneStatus: string
): Promise<void> {
  const id = await issueId(context, ref);
  const labelData = await context.graphql(LABEL_ID_QUERY, {
    name: doneStatus,
  });
  const nodes = (
    labelData.issueLabels as { nodes?: readonly { id?: unknown }[] } | undefined
  )?.nodes;
  const labelId = Array.isArray(nodes) ? nodes[0]?.id : undefined;
  if (typeof labelId !== "string") {
    throw new Error(
      `Linear label "${doneStatus}" was not found in the workspace — create it or fix linear.labels.build.done`
    );
  }
  await context.graphql(ADD_LABEL_MUTATION, { issueId: id, labelId });
}

/**
 * Find-or-update the single marker-managed comment on the issue.
 * @param context - Bound collaborators
 * @param ref - Canonical identifier
 * @param body - Deterministic comment body
 * @returns Upsert outcome
 */
async function upsertComment(
  context: LinearContext,
  ref: string,
  body: string
): Promise<CommentUpsertResult> {
  const data = await context.graphql(COMMENTS_QUERY, { id: ref });
  const issue = data.issue as
    | {
        id?: string;
        comments?: { nodes?: readonly { id?: string; body?: string }[] };
      }
    | undefined;
  const existing = (issue?.comments?.nodes ?? []).find(node =>
    (node.body ?? "").startsWith(DEPLOY_STATUS_SYNC_MARKER)
  );
  if (existing === undefined) {
    await context.graphql(COMMENT_CREATE_MUTATION, {
      issueId: issue?.id ?? "",
      body,
    });
    return "created";
  }
  if (existing.body === body) return "unchanged";
  await context.graphql(COMMENT_UPDATE_MUTATION, {
    commentId: existing.id ?? "",
    body,
  });
  return "updated";
}

/**
 * Close the issue by moving it to the team's completed workflow state.
 * @param context - Bound collaborators
 * @param ref - Canonical identifier
 */
async function closeIssue(context: LinearContext, ref: string): Promise<void> {
  const data = await context.graphql(TEAM_STATES_QUERY, { id: ref });
  const issue = data.issue as
    | {
        id?: string;
        team?: {
          states?: { nodes?: readonly { id?: string; type?: string }[] };
        };
      }
    | undefined;
  const completed = (issue?.team?.states?.nodes ?? []).find(
    node => node.type === "completed"
  );
  if (completed?.id === undefined) {
    throw new Error(
      `Linear team for ${ref} exposes no completed workflow state; cannot close natively`
    );
  }
  await context.graphql(ISSUE_UPDATE_STATE_MUTATION, {
    issueId: issue?.id ?? "",
    stateId: completed.id,
  });
}

/**
 * Create the Linear adapter.
 * @param options - Workspace and done vocabulary
 * @param deps - Injectable fetch, env, and secret reader
 * @returns Tracker adapter over the Linear GraphQL API
 */
export function createLinearAdapter(
  options: LinearAdapterOptions,
  deps: TrackerAdapterDeps = {}
): TrackerAdapter {
  const context: LinearContext = {
    doneStatuses: options.doneStatuses,
    graphql: createGraphql(options.workspace, deps),
  };
  return {
    fetchItemState: ref => fetchState(context, ref),
    transitionToDone: (ref, doneStatus) => transition(context, ref, doneStatus),
    upsertManagedComment: (ref, body) => upsertComment(context, ref, body),
    closeNatively: ref => closeIssue(context, ref),
  };
}
