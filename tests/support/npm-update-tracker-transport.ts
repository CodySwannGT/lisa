/**
 * Shared shapes for the npm updater's in-memory Jira and Linear fakes
 * (CodySwannGT/lisa#4859).
 * @module tests/support/npm-update-tracker-transport
 */

/** One recorded request; `operation` is the GraphQL name or `METHOD /path`. */
export interface TrackerRequest {
  operation: string;
  variables?: Record<string, unknown> | undefined;
  body?: unknown;
}

/** The `fetch` shape the tracker adapters receive as their injected transport. */
export type Transport = (
  url: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
