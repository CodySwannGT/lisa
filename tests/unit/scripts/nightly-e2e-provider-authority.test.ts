/**
 * RED authority contract for provider-neutral readback and Sentry discovery.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CONDITION_MARKER,
  TRACKED_SUITE_LABELS,
  existingTracker,
  finding,
  loadProviderActionModule,
  loadProviderSupportModule,
  type ProviderTransport,
  type ProviderTransportRequest,
} from "../../helpers/nightly-e2e-tracking-harness.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const [PLAYWRIGHT, MAESTRO] = TRACKED_SUITE_LABELS;
const RED = [finding(PLAYWRIGHT, "fail"), finding(MAESTRO, "pass")];
const TOKEN = "TRACKING_PROVIDER_SECRET_SENTINEL";
const TITLE = "Nightly E2E condition is red";
const MARKER_TAG = "lisa_nightly_e2e_condition";
const EVENT_ID = "0123456789abcdef0123456789abcdef";
const EXTRA_EVENT_ID = "abcdef0123456789abcdef0123456789";
const OWNED_GROUP = "424242";
const EXTRA_GROUP = "434343";
const SENTRY_BASE = "https://sentry.io/api/0/projects/acme/widgets";
const MARKER_VALUE = JSON.stringify(CONDITION_MARKER);
const SENTRY_QUERY = `is:unresolved ${MARKER_TAG}:${MARKER_VALUE}`;
const SENTRY_ISSUES =
  `${SENTRY_BASE}/issues/?query=${encodeURIComponent(SENTRY_QUERY)}` +
  "&limit=100";
const SENTRY_ORG_ISSUES = "https://sentry.io/api/0/issues";
const FOREIGN_TITLE_CASE =
  "refuses a same-title group whose latest event lacks the marker";

/** Build minimal valid public Sentry configuration. */
function config(): Record<string, unknown> {
  return {
    nightlyE2E: { tracking: { destination: "sentry" } },
    sentry: { org: "acme", project: "widgets" },
  };
}

/** Build the selected adapter's secret-bearing environment. */
function env(): Record<string, string> {
  return {
    PROVIDER_TOKEN: TOKEN,
    SENTRY_ORG: "acme",
    SENTRY_PROJECT: "widgets",
  };
}

/** Read one request's headers. */
function headers(request: ProviderTransportRequest): Record<string, string> {
  return request.options?.headers as Record<string, string>;
}

/** Run the real shipped provider action with one deterministic transport. */
async function run(request: ProviderTransport) {
  const module = await loadProviderActionModule(REPO_ROOT);
  return module.runProviderAction({
    config: config(),
    findings: RED,
    env: env(),
    request,
  });
}

/** Build one exact marker-bearing Sentry event authority. */
function eventAuthority(groupID: string): Record<string, unknown> {
  return {
    eventID: groupID === OWNED_GROUP ? EVENT_ID : EXTRA_EVENT_ID,
    groupID,
    tags: [{ key: MARKER_TAG, value: CONDITION_MARKER }],
  };
}

describe("provider-neutral post-write authority", () => {
  it.each([
    { boundary: "create", present: true },
    { boundary: "refresh", present: true },
    { boundary: "pin", present: true },
    { boundary: "close", present: false },
  ])(
    "$boundary refuses an exact id plus another matching tracker",
    async ({ present }) => {
      const module = await loadProviderSupportModule(REPO_ROOT);
      const calls: string[] = [];
      const list = async (operation: "list" | "readback" = "list") => {
        calls.push(operation);
        return [existingTracker(OWNED_GROUP), existingTracker(EXTRA_GROUP)];
      };

      await expect(
        module.readback("provider", list, OWNED_GROUP, present)
      ).rejects.toThrow(/provider.*readback.*authority/i);
      expect(calls).toEqual(["readback"]);
    }
  );
});

describe("Sentry list authority", () => {
  it(FOREIGN_TITLE_CASE, async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      if (current.url === SENTRY_ISSUES) {
        return [{ id: "foreign", title: TITLE, status: "unresolved" }];
      }
      if (current.url === `${SENTRY_ORG_ISSUES}/foreign/events/latest/`) {
        return { eventID: EVENT_ID, groupID: "foreign", tags: [] };
      }
      throw new Error("write transport reached after foreign Sentry group");
    };
    let message = "";

    try {
      await run(request);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("Requested sentry destination list failed: refused");
    expect(message.length).toBeLessThanOrEqual(4096);
    expect(message).not.toContain(TOKEN);
    expect(calls.map(call => call.operation)).toEqual(["list", "list"]);
    expect(calls.map(call => call.url)).toEqual([
      SENTRY_ISSUES,
      `${SENTRY_ORG_ISSUES}/foreign/events/latest/`,
    ]);
    expect(calls.every(call => (call.options?.method ?? "GET") === "GET")).toBe(
      true
    );
    expect(
      calls.every(call => !Object.hasOwn(call.options ?? {}, "body"))
    ).toBe(true);
    expect(
      calls.every(call => headers(call).Authorization === `Bearer ${TOKEN}`)
    ).toBe(true);
  });

  it("refuses owned plus duplicate groups after event ingestion", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      if (current.url === SENTRY_ISSUES) {
        return current.operation === "list"
          ? []
          : [
              { id: OWNED_GROUP, title: TITLE, status: "unresolved" },
              { id: EXTRA_GROUP, title: TITLE, status: "unresolved" },
            ];
      }
      if (current.url === `${SENTRY_BASE}/keys/`) {
        return [
          { dsn: { public: "https://public-key@ingest.sentry.io/12345" } },
        ];
      }
      if (current.url === "https://ingest.sentry.io/api/12345/store/") {
        return { id: EVENT_ID };
      }
      if (current.url === `${SENTRY_BASE}/events/${EVENT_ID}/`) {
        return eventAuthority(OWNED_GROUP);
      }
      if (
        current.url === `${SENTRY_ORG_ISSUES}/${OWNED_GROUP}/events/latest/`
      ) {
        return eventAuthority(OWNED_GROUP);
      }
      if (
        current.url === `${SENTRY_ORG_ISSUES}/${EXTRA_GROUP}/events/latest/`
      ) {
        return eventAuthority(EXTRA_GROUP);
      }
      throw new Error(`unexpected Sentry request: ${current.url}`);
    };

    await expect(run(request)).rejects.toThrow(
      /sentry destination create failed: readback.*authority/i
    );
    expect(calls.map(call => call.operation)).toEqual([
      "list",
      "create",
      "create",
      "readback",
      "readback",
      "readback",
      "readback",
    ]);
    expect(
      calls.slice(4).every(call => (call.options?.method ?? "GET") === "GET")
    ).toBe(true);
  });
});
