/**
 * In-memory Linear GraphQL server for the npm updater's Linear adapter
 * (CodySwannGT/lisa#4859).
 *
 * The fake is a `fetch`-shaped function the adapter receives as its injected
 * transport, so no live workspace, credential or network is involved. Every
 * request is recorded in `log` — that log is the evidence that a re-run creates
 * nothing. Descriptions and comment bodies keep the exact Markdown the adapter
 * sent, the way Linear stores them.
 * @module tests/support/npm-update-linear-fake
 */
import type {
  TrackerRequest,
  Transport,
} from "./npm-update-tracker-transport.js";

/** A stored comment: its Markdown body exactly as sent, and its author. */
interface LinearComment {
  id: string;
  body: string;
  userId: string | null;
}

/** A stored issue and its comments. */
interface LinearIssue {
  id: string;
  number: number;
  title: string;
  description: string;
  priority: number;
  stateId: string;
  assigneeId: string | null;
  comments: LinearComment[];
}

/** A Linear string comparator. */
interface TextTest {
  contains?: string;
  containsIgnoreCase?: string;
}

/** The issue-filter subset the adapter sends. */
interface IssueFilter {
  description?: TextTest;
  or?: Array<{ title?: TextTest; description?: TextTest }>;
}

/** The GraphQL variables the adapter sends. */
interface Variables {
  id?: string;
  key?: string;
  filter?: IssueFilter;
  input?: Record<string, string | number | undefined>;
}

/** The fake workspace: team key, API-key viewer, members and issues. */
interface LinearStore {
  teamKey: string;
  viewerId: string;
  members: readonly string[];
  issues: LinearIssue[];
}

/** Answers one GraphQL operation. */
type Handler = (variables: Variables) => unknown;

/** Options for one fake Linear workspace. */
export interface LinearFakeOptions {
  teamKey?: string;
  viewerId?: string;
  members?: string[];
}

const TEAM_ID = "team-1";
const LINEAR_URL = "https://api.linear.app/graphql";
const STATES = [
  { id: "state-backlog", name: "Backlog", type: "backlog" },
  { id: "state-ready", name: "Ready", type: "unstarted" },
  { id: "state-progress", name: "In Progress", type: "started" },
  { id: "state-review", name: "Code Review", type: "started" },
  { id: "state-done", name: "Done", type: "completed" },
];

/**
 * Whether a string field passes one Linear text comparator.
 * @param value - Stored field text.
 * @param test - The comparator, if any.
 * @returns True when absent or satisfied.
 */
function passes(value: string, test: TextTest | undefined): boolean {
  if (!test) return true;
  if (test.contains !== undefined) return value.includes(test.contains);
  return value
    .toLowerCase()
    .includes(String(test.containsIgnoreCase).toLowerCase());
}

/**
 * The issue-filter subset the adapter uses: description, or title/description.
 * @param issue - Stored issue.
 * @param filter - The filter the adapter sent.
 * @returns True when the issue matches.
 */
function matches(issue: LinearIssue, filter: IssueFilter = {}): boolean {
  if (!passes(issue.description, filter.description)) return false;
  return (
    !filter.or ||
    filter.or.some(
      clause =>
        (clause.title !== undefined && passes(issue.title, clause.title)) ||
        (clause.description !== undefined &&
          passes(issue.description, clause.description))
    )
  );
}

/**
 * The state record for a stored state id.
 * @param id - Workflow state id.
 * @returns The state.
 */
function stateOf(id: string) {
  return STATES.find(state => state.id === id) ?? STATES[0]!;
}

/**
 * Find an issue by its id or its `<TEAM>-<N>` identifier.
 * @param store - Fake workspace.
 * @param id - Id or identifier.
 * @returns The issue, if stored.
 */
function findIssue(store: LinearStore, id: string | undefined) {
  return store.issues.find(
    issue => issue.id === id || `${store.teamKey}-${issue.number}` === id
  );
}

/**
 * The GraphQL comment node Linear returns.
 * @param store - Fake workspace.
 * @param comment - Stored comment.
 * @param issue - Its issue.
 * @returns The node.
 */
function commentNode(
  store: LinearStore,
  comment: LinearComment,
  issue: LinearIssue
) {
  return {
    id: comment.id,
    body: comment.body,
    user: comment.userId ? { id: comment.userId } : null,
    botActor: comment.userId ? null : { id: "bot-actor" },
    issue: { identifier: `${store.teamKey}-${issue.number}` },
  };
}

/**
 * The GraphQL issue node Linear returns.
 * @param store - Fake workspace.
 * @param issue - Stored issue.
 * @returns The node.
 */
function issueNode(store: LinearStore, issue: LinearIssue) {
  const state = stateOf(issue.stateId);
  return {
    id: issue.id,
    identifier: `${store.teamKey}-${issue.number}`,
    number: issue.number,
    title: issue.title,
    description: issue.description,
    priority: issue.priority,
    archivedAt: null,
    state: { name: state.name, type: state.type },
    assignee: issue.assigneeId ? { id: issue.assigneeId } : null,
    labels: { nodes: [] },
    children: { nodes: [] },
    inverseRelations: { nodes: [] },
  };
}

/**
 * Read operations: viewer, team, membership, search, issue and comments.
 * @param store - Fake workspace.
 * @returns Handlers by GraphQL operation name.
 */
function reads(store: LinearStore): Record<string, Handler> {
  return {
    LisaNpmViewer: () => ({ viewer: { id: store.viewerId } }),
    LisaNpmTeam: v => ({
      teams: {
        nodes:
          v.key === store.teamKey
            ? [{ id: TEAM_ID, key: store.teamKey, states: { nodes: STATES } }]
            : [],
      },
    }),
    LisaNpmMember: v => ({
      user: store.members.includes(String(v.id))
        ? {
            id: v.id,
            active: true,
            teams: { nodes: v.key === store.teamKey ? [{ id: TEAM_ID }] : [] },
          }
        : null,
    }),
    LisaNpmIssues: v => ({
      issues: {
        nodes: store.issues
          .filter(issue => matches(issue, v.filter))
          .map(issue => ({
            number: issue.number,
            archivedAt: null,
            state: { type: stateOf(issue.stateId).type },
          })),
        pageInfo: { hasNextPage: false },
      },
    }),
    LisaNpmIssue: v => {
      const issue = findIssue(store, v.id);
      return { issue: issue ? issueNode(store, issue) : null };
    },
    LisaNpmComments: v => {
      const issue = findIssue(store, v.id)!;
      const nodes = issue.comments.map(item => commentNode(store, item, issue));
      return {
        issue: {
          comments: {
            nodes,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    },
    LisaNpmComment: v => {
      const issue = store.issues.find(item =>
        item.comments.some(comment => comment.id === v.id)
      );
      const comment = issue?.comments.find(item => item.id === v.id);
      return {
        comment: issue && comment ? commentNode(store, comment, issue) : null,
      };
    },
  };
}

/**
 * Write operations: issue create/update and comment create.
 * @param store - Fake workspace.
 * @returns Handlers by GraphQL operation name.
 */
function writes(store: LinearStore): Record<string, Handler> {
  return {
    LisaNpmIssueCreate: v => {
      const input = v.input ?? {};
      const number = store.issues.length + 1;
      store.issues.push({
        id: `issue-${number}`,
        number,
        title: String(input.title),
        description: String(input.description),
        priority: Number(input.priority),
        stateId: String(input.stateId),
        assigneeId:
          input.assigneeId === undefined ? null : String(input.assigneeId),
        comments: [],
      });
      const identifier = `${store.teamKey}-${number}`;
      return { issueCreate: { success: true, issue: { number, identifier } } };
    },
    LisaNpmIssueUpdate: v => {
      const issue = findIssue(store, v.id)!;
      const input = v.input ?? {};
      if (input.stateId !== undefined) issue.stateId = String(input.stateId);
      if (input.assigneeId !== undefined)
        issue.assigneeId = String(input.assigneeId);
      return { issueUpdate: { success: true } };
    },
    LisaNpmCommentCreate: v => {
      const issue = findIssue(store, String(v.input?.issueId))!;
      const comment = {
        id: `comment-${issue.comments.length + 1}-${issue.number}`,
        body: String(v.input?.body),
        userId: store.viewerId,
      };
      issue.comments.push(comment);
      const node = commentNode(store, comment, issue);
      return { commentCreate: { success: true, comment: node } };
    },
  };
}

/**
 * A Linear workspace with one team, its workflow states and an API-key viewer.
 * @param options - Team key, viewer id and assignable members.
 * @returns The transport, its request log, the stored issues and a create count.
 */
export function fakeLinear(options: LinearFakeOptions = {}) {
  const store: LinearStore = {
    teamKey: options.teamKey ?? "ENG",
    viewerId: options.viewerId ?? "viewer-0001",
    members: options.members ?? [],
    issues: [],
  };
  const handlers = { ...reads(store), ...writes(store) };
  const log: TrackerRequest[] = [];
  const transport: Transport = async (url, init) => {
    if (String(url) !== LINEAR_URL)
      return new Response("not found", { status: 404 });
    const request = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: Variables;
    };
    const operation =
      /^(?:query|mutation) (\w+)/.exec(request.query)?.[1] ?? "";
    const handler = handlers[operation];
    log.push({ operation, variables: { ...request.variables } });
    if (!handler) return Response.json({ errors: [{ message: "unknown" }] });
    return Response.json({ data: handler(request.variables ?? {}) });
  };
  return {
    transport,
    log,
    issues: store.issues,
    creates: () =>
      log.filter(entry => entry.operation === "LisaNpmIssueCreate").length,
  };
}
