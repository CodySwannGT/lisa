/**
 * Record and option shapes of the in-memory Jira fake (CodySwannGT/lisa#4859, #4873).
 * @module tests/support/npm-update-jira-fake-types
 */
/** A stored comment: its ADF body exactly as sent, and its author. */
export interface JiraComment {
  id: string;
  body: unknown;
  accountId: string;
  accountType: string;
  /** Jira's own timestamp form, `+0000` offset. */
  created: string;
}

/** One status change in a ticket's changelog. */
export interface JiraStatusChange {
  author: string;
  created: string;
  status: string;
}

/** Stored ticket fields, as Jira returns them. */
export interface JiraFields {
  summary?: string;
  description?: unknown;
  labels: string[];
  status: { name: string; statusCategory: { key: string } };
  assignee: { accountId: string; accountType: string } | null;
  [field: string]: unknown;
}

/** A stored ticket and its comments. */
export interface JiraIssue {
  number: number;
  fields: JiraFields;
  comments: JiraComment[];
  changelog: JiraStatusChange[];
}

/** One workflow transition the Task workflow offers. */
export interface JiraTransition {
  id: string;
  to: { name: string };
}

/** The fake project: its key, API account, assignable accounts, workflow and tickets. */
export interface JiraStore {
  project: string;
  accountId: string;
  accountType: string;
  assignable: readonly string[];
  transitions: JiraTransition[];
  issues: JiraIssue[];
  /** Whether the search index lags behind creates. */
  indexLag: boolean;
  /** Ticket ids created but not yet visible to search. */
  unindexed: Set<number>;
  /** The API account's own user properties. */
  properties: Map<string, unknown>;
}

/** The JSON request bodies the adapter sends. */
export interface JiraBody {
  jql?: string;
  maxResults?: number;
  fields?: Record<string, unknown> & { labels?: string[] };
  body?: unknown;
  transition?: { id: string };
  accountId?: string;
  reconcileIssues?: number[];
}

/** Answers one routed request; undefined is 404 and null is 204. */
export type Handler = (key: string, body: JiraBody, url: URL) => unknown;
/** One REST route: method, path pattern and handler. */
export type Route = readonly [method: string, path: RegExp, handler: Handler];

/** Options for one fake Jira project. */
export interface JiraFakeOptions {
  project?: string;
  accountId?: string;
  accountType?: string;
  assignable?: string[];
  readyTransitions?: number;
  /** Newly created tickets stay out of search until `index()`, unless reconciled. */
  indexLag?: boolean;
}
