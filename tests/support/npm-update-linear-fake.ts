/**
 * In-memory Linear GraphQL server for the npm updater's Linear adapter
 * (CodySwannGT/lisa#4859).
 *
 * The fake is a `fetch`-shaped function the adapter receives as its injected
 * transport, so no live workspace, credential or network is involved. Every
 * request is recorded in `log` — that log is the evidence that a re-run creates
 * nothing. Descriptions and comment bodies keep the exact Markdown the adapter
 * sent, the way Linear stores them. Searches and comment lists page 100
 * nodes at a time behind an opaque cursor, as Linear's connections do.
 * @module tests/support/npm-update-linear-fake
 */
import type {
  TrackerRequest,
  Transport,
} from "./npm-update-tracker-transport.js";
import type {
  LinearComment,
  LinearIssue,
  TextTest,
  IssueFilter,
  IssueInput,
  Variables,
  LinearStore,
  Handler,
  LinearFakeOptions,
} from "./npm-update-linear-fake-types.js";
export type { LinearFakeOptions } from "./npm-update-linear-fake-types.js";

/** The API-key user the fake answers as: the declared automation identity in test configs. */
export const LINEAR_VIEWER = "7a1e3c55-2b0d-4c8e-9f61-3d2a4b5c6e7f";
const TEAM_ID = "team-1";
const CONNECTIONS = ["labels", "children", "inverseRelations"];
const PAGE = 100;
const LINEAR_URL = "https://api.linear.app/graphql";
const STATES = [
  { id: "state-backlog", name: "Backlog", type: "backlog" },
  { id: "state-ready", name: "Ready", type: "unstarted" },
  { id: "state-progress", name: "In Progress", type: "started" },
  { id: "state-review", name: "Code Review", type: "started" },
  { id: "state-done", name: "Done", type: "completed" },
  { id: "state-canceled", name: "Canceled", type: "canceled" },
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
    createdAt: comment.createdAt,
    editedAt: null,
    body: comment.body,
    user: comment.userId ? { id: comment.userId } : null,
    botActor: comment.userId ? null : { id: "bot-actor" },
    issue: { identifier: `${store.teamKey}-${issue.number}` },
  };
}

/**
 * One issue connection page of 100 by cursor; a truncated one never ends.
 * @param store - Fake workspace.
 * @param name - Connection name on the issue node.
 * @param nodes - Every node in the connection.
 * @param after - The previous page's end cursor, if any.
 * @returns The connection page.
 */
function connection(
  store: LinearStore,
  name: string,
  nodes: object[],
  after?: string | null
) {
  if (store.truncated.includes(name))
    return { nodes: [], pageInfo: { hasNextPage: true, endCursor: "0" } };
  return page(nodes, after);
}

/**
 * Every node of one named issue connection.
 * @param issue - Stored issue.
 * @param name - labels, children or inverseRelations.
 * @returns Its nodes.
 */
function connectionNodes(issue: LinearIssue, name: string): object[] {
  if (name === "labels") return issue.labels.map(label => ({ name: label }));
  if (name === "children") return issue.children.map(id => ({ id }));
  return issue.relations.map(relation => ({
    type: relation.type,
    issue: {
      state: { type: relation.closed ? "completed" : "started" },
      archivedAt: null,
    },
  }));
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
    ...Object.fromEntries(
      CONNECTIONS.map(name => [
        name,
        connection(store, name, connectionNodes(issue, name)),
      ])
    ),
  };
}

/**
 * One connection page of 100 nodes after an opaque index cursor.
 * @param nodes - Every matching node, in order.
 * @param after - The previous page's end cursor, if any.
 * @returns The page and its pageInfo.
 */
function page<T>(nodes: T[], after: string | null | undefined) {
  const start = after ? Number(after) : 0;
  const end = start + PAGE;
  return {
    nodes: nodes.slice(start, end),
    pageInfo: {
      hasNextPage: end < nodes.length,
      endCursor: end < nodes.length ? String(end) : null,
    },
  };
}

/**
 * Store an issue directly, as a person or another tool would have filed it.
 * @param store - Fake workspace.
 * @param input - Title, description, priority, state id and assignee id.
 * @returns The stored issue.
 */
function addIssue(store: LinearStore, input: IssueInput) {
  const number = store.issues.length + 1;
  const issue: LinearIssue = {
    id: `issue-${number}`,
    number,
    title: String(input.title ?? "Seeded issue"),
    description: String(input.description ?? ""),
    priority: Number(input.priority ?? 0),
    stateId: String(input.stateId ?? "state-backlog"),
    assigneeId:
      input.assigneeId === undefined ? null : String(input.assigneeId),
    labels: [],
    children: [],
    relations: [],
    comments: [],
    history: [],
  };
  store.issues.push(issue);
  return issue;
}

/**
 * Move an issue to a workflow state and record who did it in its history.
 * @param issue - The issue.
 * @param stateId - The new state id.
 * @param actorId - The user making the change.
 */
function moveIssue(issue: LinearIssue, stateId: string, actorId: string) {
  issue.stateId = stateId;
  issue.history.push({ actorId, createdAt: new Date().toISOString(), stateId });
}

/**
 * Store one comment; a null user models an integration (bot) author.
 * @param store - Fake workspace.
 * @param issue - Its issue.
 * @param body - Markdown body.
 * @param userId - Author user id; defaults to the API-key viewer.
 * @returns The stored comment.
 */
function addComment(
  store: LinearStore,
  issue: LinearIssue,
  body: string,
  userId: string | null = store.viewerId
) {
  const comment = {
    createdAt: new Date().toISOString(),
    id: `comment-${issue.comments.length + 1}-${issue.number}`,
    body,
    userId,
  };
  issue.comments.push(comment);
  return comment;
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
      issues: page(
        store.issues
          .filter(issue => matches(issue, v.filter))
          .map(issue => ({
            number: issue.number,
            archivedAt: null,
            state: { type: stateOf(issue.stateId).type },
          })),
        v.after
      ),
    }),
    LisaNpmIssue: v => {
      const issue = findIssue(store, v.id);
      return { issue: issue ? issueNode(store, issue) : null };
    },
    ...Object.fromEntries(
      CONNECTIONS.map(name => [
        `LisaNpmIssue${name[0]!.toUpperCase()}${name.slice(1)}`,
        (v: Variables) => {
          const issue = findIssue(store, v.id)!;
          const nodes = connectionNodes(issue, name);
          return { issue: { [name]: connection(store, name, nodes, v.after) } };
        },
      ])
    ),
    LisaNpmIssueHistory: v => {
      const issue = findIssue(store, v.id)!;
      const nodes = issue.history.map(change => ({
        createdAt: change.createdAt,
        actor: { id: change.actorId },
        toState: { id: change.stateId, type: stateOf(change.stateId).type },
      }));
      return { issue: { history: page(nodes, v.after) } };
    },
    LisaNpmComments: v => {
      const issue = findIssue(store, v.id)!;
      const nodes = issue.comments.map(item => commentNode(store, item, issue));
      return { issue: { comments: page(nodes, v.after) } };
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
      const { number } = addIssue(store, v.input ?? {});
      const identifier = `${store.teamKey}-${number}`;
      return { issueCreate: { success: true, issue: { number, identifier } } };
    },
    LisaNpmIssueUpdate: v => {
      const issue = findIssue(store, v.id)!;
      const input = v.input ?? {};
      if (input.stateId !== undefined)
        moveIssue(issue, String(input.stateId), store.viewerId);
      if (input.assigneeId !== undefined)
        issue.assigneeId = String(input.assigneeId);
      return { issueUpdate: { success: true } };
    },
    LisaNpmCommentCreate: v => {
      const issue = findIssue(store, String(v.input?.issueId))!;
      const comment = addComment(store, issue, String(v.input?.body));
      const node = commentNode(store, comment, issue);
      return { commentCreate: { success: true, comment: node } };
    },
  };
}

/**
 * A Linear workspace with one team, its workflow states and an API-key viewer.
 * @param options - Team key, viewer id and assignable members.
 * @returns The transport, its request log, the stored issues, seeding helpers and a create count.
 */
export function fakeLinear(options: LinearFakeOptions = {}) {
  const store: LinearStore = {
    teamKey: options.teamKey ?? "ENG",
    viewerId: options.viewerId ?? LINEAR_VIEWER,
    members: options.members ?? [],
    truncated: options.truncated ?? [],
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
    // Store an issue directly, as a person or another tool would have filed it.
    seed: (input: IssueInput) => addIssue(store, input),
    // Store a comment on issue `number`; a null `userId` models a bot author.
    // Move issue `number` to `stateId` as `actorId`, as a person would in Linear.
    move: (number: number, stateId: string, actorId: string) =>
      moveIssue(store.issues[number - 1]!, stateId, actorId),
    comment: (number: number, body: string, userId?: string | null) =>
      addComment(store, store.issues[number - 1]!, body, userId),
    creates: () =>
      log.filter(entry => entry.operation === "LisaNpmIssueCreate").length,
  };
}
