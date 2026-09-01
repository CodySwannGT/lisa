/** Provider-accurate transport fixtures for the shipped nightly action. */
import { vi } from "vitest";

import {
  CONDITION_MARKER,
  type ProviderTransport,
  type ProviderTransportRequest,
  type TrackingDestination,
} from "./nightly-e2e-tracking-harness.js";

/** Providers exercised through the shared action boundary. */
export const PROVIDERS = ["github", "sentry", "jira", "linear"] as const;

/** Provider write actions exercised by the common lifecycle matrix. */
export const ACTIONS = ["create", "refresh", "close"] as const;

/** One provider supported by the shipped action. */
export type ProviderDestination = (typeof PROVIDERS)[number];

/** One write action supported by the shipped action. */
export type ProviderAction = (typeof ACTIONS)[number];

const EVENT_ID = "0123456789abcdef0123456789abcdef";
const GROUP_ID = "tracker-1";
const SENTRY_TITLE = "Nightly E2E condition is red";
const SENTRY_MARKER_TAG = "lisa_nightly_e2e_condition";
const TOKEN = "TRACKING_PROVIDER_SECRET_SENTINEL";

/**
 * Build public config used by the real provider action.
 * @param destination - Selected provider
 * @returns Public project configuration
 */
export function providerConfig(
  destination: TrackingDestination
): Record<string, unknown> {
  return {
    nightlyE2E: { tracking: { destination } },
    github: { org: "acme", repo: "widgets" },
    sentry: { org: "acme", project: "widgets" },
    jira: { project: "WID" },
    atlassian: { site: "acme.atlassian.net" },
    linear: { teamKey: "WID" },
  };
}

/**
 * Build secret-bearing environment read only by the selected adapter.
 * @returns Provider environment
 */
export function providerEnv(): Record<string, string> {
  return {
    GITHUB_REPOSITORY: "acme/widgets",
    PROVIDER_TOKEN: TOKEN,
    JIRA_BASE_URL: "https://acme.atlassian.net",
    JIRA_USER_EMAIL: "ci@acme.test",
    JIRA_PROJECT_KEY: "WID",
    LINEAR_TEAM_KEY: "WID",
    SENTRY_ORG: "acme",
    SENTRY_PROJECT: "widgets",
  };
}

/**
 * Build Sentry's distinct event, group, and marker authority payloads.
 * @param request - Current provider request
 * @param active - Whether the condition tracker currently exists
 * @returns Provider-shaped response
 */
function sentryPayload(
  request: ProviderTransportRequest,
  active: boolean
): unknown {
  if (request.url.endsWith("/keys/")) {
    return [{ dsn: { public: "https://public-key@ingest.sentry.io/12345" } }];
  }
  if (request.url === "https://ingest.sentry.io/api/12345/store/") {
    return { id: EVENT_ID };
  }
  if (request.url.endsWith(`/events/${EVENT_ID}/`)) {
    return {
      eventID: EVENT_ID,
      groupID: GROUP_ID,
      tags: [{ key: SENTRY_MARKER_TAG, value: CONDITION_MARKER }],
    };
  }
  if (request.url.endsWith(`/issues/${GROUP_ID}/events/latest/`)) {
    return {
      eventID: EVENT_ID,
      groupID: GROUP_ID,
      tags: [{ key: SENTRY_MARKER_TAG, value: CONDITION_MARKER }],
    };
  }
  return active
    ? [{ id: GROUP_ID, title: SENTRY_TITLE, status: "unresolved" }]
    : [];
}

/**
 * Build GitHub's realistic authority or write response.
 * @param request - Current provider request
 * @param active - Whether the condition tracker currently exists
 * @returns Provider-shaped response
 */
function githubPayload(
  request: ProviderTransportRequest,
  active: boolean
): unknown {
  const record = { id: GROUP_ID, marker: CONDITION_MARKER };
  if (request.url.includes("graphql")) {
    const field = request.operation === "pin" ? "pinIssue" : "unpinIssue";
    return { data: { [field]: { issue: { id: record.id } } } };
  }
  if (["create", "refresh"].includes(request.operation)) {
    return { number: 42, node_id: record.id, body: record.marker };
  }
  return active
    ? [{ number: 42, node_id: record.id, body: record.marker }]
    : [];
}

/**
 * Build Jira's realistic authority or write response.
 * @param request - Current provider request
 * @param active - Whether the condition tracker currently exists
 * @returns Provider-shaped response
 */
function jiraPayload(
  request: ProviderTransportRequest,
  active: boolean
): unknown {
  const record = { id: GROUP_ID, marker: CONDITION_MARKER };
  if (request.url.endsWith("/transitions") && !request.options?.method) {
    return {
      transitions: [{ id: "done-1", to: { statusCategory: { key: "done" } } }],
    };
  }
  if (["create", "refresh"].includes(request.operation)) {
    return { key: "WID-1" };
  }
  return {
    isLast: true,
    issues: active
      ? [{ key: "WID-1", fields: { description: record.marker } }]
      : [],
  };
}

/**
 * Build Linear's realistic authority or write response.
 * @param request - Current provider request
 * @param active - Whether the condition tracker currently exists
 * @returns Provider-shaped response
 */
function linearPayload(
  request: ProviderTransportRequest,
  active: boolean
): unknown {
  const record = { id: GROUP_ID, marker: CONDITION_MARKER };
  if (["create", "refresh", "close"].includes(request.operation)) {
    const key = request.operation === "create" ? "issueCreate" : "issueUpdate";
    return { data: { [key]: { success: true, issue: record } } };
  }
  return {
    data: {
      teams: {
        nodes: [
          {
            id: "team-1",
            states: { nodes: [{ id: "done-1", type: "completed" }] },
            issues: {
              nodes: active ? [{ ...record, description: record.marker }] : [],
            },
          },
        ],
      },
    },
  };
}

/** Provider response fixture sharing one request shape. */
type ProviderPayload = (
  request: ProviderTransportRequest,
  active: boolean
) => unknown;

const PROVIDER_PAYLOADS: Readonly<
  Record<ProviderDestination, ProviderPayload>
> = Object.freeze({
  github: githubPayload,
  jira: jiraPayload,
  linear: linearPayload,
  sentry: sentryPayload,
});

/**
 * Derive condition state without mutable fixture bookkeeping.
 * @param action - Lifecycle action under test
 * @param operation - Current provider operation
 * @returns Whether the condition tracker should be visible
 */
function trackerIsActive(
  action: ProviderAction,
  operation: ProviderTransportRequest["operation"]
): boolean {
  if (action === "create") return operation !== "list";
  if (action === "close") return operation !== "readback";
  return true;
}

/**
 * Fake the selected provider at its JSON transport boundary.
 * @param destination - Selected provider
 * @param action - Lifecycle action under test
 * @returns Captured calls and provider-accurate transport
 */
export function providerTransportFixture(
  destination: ProviderDestination,
  action: ProviderAction
): {
  readonly calls: ProviderTransportRequest[];
  readonly request: ProviderTransport;
} {
  const request = vi.fn<ProviderTransport>(async current =>
    PROVIDER_PAYLOADS[destination](
      current,
      trackerIsActive(action, current.operation)
    )
  );
  return {
    get calls() {
      return request.mock.calls.map(([current]) => current);
    },
    request,
  };
}

/**
 * Build foreign authority returned by a hostile post-write readback.
 * @param destination - Selected provider
 * @returns Provider-shaped foreign payload
 */
export function hostileProviderPayload(
  destination: ProviderDestination
): unknown {
  const marker = "<!-- foreign_nightly_condition -->";
  if (destination === "github") {
    return [{ number: 99, node_id: "foreign", body: marker }];
  }
  if (destination === "jira") {
    return {
      isLast: true,
      issues: [{ key: "WID-99", fields: { description: marker } }],
    };
  }
  if (destination === "linear") {
    return {
      data: {
        teams: {
          nodes: [
            {
              id: "team-1",
              states: { nodes: [] },
              issues: { nodes: [{ id: "foreign", description: marker }] },
            },
          ],
        },
      },
    };
  }
  return {
    eventID: EVENT_ID,
    groupID: "foreign",
    tags: [{ key: SENTRY_MARKER_TAG, value: marker }],
  };
}
