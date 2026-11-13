/**
 * In-memory Jira Cloud REST v3 server for the npm updater's Jira adapter
 * (CodySwannGT/lisa#4859).
 *
 * The fake is a `fetch`-shaped function the adapter receives as its injected
 * transport, so no live site, credential or network is involved. Every request
 * is recorded in `log` — that log is the evidence that a re-run creates
 * nothing. Descriptions and comment bodies keep the exact ADF document the
 * adapter sent, the way Jira stores them. Comment lists page by `startAt` and
 * `maxResults`, and search pages by `maxResults` with `isLast`, as Jira does.
 * The Task workflow offers one transition to each status (id 11 + its index);
 * `readyTransitions` changes how many reach Ready, to model a broken workflow.
 * @module tests/support/npm-update-jira-fake
 */
import type {
  TrackerRequest,
  Transport,
} from "./npm-update-tracker-transport.js";

/** A stored comment: its ADF body exactly as sent, and its author. */
interface JiraComment {
  id: string;
  body: unknown;
  accountId: string;
  accountType: string;
}

/** Stored ticket fields, as Jira returns them. */
interface JiraFields {
  summary?: string;
  description?: unknown;
  labels: string[];
  status: { name: string; statusCategory: { key: string } };
  assignee: { accountId: string; accountType: string } | null;
  [field: string]: unknown;
}

/** A stored ticket and its comments. */
interface JiraIssue {
  number: number;
  fields: JiraFields;
  comments: JiraComment[];
}

/** One workflow transition the Task workflow offers. */
interface JiraTransition {
  id: string;
  to: { name: string };
}

/** The fake project: its key, API account, assignable accounts, workflow and tickets. */
interface JiraStore {
  project: string;
  accountId: string;
  accountType: string;
  assignable: readonly string[];
  transitions: JiraTransition[];
  issues: JiraIssue[];
}

/** The JSON request bodies the adapter sends. */
interface JiraBody {
  jql?: string;
  maxResults?: number;
  fields?: Record<string, unknown> & { labels?: string[] };
  body?: unknown;
  transition?: { id: string };
  accountId?: string;
}

/** Answers one routed request; undefined is 404 and null is 204. */
type Handler = (key: string, body: JiraBody, url: URL) => unknown;
/** One REST route: method, path pattern and handler. */
type Route = readonly [method: string, path: RegExp, handler: Handler];

/** Options for one fake Jira project. */
export interface JiraFakeOptions {
  project?: string;
  accountId?: string;
  accountType?: string;
  assignable?: string[];
  readyTransitions?: number;
}

const STATUSES = ["Backlog", "Ready", "In Progress", "Code Review", "Done"];
const ISSUE = "([A-Z]+-\\d+)";
const ATLASSIAN = "atlassian";
const API = "/rest/api/3";

/**
 * A status record as Jira returns it.
 * @param name - Status name.
 * @returns The status.
 */
function status(name: string) {
  return {
    name,
    statusCategory: { key: name === "Done" ? "done" : "indeterminate" },
  };
}

/**
 * One transition per status; Ready is offered `ready` times.
 * @param ready - How many transitions reach Ready.
 * @returns The workflow transitions.
 */
function workflow(ready: number) {
  return STATUSES.flatMap((name, index) =>
    Array.from({ length: name === "Ready" ? ready : 1 }, (_, copy) => ({
      id: String(index + 11 + copy * 100),
      to: { name },
    }))
  );
}

/**
 * Find an issue by its `<PROJECT>-<N>` key.
 * @param store - Fake project.
 * @param key - Issue key.
 * @returns The issue, if stored.
 */
function findIssue(store: JiraStore, key: string) {
  return store.issues.find(issue => `${store.project}-${issue.number}` === key);
}

/**
 * A comment as Jira returns it.
 * @param comment - Stored comment.
 * @returns The comment JSON.
 */
function commentJson(comment: JiraComment) {
  return {
    id: comment.id,
    body: comment.body,
    author: { accountId: comment.accountId, accountType: comment.accountType },
  };
}

/**
 * JQL subset the adapter sends: an exact label, or summary/description text.
 * @param store - Fake project.
 * @param query - The JQL.
 * @returns Matching issues.
 */
function jql(store: JiraStore, query: string) {
  const label = /labels = "([^"]+)"/.exec(query)?.[1];
  const text = /summary ~ "([^"]+)"/.exec(query)?.[1] ?? "";
  return store.issues.filter(issue =>
    label
      ? issue.fields.labels.includes(label)
      : `${issue.fields.summary} ${JSON.stringify(issue.fields.description)}`.includes(
          text
        )
  );
}

/**
 * Store a Task in the Backlog status.
 * @param store - Fake project.
 * @param fields - Create fields (summary, description, labels, assignee).
 * @returns The created key.
 */
function createIssue(store: JiraStore, fields: JiraBody["fields"] = {}) {
  const number = store.issues.length + 1;
  const assignee = fields.assignee as { accountId: string } | undefined;
  store.issues.push({
    number,
    fields: {
      ...fields,
      labels: fields.labels ?? [],
      status: status(String(fields.status ?? "Backlog")),
      issuetype: fields.issuetype ?? { name: "Task", subtask: false },
      assignee: assignee ? { ...assignee, accountType: ATLASSIAN } : null,
      subtasks: [],
      issuelinks: [],
    },
    comments: [],
  });
  return { id: String(10_000 + number), key: `${store.project}-${number}` };
}

/**
 * Store one comment from the given account.
 * @param store - Fake project.
 * @param issue - Its ticket.
 * @param body - ADF body.
 * @param accountId - Author account.
 * @returns The stored comment.
 */
function addComment(
  store: JiraStore,
  issue: JiraIssue,
  body: unknown,
  accountId = store.accountId
) {
  const total = store.issues.flatMap(item => item.comments).length;
  const comment = {
    id: String(20_000 + total),
    body,
    accountId,
    accountType: accountId === store.accountId ? store.accountType : ATLASSIAN,
  };
  issue.comments.push(comment);
  return comment;
}

/**
 * Account, assignability, workflow vocabulary and search routes.
 * @param store - Fake project.
 * @returns The routes.
 */
function metaRoutes(store: JiraStore): Route[] {
  return [
    ["GET", /^\/rest\/api\/3\/myself$/, () => ({ accountId: store.accountId })],
    [
      "GET",
      /^\/rest\/api\/3\/user\/assignable\/search$/,
      (_key, _body, url) => {
        const id = url.searchParams.get("accountId") ?? "";
        const ok =
          store.assignable.includes(id) &&
          url.searchParams.get("project") === store.project;
        return ok
          ? [{ accountId: id, active: true, accountType: ATLASSIAN }]
          : [];
      },
    ],
    [
      "GET",
      new RegExp(`^${API}/project/${store.project}/statuses$`),
      () => [{ name: "Task", statuses: STATUSES.map(name => status(name)) }],
    ],
    [
      "GET",
      /^\/rest\/api\/3\/priority$/,
      () => [{ name: "High" }, { name: "Medium" }, { name: "Low" }],
    ],
    [
      "POST",
      /^\/rest\/api\/3\/search\/jql$/,
      (_key, body) => {
        const found = jql(store, String(body.jql));
        const size = body.maxResults ?? 50;
        return {
          issues: found.slice(0, size).map(issue => ({
            key: `${store.project}-${issue.number}`,
            fields: { status: issue.fields.status },
          })),
          isLast: found.length <= size,
        };
      },
    ],
  ];
}

/**
 * Issue create, read, transition and assignment routes.
 * @param store - Fake project.
 * @returns The routes.
 */
function issueRoutes(store: JiraStore): Route[] {
  const issuePath = (suffix = "") =>
    new RegExp(`^${API}/issue/${ISSUE}${suffix}$`);
  return [
    [
      "POST",
      /^\/rest\/api\/3\/issue$/,
      (_key, body) => createIssue(store, body.fields),
    ],
    [
      "GET",
      issuePath(),
      key => {
        const issue = findIssue(store, key);
        return issue ? { key, fields: issue.fields } : undefined;
      },
    ],
    [
      "GET",
      issuePath("/transitions"),
      () => ({ transitions: store.transitions }),
    ],
    [
      "POST",
      issuePath("/transitions"),
      (key, body) => {
        const move = store.transitions.find(
          item => item.id === body.transition?.id
        );
        findIssue(store, key)!.fields.status = status(move!.to.name);
        return null;
      },
    ],
    [
      "PUT",
      issuePath("/assignee"),
      (key, body) => {
        const accountId = String(body.accountId);
        findIssue(store, key)!.fields.assignee = {
          accountId,
          accountType: ATLASSIAN,
        };
        return null;
      },
    ],
  ];
}

/**
 * Comment list (paged by startAt/maxResults), read and create routes, scoped to their issue.
 * @param store - Fake project.
 * @returns The routes.
 */
function commentRoutes(store: JiraStore): Route[] {
  const commentPath = (suffix = "") =>
    new RegExp(`^${API}/issue/${ISSUE}/comment${suffix}$`);
  return [
    [
      "GET",
      commentPath(),
      (key, _body, url) => {
        const all = findIssue(store, key)!.comments.map(commentJson);
        const startAt = Number(url.searchParams.get("startAt") ?? 0);
        const maxResults = Number(url.searchParams.get("maxResults") ?? 50);
        const comments = all.slice(startAt, startAt + maxResults);
        return { startAt, maxResults, total: all.length, comments };
      },
    ],
    [
      "GET",
      commentPath("/(\\d+)"),
      (key, _body, url) => {
        const id = url.pathname.split("/").at(-1);
        const comment = findIssue(store, key)?.comments.find(
          item => item.id === id
        );
        return comment ? commentJson(comment) : undefined;
      },
    ],
    [
      "POST",
      commentPath(),
      (key, body) =>
        commentJson(addComment(store, findIssue(store, key)!, body.body)),
    ],
  ];
}

/**
 * Answer one routed request: 404 for an unknown route or record, 204 for a write with no body.
 * @param routes - The fake's routes.
 * @param method - HTTP method.
 * @param url - Request URL.
 * @param body - Parsed JSON body.
 * @returns The response.
 */
function respond(routes: Route[], method: string, url: URL, body: JiraBody) {
  const route = routes.find(
    ([verb, pattern]) => verb === method && pattern.test(url.pathname)
  );
  const key = route ? (route[1].exec(url.pathname)?.[1] ?? "") : "";
  const value = route ? route[2](key, body, url) : undefined;
  if (value === undefined) return new Response("{}", { status: 404 });
  if (value === null) return new Response(null, { status: 204 });
  return Response.json(value);
}

/**
 * A Jira Cloud project whose Task workflow allows a transition to any status.
 * @param options - Project key, API account, assignable accounts and Ready transition count.
 * @returns The transport, its request log, the stored issues, seeding helpers and a create count.
 */
export function fakeJira(options: JiraFakeOptions = {}) {
  const store: JiraStore = {
    project: options.project ?? "PROJ",
    accountId: options.accountId ?? "service-account-1",
    accountType: options.accountType ?? ATLASSIAN,
    assignable: options.assignable ?? [],
    transitions: workflow(options.readyTransitions ?? 1),
    issues: [],
  };
  const routes = [
    ...metaRoutes(store),
    ...issueRoutes(store),
    ...commentRoutes(store),
  ];
  const log: TrackerRequest[] = [];
  const transport: Transport = async (raw, init) => {
    const url = new URL(String(raw));
    const method = init?.method ?? "GET";
    const body = (init?.body ? JSON.parse(String(init.body)) : {}) as JiraBody;
    log.push({ operation: `${method} ${url.pathname}${url.search}`, body });
    return respond(routes, method, url, body);
  };
  return {
    transport,
    log,
    issues: store.issues,
    // Store a ticket directly, as a human or another tool would have filed it.
    seed: (fields: JiraBody["fields"]) => createIssue(store, fields),
    // Store a comment on ticket `number` from `accountId`.
    comment: (number: number, body: unknown, accountId?: string) =>
      addComment(store, store.issues[number - 1]!, body, accountId),
    creates: () =>
      log.filter(entry => entry.operation === "POST /rest/api/3/issue").length,
  };
}
