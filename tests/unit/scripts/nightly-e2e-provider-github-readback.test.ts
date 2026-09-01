/** RED direct-readback contract for the shipped GitHub provider adapter. */
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
const TRACKER = Object.freeze({
  body: CONDITION_MARKER,
  node_id: "tracker-1",
  number: 42,
});

/**
 * Build one provider-accurate GitHub project config.
 * @returns Public project configuration
 */
function config(): Record<string, unknown> {
  return {
    nightlyE2E: { tracking: { destination: "github" } },
    github: { org: "acme", repo: "widgets" },
  };
}

/**
 * Build the environment consumed by the shipped GitHub adapter.
 * @returns Secret-bearing provider environment
 */
function env(): Record<string, string> {
  return {
    GITHUB_REPOSITORY: "acme/widgets",
    PROVIDER_TOKEN: TOKEN,
  };
}

/**
 * Execute the real shipped GitHub provider action.
 * @param findings - Exact combined nightly findings
 * @param request - Injected JSON transport
 * @returns Provider reconciliation result
 */
async function run(
  findings: typeof RED,
  request: ProviderTransport
): Promise<unknown> {
  const module = await loadProviderActionModule(REPO_ROOT);
  return module.runProviderAction({
    config: config(),
    findings,
    env: env(),
    request,
  });
}

/**
 * Assert and read one direct repository-issues pagination URL.
 * @param call - Captured provider request
 * @returns Positive page number
 */
function directPage(call: ProviderTransportRequest): number {
  const url = new URL(call.url);
  const options = call.options ?? {};
  const headers = (options.headers ?? {}) as Readonly<Record<string, unknown>>;
  expect(url.origin + url.pathname).toBe(
    "https://api.github.com/repos/acme/widgets/issues"
  );
  expect(options.method ?? "GET").toBe("GET");
  expect(options.body).toBeUndefined();
  expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(call.url).not.toContain(TOKEN);
  expect(url.searchParams.get("state")).toBe("open");
  expect(url.searchParams.get("per_page")).toBe("100");
  const page = Number(url.searchParams.get("page"));
  expect(Number.isSafeInteger(page)).toBe(true);
  return page;
}

/**
 * Build a full direct page containing no marker-owned tracker.
 * @returns One hundred foreign issues
 */
function foreignPage(): readonly Record<string, unknown>[] {
  return Array.from({ length: 100 }, (_, index) => ({
    body: `foreign-${index}`,
    node_id: `foreign-${index}`,
    number: index + 1,
  }));
}

describe("GitHub direct issue authority", () => {
  it("follows bounded direct repository pagination", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      return directPage(current) === 1 ? foreignPage() : [];
    };

    await expect(run(GREEN, request)).resolves.toMatchObject({
      action: "none",
      destination: "github",
    });
    expect(calls.map(directPage)).toEqual([1, 2]);
  });

  it("reads a created issue back without search-index dependence", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      if (current.operation === "create") return TRACKER;
      if (current.operation === "pin") {
        return { data: { pinIssue: { issue: { id: TRACKER.node_id } } } };
      }
      return current.operation === "list" ? [] : [TRACKER];
    };

    await expect(run(RED, request)).resolves.toMatchObject({
      action: "create",
      destination: "github",
      trackerId: TRACKER.node_id,
    });
    expect(calls.map(call => call.operation)).toEqual([
      "list",
      "create",
      "readback",
      "pin",
      "readback",
    ]);
    for (const call of calls.filter(current =>
      ["list", "readback"].includes(current.operation)
    )) {
      expect(directPage(call)).toBe(1);
      expect(call.url).not.toContain("/search/issues");
    }
  });

  it("refuses an endless full-page response within ten reads", async () => {
    const calls: ProviderTransportRequest[] = [];
    const request: ProviderTransport = async current => {
      calls.push(current);
      return foreignPage();
    };

    await expect(run(GREEN, request)).rejects.toThrow(
      "Requested github destination list failed: refused"
    );
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.length).toBeLessThanOrEqual(10);
    expect(calls.every(call => call.operation === "list")).toBe(true);
  });

  it.each([null, {}, { items: [] }, [null], [{}]])(
    "refuses malformed direct issue payload %j",
    async payload => {
      const calls: ProviderTransportRequest[] = [];
      const request: ProviderTransport = async current => {
        calls.push(current);
        return payload;
      };

      await expect(run(GREEN, request)).rejects.toThrow(
        "Requested github destination list failed: refused"
      );
      expect(calls.map(call => call.operation)).toEqual(["list"]);
    }
  );

  it.each([null, {}, { data: null }, { errors: [{ message: TOKEN }] }])(
    "refuses malformed GraphQL pin envelope %j without secret echo",
    async payload => {
      const calls: ProviderTransportRequest[] = [];
      const request: ProviderTransport = async current => {
        calls.push(current);
        if (current.operation === "create") return TRACKER;
        if (current.operation === "pin") return payload;
        return current.operation === "list" ? [] : [TRACKER];
      };
      let message = "";

      try {
        await run(RED, request);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toBe("Requested github destination pin failed: refused");
      expect(message).not.toContain(TOKEN);
      expect(calls.map(call => call.operation)).toEqual([
        "list",
        "create",
        "readback",
        "pin",
      ]);
    }
  );
});
