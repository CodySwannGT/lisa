/**
 * RED protocol-fidelity contract for Jira search and Sentry event ingestion.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CONDITION_MARKER,
  TRACKED_SUITE_LABELS,
  finding,
  loadProviderActionModule,
  type ProviderTransport,
  type ProviderTransportRequest,
  type TrackingDestination,
} from "../../helpers/nightly-e2e-tracking-harness.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const [PLAYWRIGHT, MAESTRO] = TRACKED_SUITE_LABELS;
const RED = [finding(PLAYWRIGHT, "fail"), finding(MAESTRO, "pass")];
const GREEN = [finding(PLAYWRIGHT, "pass"), finding(MAESTRO, "pass")];
const TOKEN = "TRACKING_PROVIDER_SECRET_SENTINEL";
const SENTRY_TITLE = "Nightly E2E condition is red";
const SENTRY_MARKER_TAG = "lisa_nightly_e2e_condition";
const EVENT_ID = "0123456789abcdef0123456789abcdef";
const GROUP_ID = "424242";
const SENTRY_DSN = "https://public-key@ingest.sentry.io/12345";
const SENTRY_BASE = "https://sentry.io/api/0/projects/acme/widgets";
const SENTRY_MARKER_VALUE = JSON.stringify(CONDITION_MARKER);
const SENTRY_QUERY = `is:unresolved ${SENTRY_MARKER_TAG}:${SENTRY_MARKER_VALUE}`;
const SENTRY_ISSUES =
  `${SENTRY_BASE}/issues/?query=${encodeURIComponent(SENTRY_QUERY)}` +
  "&limit=100";
const SENTRY_GROUP_EVENT =
  "https://sentry.io/api/0/issues/" + `${GROUP_ID}/events/latest/`;
const JIRA_JQL =
  'project = "WID" AND statusCategory != Done AND description ~ ' +
  `"\\"${CONDITION_MARKER}\\""`;

/**
 * Build the public configuration for one provider.
 * @param destination - Selected provider
 * @returns Public project configuration
 */
function config(destination: TrackingDestination): Record<string, unknown> {
  return {
    nightlyE2E: { tracking: { destination } },
    sentry: { org: "acme", project: "widgets" },
    jira: { project: "WID" },
    atlassian: { site: "acme.atlassian.net" },
  };
}

/**
 * Build provider environment inputs.
 * @returns Secret-bearing provider environment
 */
function env(): Record<string, string> {
  return {
    PROVIDER_TOKEN: TOKEN,
    JIRA_BASE_URL: "https://acme.atlassian.net",
    JIRA_USER_EMAIL: "ci@acme.test",
    JIRA_PROJECT_KEY: "WID",
    SENTRY_ORG: "acme",
    SENTRY_PROJECT: "widgets",
  };
}

/**
 * Read and parse one JSON request body.
 * @param request - Captured provider request
 * @returns Parsed JSON object
 */
function body(request: ProviderTransportRequest): Record<string, unknown> {
  const raw = request.options?.body;
  expect(typeof raw).toBe("string");
  return JSON.parse(String(raw)) as Record<string, unknown>;
}

/**
 * Read one request's headers.
 * @param request - Captured provider request
 * @returns Request header map
 */
function headers(request: ProviderTransportRequest): Record<string, string> {
  return request.options?.headers as Record<string, string>;
}

/**
 * Execute the real provider action with deterministic findings.
 * @param destination - Selected provider
 * @param findings - Exact nightly suite findings
 * @param request - Injected JSON transport
 * @returns Provider reconciliation result
 */
async function run(
  destination: "jira" | "sentry",
  findings: typeof RED,
  request: ProviderTransport
) {
  const module = await loadProviderActionModule(REPO_ROOT);
  return module.runProviderAction({
    config: config(destination),
    findings,
    env: env(),
    request,
  });
}

describe("Jira provider protocol fidelity", () => {
  it("posts an exact bounded project-scoped search", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      return { isLast: true, issues: [] };
    };

    await expect(run("jira", GREEN, request)).resolves.toMatchObject({
      destination: "jira",
      action: "none",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      operation: "list",
      url: "https://acme.atlassian.net/rest/api/3/search/jql",
      options: { method: "POST" },
    });
    expect(headers(calls[0])).toEqual({
      Authorization: `Basic ${Buffer.from(`ci@acme.test:${TOKEN}`).toString(
        "base64"
      )}`,
      "Content-Type": "application/json",
    });
    expect(body(calls[0])).toEqual({
      jql: JIRA_JQL,
      fields: ["description"],
      maxResults: 100,
    });
  });

  it.each([null, {}, { issues: null }])(
    "refuses malformed Jira search payload %j",
    async payload => {
      const calls: ProviderTransportRequest[] = [];
      const request: ProviderTransport = async current => {
        calls.push(current);
        return payload;
      };
      let message = "";

      try {
        await run("jira", GREEN, request);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe("Requested jira destination list failed: refused");
      expect(message.length).toBeLessThanOrEqual(4096);
      expect(message).not.toContain("malformed");
      expect(message).not.toContain(TOKEN);
      expect(calls.map(call => call.operation)).toEqual(["list"]);
    }
  );
});

/** Exact event authority returned by Sentry's authenticated event API. */
interface EventAuthority {
  readonly eventID: string;
  readonly groupID: string;
  readonly tags: readonly { readonly key: string; readonly value: string }[];
}

/**
 * Build a strict Sentry DSN/event/group transport.
 * @param event - Authenticated event authority override
 * @returns Captured calls and strict transport
 */
function sentryFixture(event?: EventAuthority): {
  readonly calls: ProviderTransportRequest[];
  readonly request: ProviderTransport;
} {
  const calls: ProviderTransportRequest[] = [];
  const authority = event ?? {
    eventID: EVENT_ID,
    groupID: GROUP_ID,
    tags: [{ key: SENTRY_MARKER_TAG, value: CONDITION_MARKER }],
  };
  const request: ProviderTransport = async current => {
    calls.push(current);
    if (current.url === SENTRY_ISSUES) {
      return current.operation === "list"
        ? []
        : [{ id: GROUP_ID, title: SENTRY_TITLE, status: "unresolved" }];
    }
    if (current.url === `${SENTRY_BASE}/keys/`) {
      return [{ dsn: { public: SENTRY_DSN } }];
    }
    if (current.url === "https://ingest.sentry.io/api/12345/store/") {
      return { id: EVENT_ID };
    }
    if (current.url === `${SENTRY_BASE}/events/${EVENT_ID}/`) {
      return authority;
    }
    if (current.url === SENTRY_GROUP_EVENT) return authority;
    throw new Error(`unexpected Sentry request: ${current.url}`);
  };
  return { calls, request };
}

describe("Sentry provider protocol fidelity", () => {
  it("uses DSN store and resolves event to owned group", async () => {
    const fixture = sentryFixture();
    await expect(run("sentry", RED, fixture.request)).resolves.toMatchObject({
      destination: "sentry",
      action: "create",
      trackerId: GROUP_ID,
    });
    expect(fixture.calls.map(call => call.operation)).toEqual([
      "list",
      "create",
      "create",
      "readback",
      "readback",
      "readback",
    ]);
    const [, keys, store, event, group, groupEvent] = fixture.calls;
    expect(keys.url).toBe(`${SENTRY_BASE}/keys/`);
    expect(keys.options?.method ?? "GET").toBe("GET");
    expect(keys.options).not.toHaveProperty("body");
    expect(headers(keys).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(store.url).toBe("https://ingest.sentry.io/api/12345/store/");
    expect(store.options?.method).toBe("POST");
    expect(headers(store)).toEqual({
      "Content-Type": "application/json",
      "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=public-key",
    });
    expect(body(store)).toMatchObject({
      message: SENTRY_TITLE,
      fingerprint: [CONDITION_MARKER],
      tags: { [SENTRY_MARKER_TAG]: CONDITION_MARKER },
    });
    expect(event.url).toBe(`${SENTRY_BASE}/events/${EVENT_ID}/`);
    expect(event.options?.method ?? "GET").toBe("GET");
    expect(event.options).not.toHaveProperty("body");
    expect(headers(event).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(group.url).toContain("/issues/?query=");
    expect(group.options?.method ?? "GET").toBe("GET");
    expect(group.options).not.toHaveProperty("body");
    expect(groupEvent.url).toBe(SENTRY_GROUP_EVENT);
    expect(groupEvent.options?.method ?? "GET").toBe("GET");
    expect(groupEvent.options).not.toHaveProperty("body");
    expect(headers(groupEvent).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    {
      eventID: EVENT_ID,
      groupID: EVENT_ID,
      tags: [{ key: SENTRY_MARKER_TAG, value: CONDITION_MARKER }],
    },
    {
      eventID: EVENT_ID,
      groupID: GROUP_ID,
      tags: [{ key: SENTRY_MARKER_TAG, value: "foreign" }],
    },
  ])("refuses conflated or foreign Sentry authority %#", async event => {
    const fixture = sentryFixture(event);
    await expect(run("sentry", RED, fixture.request)).rejects.toThrow(
      /sentry.*readback.*(identity|marker|authority|refused)/i
    );
    expect(fixture.calls.map(call => call.operation)).toEqual([
      "list",
      "create",
      "create",
      "readback",
    ]);
    expect(fixture.calls.map(call => call.operation)).not.toContain("pin");
  });
});
