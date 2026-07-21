import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runUi } from "../../../src/cli/ui-cmd.js";
import type { UiHealthDependencies } from "../../../src/cli/ui-health.js";
import type {
  HealthReadResult,
  HealthResult,
  PersistedHealthRun,
} from "../../../src/health/index.js";
import { SETUP_READINESS_CHECKS } from "../../../src/health/index.js";

const RESULT: HealthResult = {
  schemaVersion: 1,
  runId: "ui-health-run-1",
  mode: "deterministic",
  startedAt: "2026-07-21T03:40:00.000Z",
  completedAt: "2026-07-21T03:40:01.000Z",
  findings: [
    {
      check: "managed-files",
      layer: "deterministic",
      status: "fail",
      reason: "eslint.config.ts differs from its managed template",
    },
  ],
  summary: {
    verdict: "drift detected",
    counts: { pass: 0, warn: 0, fail: 1 },
  },
};
const SERIALIZED = `${JSON.stringify(RESULT, null, 2)}\n`;
const HEALTH_PATH = "/api/health";
const SETUP_READINESS_PATH = "/api/setup-readiness";
const NO_STORE = "no-store";
const CACHE_CONTROL = "cache-control";

/** Mutable resources owned by each Health endpoint test. */
interface Resources {
  dir: string;
  server: Server | undefined;
}

const resources: Resources = { dir: "", server: undefined };

/** Create a unique project and silence the server banner. */
beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-health-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

/** Close the server and remove its isolated project. */
afterEach(async () => {
  vi.restoreAllMocks();
  if (resources.server !== undefined) {
    resources.server.closeAllConnections();
    await new Promise(resolve => resources.server?.close(resolve));
    resources.server = undefined;
  }
  await rm(resources.dir, { recursive: true, force: true });
});

/**
 * Read the current server's port.
 * @returns OS-assigned port for the test server
 */
function serverPort(): number {
  const address = resources.server?.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/**
 * Start a project-bound UI.
 * @param dependencies - Injected Health boundaries
 * @returns Loopback origin
 */
async function start(
  dependencies: Partial<UiHealthDependencies>
): Promise<string> {
  resources.server = await runUi(
    resources.dir,
    { port: "0", sync: false },
    { probes: [], health: dependencies }
  );
  return `http://127.0.0.1:${serverPort()}`;
}

/**
 * Build a completed Health v1 run.
 * @returns Canonical completed run fixture
 */
function persisted(): PersistedHealthRun {
  return {
    writeOutcome: {
      status: "written",
      path: path.join(resources.dir, ".lisa/health/latest.json"),
      result: RESULT,
    },
    result: RESULT,
    serialized: SERIALIZED,
  };
}

describe("/api/health", () => {
  it("GET returns the stored canonical Health v1 bytes from the bound project", async () => {
    const readLatest = vi.fn(
      async (): Promise<HealthReadResult> => ({
        status: "available",
        result: RESULT,
        lastRun: RESULT.completedAt,
      })
    );
    const base = await start({ readLatest });

    const response = await fetch(`${base}${HEALTH_PATH}`);

    expect(response.status).toBe(200);
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE);
    expect(await response.text()).toBe(SERIALIZED);
    expect(readLatest).toHaveBeenCalledOnce();
    expect(readLatest).toHaveBeenCalledWith(resources.dir);
  });

  it("HEAD confirms the endpoint without reading or running health", async () => {
    const readLatest = vi.fn<UiHealthDependencies["readLatest"]>();
    const runPersisted = vi.fn<UiHealthDependencies["runPersisted"]>();
    const base = await start({ readLatest, runPersisted });

    const response = await fetch(`${base}${HEALTH_PATH}`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE);
    expect(await response.text()).toBe("");
    expect(readLatest).not.toHaveBeenCalled();
    expect(runPersisted).not.toHaveBeenCalled();
  });

  it("reports never-run and rejects unsupported methods without execution", async () => {
    const readLatest = vi.fn(
      async (): Promise<HealthReadResult> => ({ status: "never-run" })
    );
    const runPersisted = vi.fn<UiHealthDependencies["runPersisted"]>();
    const base = await start({ readLatest, runPersisted });

    const missing = await fetch(`${base}${HEALTH_PATH}`);
    const unsupported = await fetch(`${base}${HEALTH_PATH}`, {
      method: "DELETE",
    });

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "No Lisa health result is available",
    });
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, HEAD, POST");
    expect(unsupported.headers.get(CACHE_CONTROL)).toBe(NO_STORE);
    expect(runPersisted).not.toHaveBeenCalled();
  });

  it("POST requires the exact console origin", async () => {
    const runPersisted = vi.fn(async () => persisted());
    const base = await start({ runPersisted });

    const absent = await fetch(`${base}${HEALTH_PATH}`, { method: "POST" });
    const attacker = await fetch(`${base}${HEALTH_PATH}`, {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });

    expect(absent.status).toBe(403);
    expect(attacker.status).toBe(403);
    expect(runPersisted).not.toHaveBeenCalled();
  });

  it("POST coalesces concurrent same-origin runs and returns exact Health v1 JSON", async () => {
    let release: ((value: PersistedHealthRun) => void) | undefined;
    const pending = new Promise<PersistedHealthRun>(resolve => {
      release = resolve;
    });
    const runPersisted = vi.fn(async () => pending);
    const base = await start({ runPersisted });
    const request = (): Promise<Response> =>
      fetch(`${base}${HEALTH_PATH}`, {
        method: "POST",
        headers: { origin: base },
      });

    const first = request();
    const second = request();
    await vi.waitFor(() => expect(runPersisted).toHaveBeenCalledOnce());
    release?.(persisted());
    const responses = await Promise.all([first, second]);

    expect(runPersisted).toHaveBeenCalledWith(resources.dir);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(
      await Promise.all(responses.map(response => response.text()))
    ).toEqual([SERIALIZED, SERIALIZED]);
  });

  it("returns generic no-store failures without exposing filesystem details", async () => {
    const readLatest = vi.fn(
      async (): Promise<HealthReadResult> => ({
        status: "unreadable",
        reason: `/private/secret/${resources.dir}/latest.json`,
      })
    );
    const runPersisted = vi.fn(async () => {
      throw new Error(`/private/secret/${resources.dir}/latest.json`);
    });
    const base = await start({ readLatest, runPersisted });

    const read = await fetch(`${base}${HEALTH_PATH}`);
    const run = await fetch(`${base}${HEALTH_PATH}`, {
      method: "POST",
      headers: { origin: base },
    });
    const readBody = await read.text();
    const runBody = await run.text();

    expect(read.status).toBe(500);
    expect(run.status).toBe(500);
    expect(read.headers.get(CACHE_CONTROL)).toBe(NO_STORE);
    expect(run.headers.get(CACHE_CONTROL)).toBe(NO_STORE);
    expect(readBody).toBe('{"error":"Unable to read Lisa health"}');
    expect(runBody).toBe('{"error":"Unable to run Lisa health"}');
    expect(readBody).not.toContain(resources.dir);
    expect(runBody).not.toContain(resources.dir);
  });
});

describe("/api/setup-readiness", () => {
  it("GET computes current setup readiness for the bound project", async () => {
    const run = vi.fn(
      async (): Promise<HealthResult> => ({
        ...RESULT,
        runId: "setup-readiness-run-1",
        findings: SETUP_READINESS_CHECKS.map(check => ({
          check,
          layer: "deterministic",
          status: "warn",
          reason: `${check} pending`,
        })),
        summary: {
          verdict: "in band",
          counts: { pass: 0, warn: SETUP_READINESS_CHECKS.length, fail: 0 },
        },
      })
    );
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [], setupReadiness: { run } }
    );
    const base = `http://127.0.0.1:${serverPort()}`;

    const response = await fetch(`${base}${SETUP_READINESS_PATH}`);
    const body = (await response.json()) as HealthResult;

    expect(response.status).toBe(200);
    expect(response.headers.get(CACHE_CONTROL)).toBe(NO_STORE);
    expect(run).toHaveBeenCalledWith(resources.dir);
    expect(body.findings.map(finding => finding.check)).toEqual(
      SETUP_READINESS_CHECKS
    );
  });

  it("HEAD and unsupported methods do not run setup readiness", async () => {
    const run = vi.fn();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [], setupReadiness: { run } }
    );
    const base = `http://127.0.0.1:${serverPort()}`;

    const head = await fetch(`${base}${SETUP_READINESS_PATH}`, {
      method: "HEAD",
    });
    const unsupported = await fetch(`${base}${SETUP_READINESS_PATH}`, {
      method: "POST",
    });

    expect(head.status).toBe(200);
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, HEAD");
    expect(run).not.toHaveBeenCalled();
  });
});
