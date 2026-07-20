import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runUi } from "../../../src/cli/ui-cmd.js";
import { writeJson } from "../../../src/utils/index.js";

/** Mutable resources owned by each health-schedule endpoint test. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

const resources: TestResources = { dir: "", server: undefined };
const CONFIG_FILE = ".lisa.config.json";
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";

beforeEach(async () => {
  resources.dir = await mkdtemp(
    path.join(tmpdir(), "lisa-ui-health-schedule-")
  );
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await writeJson(path.join(resources.dir, CONFIG_FILE), {
    tracker: "github",
    quality: { testCoverage: { global: { statements: 74 } } },
  });
  await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
    github: { repo: "private-local" },
  });
  resources.server = await runUi(
    resources.dir,
    { port: "0", sync: false },
    { probes: [] }
  );
});

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
 * Read the selected loopback test port.
 * @returns Bound server port
 */
function serverPort(): number {
  const address = resources.server?.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/**
 * Read raw config bytes for no-partial-write assertions.
 * @returns Committed and local config bytes
 */
async function readConfigBytes(): Promise<{
  committed: Buffer;
  local: Buffer;
}> {
  return {
    committed: await readFile(path.join(resources.dir, CONFIG_FILE)),
    local: await readFile(path.join(resources.dir, LOCAL_CONFIG_FILE)),
  };
}

/**
 * Submit sparse config changes to the same-origin endpoint.
 * @param changes - Sparse config changes
 * @returns Endpoint response
 */
async function submitChanges(changes: Record<string, unknown>) {
  return fetch(`http://127.0.0.1:${serverPort()}/api/config`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: `http://127.0.0.1:${serverPort()}`,
    },
    body: JSON.stringify({ changes }),
  });
}

describe("POST /api/config health.schedule validation", () => {
  it.each([
    ["direct", { "health.schedule": "hourly" }],
    ["parent", { health: { schedule: "hourly" } }],
    ["descendant", { "health.schedule.unit": "daily" }],
    ["overlap", { "health.schedule": "daily", health: { schedule: "hourly" } }],
  ])(
    "rejects invalid health.schedule introduced through a %s write",
    async (_name, changes) => {
      const before = await readConfigBytes();
      const response = await submitChanges(changes);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/health\.schedule/),
      });
      expect(await readConfigBytes()).toStrictEqual(before);
    }
  );
});
