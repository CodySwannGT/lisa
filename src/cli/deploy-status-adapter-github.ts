/**
 * GitHub tracker adapter for deploy-status-sync: label transitions, one
 * marker-managed comment, and native closure — all via `gh` with fixed argv
 * (ambient `gh` / `GITHUB_TOKEN` auth; credentials never in argv).
 * @module cli/deploy-status-adapter-github
 */
import {
  DEPLOY_STATUS_SYNC_MARKER,
  type TrackerItemState,
} from "../core/deploy-status-transition.js";
import {
  deriveLabelState,
  type CommentUpsertResult,
  type ExecGh,
  type TrackerAdapter,
} from "./deploy-status-adapter.js";

/** Construction options for {@link createGithubAdapter}. */
export interface GithubAdapterOptions {
  /** `owner/repo` the canonical refs belong to */
  readonly repository: string;
  /** Ladder done vocabulary, lowest rung first (config-sourced) */
  readonly doneStatuses: readonly string[];
}

/** Injectable collaborators for {@link createGithubAdapter}. */
export interface GithubAdapterDeps {
  readonly execGh: ExecGh;
}

/** Bound collaborators shared by the adapter methods. */
interface GithubContext extends GithubAdapterOptions {
  readonly execGh: ExecGh;
}

const HIERARCHY_QUERY =
  "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){subIssues(first:100){nodes{state}}}}}";

/**
 * Extract the issue number from a canonical `owner/repo#N` ref.
 * @param ref - Canonical ref
 * @returns Issue number as a string
 */
function issueNumber(ref: string): string {
  return ref.slice(ref.lastIndexOf("#") + 1);
}

/**
 * Parse label names from a gh issue-view payload.
 * @param value - Parsed issue JSON
 * @returns Label names
 */
function labelNames(value: unknown): readonly string[] {
  const labels = (value as { labels?: readonly { name?: unknown }[] }).labels;
  if (!Array.isArray(labels)) return [];
  return labels.flatMap(label =>
    typeof label.name === "string" ? [label.name] : []
  );
}

/**
 * Count open sub-issues from the hierarchy GraphQL payload.
 * @param value - Parsed GraphQL response
 * @returns Number of open children
 */
function openChildrenOf(value: unknown): number {
  const nodes = (
    value as {
      data?: {
        repository?: {
          issue?: { subIssues?: { nodes?: readonly { state?: unknown }[] } };
        };
      };
    }
  ).data?.repository?.issue?.subIssues?.nodes;
  if (!Array.isArray(nodes)) return 0;
  return nodes.filter(node => node.state === "OPEN").length;
}

/**
 * Fetch the vendor-neutral state snapshot for one issue.
 * @param context - Bound adapter collaborators
 * @param ref - Canonical ref
 * @returns Item state
 */
async function fetchState(
  context: GithubContext,
  ref: string
): Promise<TrackerItemState> {
  const number = issueNumber(ref);
  const issueRaw = await context.execGh([
    "issue",
    "view",
    number,
    "--repo",
    context.repository,
    "--json",
    "number,state,labels",
  ]);
  const issue = JSON.parse(issueRaw) as { state?: unknown };
  const [owner, repo] = context.repository.split("/");
  // -f passes owner/repo as raw strings; -F stays only for the integer
  // number variable — typed -F parsing of attacker-influencable strings
  // could coerce them into unintended JSON values.
  const hierarchyRaw = await context.execGh([
    "api",
    "graphql",
    "-f",
    `query=${HIERARCHY_QUERY}`,
    "-f",
    `owner=${owner ?? ""}`,
    "-f",
    `repo=${repo ?? ""}`,
    "-F",
    `number=${number}`,
  ]);
  return {
    ref,
    ...deriveLabelState(labelNames(issue), context.doneStatuses),
    openChildren: openChildrenOf(JSON.parse(hierarchyRaw)),
    closed: issue.state === "CLOSED",
  };
}

/**
 * Move the issue to the target done label, removing the other done labels.
 * @param context - Bound adapter collaborators
 * @param ref - Canonical ref
 * @param doneStatus - Target done label
 */
async function transition(
  context: GithubContext,
  ref: string,
  doneStatus: string
): Promise<void> {
  const removals = context.doneStatuses
    .filter(status => status !== doneStatus)
    .flatMap(status => ["--remove-label", status]);
  await context.execGh([
    "issue",
    "edit",
    issueNumber(ref),
    "--repo",
    context.repository,
    "--add-label",
    doneStatus,
    ...removals,
  ]);
}

/**
 * Find-or-update the single marker-managed comment on the issue.
 * @param context - Bound adapter collaborators
 * @param ref - Canonical ref
 * @param body - Deterministic comment body
 * @returns Upsert outcome
 */
async function upsertComment(
  context: GithubContext,
  ref: string,
  body: string
): Promise<CommentUpsertResult> {
  const number = issueNumber(ref);
  // --slurp wraps each page in one top-level array; without it, multi-page
  // output is concatenated JSON documents that JSON.parse cannot read and a
  // marker comment past page 1 would be re-created instead of updated.
  const listRaw = await context.execGh([
    "api",
    `repos/${context.repository}/issues/${number}/comments`,
    "--paginate",
    "--slurp",
  ]);
  const comments = (
    JSON.parse(listRaw) as readonly (readonly {
      id?: unknown;
      body?: unknown;
    }[])[]
  ).flat();
  const existing = comments.find(
    comment =>
      typeof comment.body === "string" &&
      comment.body.startsWith(DEPLOY_STATUS_SYNC_MARKER)
  );
  if (existing === undefined) {
    await context.execGh([
      "api",
      `repos/${context.repository}/issues/${number}/comments`,
      "-f",
      `body=${body}`,
    ]);
    return "created";
  }
  if (existing.body === body) return "unchanged";
  await context.execGh([
    "api",
    `repos/${context.repository}/issues/comments/${String(existing.id)}`,
    "-X",
    "PATCH",
    "-f",
    `body=${body}`,
  ]);
  return "updated";
}

/**
 * Create the GitHub adapter.
 * @param options - Repository and done vocabulary
 * @param deps - gh executor
 * @returns Tracker adapter over gh
 */
export function createGithubAdapter(
  options: GithubAdapterOptions,
  deps: GithubAdapterDeps
): TrackerAdapter {
  const context: GithubContext = { ...options, execGh: deps.execGh };
  return {
    fetchItemState: ref => fetchState(context, ref),
    transitionToDone: (ref, doneStatus) => transition(context, ref, doneStatus),
    upsertManagedComment: (ref, body) => upsertComment(context, ref, body),
    closeNatively: async ref => {
      await context.execGh([
        "issue",
        "close",
        issueNumber(ref),
        "--repo",
        context.repository,
      ]);
    },
  };
}
