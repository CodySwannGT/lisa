/**
 * Fixtures for the stale "blocked by" link tests (CodySwannGT/lisa#5065):
 * raw Jira, Linear and GitHub items as each vendor read hands them to the
 * plan, and a helper that applies a GitHub plan the way the session manager
 * does after each write reads back.
 * @module tests/unit/strategies/stale-blocker-fixtures
 */
import { terminalDoneRoles } from "../../../plugins/src/base/scripts/stale-blocker-edges.mjs";

/** Status name and comments of a {@link jiraIssue}. */
export interface JiraIssueOptions {
  readonly status?: string;
  readonly comments?: { body: string }[];
}

/** Body, labels, native and body blockers, and comments of a {@link githubItem}. */
export interface GithubItemOptions {
  readonly body?: string;
  readonly labels?: string[];
  readonly native?: Record<string, unknown>[];
  readonly found?: Record<string, unknown>;
  readonly comments?: { body: string }[];
}

export const REPO = "example-org/demo-repo";
export const GH_ROLES = { ready: "status:ready", blocked: "status:blocked" };
export const JIRA_ROLES = { ready: "Ready", blocked: "Blocked" };
export const GH_DONE = terminalDoneRoles({ tracker: "github" });

/**
 * A Jira "is blocked by" link.
 * @param id - Link id
 * @param key - Blocker key
 * @param status - Blocker status name and category, or null when unreadable
 * @returns Raw issuelink
 */
export function jiraLink(
  id: string,
  key: string,
  status: { name: string; category: string } | null
) {
  return {
    id,
    type: { inward: "is blocked by" },
    inwardIssue: status
      ? {
          key,
          fields: {
            status: {
              name: status.name,
              statusCategory: { key: status.category },
            },
          },
        }
      : { key },
  };
}

export const DONE = { name: "Done", category: "done" };
export const IN_PROGRESS = { name: "In Progress", category: "indeterminate" };

/**
 * A raw Jira issue.
 * @param key - Item key
 * @param links - Its issuelinks
 * @param options - Status name and comments
 * @returns Raw issue
 */
export function jiraIssue(
  key: string,
  links: unknown[],
  options: JiraIssueOptions = {}
) {
  return {
    key,
    fields: { status: { name: options.status ?? "Ready" }, issuelinks: links },
    comments: options.comments ?? [],
  };
}

/**
 * A Linear "blocks" inverse relation.
 * @param id - Relation id
 * @param identifier - Blocker identifier
 * @param state - Blocker state, or null when unreadable
 * @param team - Blocker team key
 * @returns Relation node
 */
export function linearRelation(
  id: string,
  identifier: string,
  state: { name: string; type: string } | null,
  team = "ENG"
) {
  return {
    id,
    type: "blocks",
    issue: state
      ? { identifier, state, team: { key: team } }
      : { identifier, team: { key: team } },
  };
}

/**
 * A GitHub item as the collector hands it to the plan.
 * @param number - Issue number
 * @param options - Body, labels, native and body blockers, comments
 * @returns Raw item
 */
export function githubItem(number: number, options: GithubItemOptions) {
  return {
    repo: REPO,
    number,
    body: options.body ?? "",
    labels: (options.labels ?? [GH_ROLES.ready]).map(name => ({ name })),
    nativeBlockers: options.native ?? [],
    bodyBlockers: options.found ?? {},
    comments: options.comments ?? [],
  };
}

/**
 * Apply a plan's GitHub writes to a fixture, as the manager would after each
 * write reads back: drop the deleted dependencies, take the edited body and
 * post the comment.
 * @param raw - GitHub item
 * @param plan - Its plan entry (the test fails when there is none)
 * @param plan.actions - The planned removals
 * @param plan.body - The edited body, or null
 * @param plan.comment - The operator comment
 * @returns The item after the writes
 */
export function applyGithubPlan(
  raw: ReturnType<typeof githubItem>,
  plan:
    | {
        actions: { endpoint?: string }[];
        body: string | null;
        comment: string;
      }
    | undefined
) {
  if (!plan) throw new Error("expected a plan entry for the item");
  const deleted = new Set(
    plan.actions.map(action => String(action.endpoint).split("/").at(-1))
  );
  return {
    ...raw,
    body: plan.body ?? raw.body,
    nativeBlockers: raw.nativeBlockers.filter(
      blocker => !deleted.has(String(blocker.id))
    ),
    comments: [...raw.comments, { body: plan.comment }],
  };
}
