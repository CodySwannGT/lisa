import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi } from "../../../src/cli/ui-cmd.js";
import type { ProbeResult, StatusProbe } from "../../../src/cli/ui-cmd.js";
import type { JsonValue } from "../../../src/sync/json-path.js";

/** Mutable resources owned by each real-server test. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

const resources: TestResources = { dir: "", server: undefined };
const UNKNOWN_STATE = "unknown" as const;
const VALUE_STATE = "value" as const;
const NOT_APPLICABLE_STATE = "not-applicable" as const;
const GITHUB_AUTH_PROBE_ID = "github-auth";
const NOT_AUTHENTICATED_REASON = "not-authenticated";
const GITHUB_NOT_AUTHENTICATED = "GitHub CLI is not authenticated";
const CACHE_CONTROL_HEADER = "cache-control";

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-status-api-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (resources.server !== undefined) {
    await new Promise(resolve => resources.server?.close(resolve));
    resources.server = undefined;
  }
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Construct one bounded probe for the endpoint fixture.
 * @param id - Stable endpoint key
 * @param run - Abort-aware probe operation
 * @param timeoutMs - Maximum probe duration
 * @returns A probe definition for the real server
 */
function probe<T extends JsonValue>(
  id: string,
  run: (signal: AbortSignal) => Promise<ProbeResult<T>>,
  timeoutMs = 50
): StatusProbe<T> {
  return { id, run, timeoutMs };
}

/**
 * Fetch and validate the current real-server status response.
 * @returns Probe results keyed by probe identifier
 */
async function readStatus(): Promise<Record<string, ProbeResult>> {
  const address = resources.server?.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const response = await fetch(`http://127.0.0.1:${port}/api/status`);
  const body = (await response.json()) as {
    probes: Record<string, ProbeResult>;
  };
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^application\/json/);
  expect(response.headers.get(CACHE_CONTROL_HEADER)).toBe("no-store");
  return body.probes;
}

/**
 * Require invalid probe definitions to fail before a server is returned.
 * @param probes - Invalid probe definitions
 * @param pattern - Expected startup error
 */
async function expectStartupRejected(
  probes: readonly StatusProbe[],
  pattern: RegExp
): Promise<void> {
  try {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes }
    );
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(pattern);
    return;
  }
  throw new Error("Expected invalid probes to be rejected before startup");
}

describe("probe registration", () => {
  it.each(["", " ", "\t"])("rejects a blank probe id: %o", async id => {
    await expectStartupRejected(
      [probe(id, async () => ({ state: VALUE_STATE, value: true }))],
      /probe id/i
    );
  });

  it("rejects duplicate probe ids", async () => {
    await expectStartupRejected(
      [
        probe("same", async () => ({ state: VALUE_STATE, value: 1 })),
        probe("same", async () => ({ state: VALUE_STATE, value: 2 })),
      ],
      /duplicate.*probe id/i
    );
  });
});

describe("GET /api/status", () => {
  it("shares one in-flight snapshot across concurrent requests", async () => {
    let release: ((result: ProbeResult<number>) => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const run = vi.fn(
      async () =>
        await new Promise<ProbeResult<number>>(resolve => {
          release = resolve;
          markStarted?.();
        })
    );
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [probe("shared", run)] }
    );
    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;

    const requests = [
      fetch(`http://127.0.0.1:${port}/api/status`),
      fetch(`http://127.0.0.1:${port}/api/status`),
    ];
    await started;
    const invocationCount = run.mock.calls.length;
    release?.({ state: VALUE_STATE, value: 7 });
    const responses = await Promise.all(requests);

    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(invocationCount).toBe(1);
  });

  it("routes by pathname and advertises the allowed status methods", async () => {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe("healthy", async () => ({ state: VALUE_STATE, value: 1 })),
        ],
      }
    );
    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}/api/status`;

    const queried = await fetch(`${base}?x=1`);
    const head = await fetch(base, { method: "HEAD" });
    const posted = await fetch(base, { method: "POST" });

    expect(queried.status).toBe(200);
    expect(queried.headers.get(CACHE_CONTROL_HEADER)).toBe("no-store");
    expect(head.status).toBe(200);
    expect(head.headers.get(CACHE_CONTROL_HEADER)).toBe("no-store");
    expect(posted.status).toBe(405);
    expect(posted.headers.get("allow")).toBe("GET, HEAD");
  });

  it("serves tri-state probe results as same-origin JSON", async () => {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe(GITHUB_AUTH_PROBE_ID, async () => ({
            state: UNKNOWN_STATE,
            reason: NOT_AUTHENTICATED_REASON,
            message: GITHUB_NOT_AUTHENTICATED,
          })),
          probe("optional-service", async () => ({
            state: NOT_APPLICABLE_STATE,
          })),
        ],
      }
    );

    const probes = await readStatus();
    expect(probes[GITHUB_AUTH_PROBE_ID]).toEqual({
      state: UNKNOWN_STATE,
      reason: NOT_AUTHENTICATED_REASON,
      message: GITHUB_NOT_AUTHENTICATED,
    });
    expect(probes[GITHUB_AUTH_PROBE_ID]).not.toHaveProperty("value");
    expect(probes["optional-service"]).toEqual({
      state: NOT_APPLICABLE_STATE,
    });
  });

  it("isolates throwing and timing-out probes so a sibling still returns", async () => {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe("healthy", async () => ({ state: VALUE_STATE, value: 42 })),
          probe("throwing", async () => {
            throw new Error("boom");
          }),
          probe(
            "hanging",
            () => new Promise<ProbeResult<string>>(() => undefined),
            10
          ),
        ],
      }
    );

    const startedAt = Date.now();
    const probes = await readStatus();
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(probes.healthy).toEqual({ state: VALUE_STATE, value: 42 });
    expect(probes.throwing).toMatchObject({
      state: UNKNOWN_STATE,
      reason: "probe-failed",
    });
    expect(probes.hanging).toMatchObject({
      state: UNKNOWN_STATE,
      reason: "timeout",
    });
  });

  it("serves a page with a hook for rendering live statuses", async () => {
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe(GITHUB_AUTH_PROBE_ID, async () => ({
            state: UNKNOWN_STATE,
            reason: NOT_AUTHENTICATED_REASON,
            message: GITHUB_NOT_AUTHENTICATED,
          })),
        ],
      }
    );

    const address = resources.server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toMatch(/LISA_LIVE_STATUS|fetch\s*\(\s*["']\/api\/status["']/);
  });
});
