import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi } from "../../../src/cli/ui-cmd.js";
import type { ProbeResult, StatusProbe } from "../../../src/cli/ui-cmd.js";
import type { JsonValue } from "../../../src/sync/json-path.js";

/** Mutable resources owned by each real-server serialization test. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

const resources: TestResources = { dir: "", server: undefined };
const UNKNOWN_STATE = "unknown" as const;
const VALUE_STATE = "value" as const;
const NOT_APPLICABLE_STATE = "not-applicable" as const;
const NON_SERIALIZABLE_REASON = "non-serializable-value";

beforeEach(async () => {
  resources.dir = await mkdtemp(
    path.join(tmpdir(), "lisa-ui-status-json-api-")
  );
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
 * Create one status probe for the endpoint fixture.
 * @param id - Stable endpoint key
 * @param run - Abort-aware probe operation
 * @param timeoutMs - Maximum probe duration
 * @returns Status probe definition
 */
function probe<T extends JsonValue>(
  id: string,
  run: (signal: AbortSignal) => Promise<ProbeResult<T>>,
  timeoutMs = 50
): StatusProbe<T> {
  return { id, run, timeoutMs };
}

/**
 * Read the probe map from the current real server.
 * @returns Current normalized probe results
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
  return body.probes;
}

describe("GET /api/status serialization isolation", () => {
  it("degrades a circular value without breaking a healthy sibling", async () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe("healthy", async () => ({ state: VALUE_STATE, value: 42 })),
          probe("circular", async () => ({
            state: VALUE_STATE,
            value: circular as JsonValue,
          })),
        ],
      }
    );

    const probes = await readStatus();
    expect(probes.healthy).toEqual({ state: VALUE_STATE, value: 42 });
    expect(probes.circular).toMatchObject({
      state: UNKNOWN_STATE,
      reason: NON_SERIALIZABLE_REASON,
    });
    expect(probes.circular).not.toHaveProperty("value");
  });

  it("rejects accessors and hidden serialization hooks per probe", async () => {
    const accessorValue = Object.defineProperty({}, "changing", {
      enumerable: true,
      get: () => 1,
    });
    const customSerialization = Object.defineProperty({}, "toJSON", {
      value: () => BigInt(1),
    });
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe("healthy", async () => ({ state: VALUE_STATE, value: 42 })),
          probe("accessor", async () => ({
            state: VALUE_STATE,
            value: accessorValue as JsonValue,
          })),
          probe("custom-serialization", async () => ({
            state: VALUE_STATE,
            value: customSerialization as JsonValue,
          })),
        ],
      }
    );

    const probes = await readStatus();
    expect(probes.healthy).toEqual({ state: VALUE_STATE, value: 42 });
    for (const id of ["accessor", "custom-serialization"]) {
      expect(probes[id]).toMatchObject({
        state: UNKNOWN_STATE,
        reason: NON_SERIALIZABLE_REASON,
      });
      expect(probes[id]).not.toHaveProperty("value");
    }
  });

  it("rejects hidden serialization hooks on result wrappers", async () => {
    const unknownResult = Object.defineProperty(
      {
        state: UNKNOWN_STATE,
        reason: "not-authenticated",
        message: "GitHub CLI is not authenticated",
      },
      "toJSON",
      { value: () => ({ state: VALUE_STATE, value: "fabricated" }) }
    ) as ProbeResult;
    const notApplicableResult = Object.defineProperty(
      { state: NOT_APPLICABLE_STATE },
      "toJSON",
      { value: () => ({ state: VALUE_STATE, value: "fabricated" }) }
    ) as ProbeResult;
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe("healthy", async () => ({ state: VALUE_STATE, value: 42 })),
          probe("unknown-wrapper", async () => unknownResult),
          probe("not-applicable-wrapper", async () => notApplicableResult),
        ],
      }
    );

    const probes = await readStatus();
    expect(probes.healthy).toEqual({ state: VALUE_STATE, value: 42 });
    for (const id of ["unknown-wrapper", "not-applicable-wrapper"]) {
      expect(probes[id]).toMatchObject({
        state: UNKNOWN_STATE,
        reason: NON_SERIALIZABLE_REASON,
      });
      expect(probes[id]).not.toHaveProperty("value");
    }
  });

  it("isolates invalid timeouts while healthy siblings still return", async () => {
    const invalidRun = vi.fn(async () => ({
      state: VALUE_STATE,
      value: "should-not-run",
    }));
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      {
        probes: [
          probe("healthy", async () => ({ state: VALUE_STATE, value: 42 })),
          probe("negative", invalidRun, -1),
          probe("not-a-number", invalidRun, Number.NaN),
          probe("infinite", invalidRun, Number.POSITIVE_INFINITY),
        ],
      }
    );

    const probes = await readStatus();
    expect(probes.healthy).toEqual({ state: VALUE_STATE, value: 42 });
    for (const id of ["negative", "not-a-number", "infinite"]) {
      expect(probes[id]).toMatchObject({
        state: UNKNOWN_STATE,
        reason: "invalid-timeout",
      });
    }
    expect(invalidRun).not.toHaveBeenCalled();
  });
});
