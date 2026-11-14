/**
 * Record and option shapes of the in-memory Linear fake (CodySwannGT/lisa#4859, #4873).
 * @module tests/support/npm-update-linear-fake-types
 */
/** A stored comment: its Markdown body exactly as sent, and its author. */
export interface LinearComment {
  id: string;
  body: string;
  userId: string | null;
  createdAt: string;
}

/** One state change in an issue's history. */
export interface LinearStateChange {
  actorId: string;
  createdAt: string;
  stateId: string;
}

/** A stored issue and its comments. */
export interface LinearIssue {
  id: string;
  number: number;
  title: string;
  description: string;
  priority: number;
  stateId: string;
  assigneeId: string | null;
  labels: string[];
  /** Sub-issue ids. */
  children: string[];
  /** Inverse `blocks` relations held by an open or closed issue. */
  relations: Array<{ type: string; closed: boolean }>;
  comments: LinearComment[];
  history: LinearStateChange[];
}

/** A Linear string comparator. */
export interface TextTest {
  contains?: string;
  containsIgnoreCase?: string;
}

/** The issue-filter subset the adapter sends. */
export interface IssueFilter {
  description?: TextTest;
  or?: Array<{ title?: TextTest; description?: TextTest }>;
}

/** Issue fields a create or seed supplies. */
export type IssueInput = Record<string, string | number | undefined>;

/** The GraphQL variables the adapter sends. */
export interface Variables {
  id?: string;
  key?: string;
  filter?: IssueFilter;
  after?: string | null;
  input?: IssueInput;
}

/** The fake workspace: team key, API-key viewer, members and issues. */
export interface LinearStore {
  teamKey: string;
  viewerId: string;
  members: readonly string[];
  truncated: readonly string[];
  issues: LinearIssue[];
}

/** Answers one GraphQL operation. */
export type Handler = (variables: Variables) => unknown;

/** Options for one fake Linear workspace. */
export interface LinearFakeOptions {
  teamKey?: string;
  viewerId?: string;
  members?: string[];
  /** Issue connections (labels, children, inverseRelations) that report another page forever. */
  truncated?: string[];
}
