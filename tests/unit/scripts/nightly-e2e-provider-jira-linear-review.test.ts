/** RED provider-fidelity contract for Jira pagination and Linear close. */
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
const LINEAR_COMPLETED = "completed";
const CANCELED_STATE_ID = "canceled-1";
const JIRA_URL = "https://acme.atlassian.net/rest/api/3/search/jql";
const JIRA_JQL =
  'project = "WID" AND statusCategory != Done AND description ~ ' +
  `"\\"${CONDITION_MARKER}\\""`;

/**
 * Build shared config using established Jira and Linear blocks.
 * @param destination - Selected provider
 * @returns Public project configuration
 */
function config(destination: TrackingDestination): Record<string, unknown> {
  return {
    nightlyE2E: { tracking: { destination } },
    jira: { project: "WID" },
    atlassian: { site: "acme.atlassian.net" },
    linear: { teamKey: "WID" },
  };
}

/**
 * Build the secret-bearing provider environment.
 * @returns Provider environment
 */
function env(): Record<string, string> {
  return {
    JIRA_BASE_URL: "https://acme.atlassian.net",
    JIRA_PROJECT_KEY: "WID",
    JIRA_USER_EMAIL: "ci@acme.test",
    LINEAR_TEAM_KEY: "WID",
    PROVIDER_TOKEN: TOKEN,
  };
}

/**
 * Parse one captured provider request body.
 * @param call - Captured request
 * @returns Parsed JSON body
 */
function body(call: ProviderTransportRequest): Record<string, unknown> {
  expect(typeof call.options?.body).toBe("string");
  return JSON.parse(String(call.options?.body)) as Record<string, unknown>;
}

/**
 * Execute the real shipped adapter boundary.
 * @param destination - Selected provider
 * @param findings - Exact nightly findings
 * @param request - Injected JSON transport
 * @returns Provider reconciliation result
 */
async function run(
  destination: "jira" | "linear",
  findings: typeof RED,
  request: ProviderTransport
): Promise<unknown> {
  const module = await loadProviderActionModule(REPO_ROOT);
  return module.runProviderAction({
    config: config(destination),
    findings,
    env: env(),
    request,
  });
}

/**
 * Build one owned open Jira issue.
 * @returns Jira issue payload
 */
function jiraIssue(): Record<string, unknown> {
  return {
    key: "WID-1",
    fields: { description: CONDITION_MARKER },
  };
}

/**
 * Build one Linear team snapshot with configurable terminal states.
 * @param active - Whether the owned issue is open
 * @param states - Workflow states returned by the team
 * @returns Linear GraphQL envelope
 */
function linearTeam(
  active: boolean,
  states: readonly Record<string, string>[]
): Record<string, unknown> {
  return {
    data: {
      teams: {
        nodes: [
          {
            id: "team-1",
            states: { nodes: states },
            issues: {
              nodes: active
                ? [
                    {
                      id: "linear-1",
                      description: CONDITION_MARKER,
                      state: { type: "started" },
                    },
                  ]
                : [],
            },
          },
        ],
      },
    },
  };
}

describe("Jira enhanced-search authority", () => {
  it("follows exact v3 nextPageToken pagination", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      const token = body(current).nextPageToken;
      return token
        ? { isLast: true, issues: [] }
        : { isLast: false, issues: [], nextPageToken: "page-2" };
    };

    await expect(run("jira", GREEN, request)).resolves.toMatchObject({
      action: "none",
      destination: "jira",
    });
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.url)).toEqual([JIRA_URL, JIRA_URL]);
    expect(calls.map(call => call.options?.method)).toEqual(["POST", "POST"]);
    expect(body(calls[0])).toEqual({
      fields: ["description"],
      jql: JIRA_JQL,
      maxResults: 100,
    });
    expect(body(calls[1])).toEqual({
      fields: ["description"],
      jql: JIRA_JQL,
      maxResults: 100,
      nextPageToken: "page-2",
    });
  });

  it("refuses a repeated Jira page token within a bound", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      return { isLast: false, issues: [], nextPageToken: "repeat" };
    };

    await expect(run("jira", GREEN, request)).rejects.toThrow(
      "Requested jira destination list failed: refused"
    );
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(calls.every(call => call.operation === "list")).toBe(true);
  });

  it("refreshes Jira with only editable summary and description", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      if (current.operation === "refresh") return null;
      return { isLast: true, issues: [jiraIssue()] };
    };

    await expect(run("jira", RED, request)).resolves.toMatchObject({
      action: "refresh",
      destination: "jira",
    });
    expect(calls.map(call => call.operation)).toEqual([
      "list",
      "refresh",
      "readback",
    ]);
    const refresh = calls[1];
    expect(body(refresh)).toEqual({
      fields: {
        description: expect.stringContaining(CONDITION_MARKER),
        summary: "Nightly E2E condition is red",
      },
    });
    expect(String(refresh.options?.body)).not.toMatch(
      /issuetype|labels|project/u
    );
  });
});

describe("Linear completed-state close authority", () => {
  it("chooses the sole completed state while excluding canceled", async () => {
    const states = [
      { id: "done-1", type: LINEAR_COMPLETED },
      { id: CANCELED_STATE_ID, type: "canceled" },
    ];
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      if (current.operation === "close") {
        return { data: { issueUpdate: { success: true } } };
      }
      return linearTeam(current.operation !== "readback", states);
    };

    await expect(run("linear", GREEN, request)).resolves.toMatchObject({
      action: "close",
      destination: "linear",
    });
    expect(calls.map(call => call.operation)).toEqual([
      "list",
      "close",
      "readback",
    ]);
    expect(body(calls[1])).toMatchObject({
      variables: { id: "linear-1", state: "done-1" },
    });
    expect(String(calls[1].options?.body)).not.toContain(CANCELED_STATE_ID);
  });

  it("refuses multiple completed states before mutation", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      return linearTeam(true, [
        { id: "done-1", type: LINEAR_COMPLETED },
        { id: "done-2", type: LINEAR_COMPLETED },
        { id: CANCELED_STATE_ID, type: "canceled" },
      ]);
    };

    await expect(run("linear", GREEN, request)).rejects.toThrow(
      "Requested linear destination close failed: refused"
    );
    expect(calls.map(call => call.operation)).toEqual(["list"]);
  });
});
