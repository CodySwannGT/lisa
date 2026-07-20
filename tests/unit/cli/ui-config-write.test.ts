/* eslint-disable max-lines -- endpoint security regressions share one server fixture */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi } from "../../../src/cli/ui-cmd.js";
import { writeJson } from "../../../src/utils/index.js";

/** Mutable resources owned by each write-endpoint test. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

const resources: TestResources = { dir: "", server: undefined };
const CONFIG_FILE = ".lisa.config.json";
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";
const CONTENT_TYPE_JSON = "application/json";
const PRIVATE_LOCAL_REPO = "private-local";

beforeEach(async () => {
  resources.dir = await mkdtemp(path.join(tmpdir(), "lisa-ui-config-write-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
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
 * Read the port selected for the current test server.
 * @returns Bound TCP port
 */
function serverPort(): number {
  const address = resources.server?.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/**
 * Read config files as raw bytes for no-partial-write assertions.
 * @returns Raw committed/local config bytes
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

/** Write a pair of config files used by endpoint tests. */
async function writeConfigPair(): Promise<void> {
  await writeJson(path.join(resources.dir, CONFIG_FILE), {
    tracker: "github",
    quality: { testCoverage: { global: { statements: 74 } } },
  });
  await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
    github: { repo: PRIVATE_LOCAL_REPO },
  });
}

describe("POST /api/config", () => {
  it("rejects an invalid health.schedule through the generic registry validator", async () => {
    await writeConfigPair();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://127.0.0.1:${serverPort()}`,
        },
        body: JSON.stringify({ changes: { "health.schedule": "hourly" } }),
      }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/health\.schedule/),
    });
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it.each([
    ["parent", { health: { schedule: "hourly" } }],
    ["descendant", { "health.schedule.unit": "daily" }],
    ["overlap", { "health.schedule": "daily", health: { schedule: "hourly" } }],
  ])(
    "rejects invalid health.schedule introduced through a %s write",
    async (_name, changes) => {
      await writeConfigPair();
      resources.server = await runUi(
        resources.dir,
        { port: "0", sync: false },
        { probes: [] }
      );
      const before = await readConfigBytes();
      const response = await fetch(
        `http://127.0.0.1:${serverPort()}/api/config`,
        {
          method: "POST",
          headers: {
            "content-type": CONTENT_TYPE_JSON,
            origin: `http://127.0.0.1:${serverPort()}`,
          },
          body: JSON.stringify({ changes }),
        }
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringMatching(/health\.schedule/),
      });
      expect(await readConfigBytes()).toStrictEqual(before);
    }
  );

  it("rejects non-loopback origins without writing config files", async () => {
    await writeConfigPair();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ changes: { tracker: "jira" } }),
      }
    );
    const body = (await response.json()) as { error: string };
    const after = await readConfigBytes();

    expect(response.status).toBe(403);
    expect(body.error).toContain("http://127.0.0.1");
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("rejects a different loopback origin port without writing config files", async () => {
    await writeConfigPair();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: "http://127.0.0.1:9",
        },
        body: JSON.stringify({ changes: { tracker: "jira" } }),
      }
    );
    const after = await readConfigBytes();

    expect(response.status).toBe(403);
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("rejects origins with credentials or extra URL components", async () => {
    await writeConfigPair();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://user@127.0.0.1:${serverPort()}/path`,
        },
        body: JSON.stringify({ changes: { tracker: "jira" } }),
      }
    );
    const after = await readConfigBytes();

    expect(response.status).toBe(403);
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("rejects malformed write payloads before touching config files", async () => {
    await writeConfigPair();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://127.0.0.1:${serverPort()}`,
        },
        body: JSON.stringify({ changes: { "quality..global": 80 } }),
      }
    );
    const body = (await response.json()) as { error: string };
    const after = await readConfigBytes();

    expect(response.status).toBe(400);
    expect(body.error).toContain("empty path segment");
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("rejects sparse writes when the committed config is malformed", async () => {
    await writeFile(path.join(resources.dir, CONFIG_FILE), "{bad json");
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
      github: { repo: PRIVATE_LOCAL_REPO },
    });
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://127.0.0.1:${serverPort()}`,
        },
        body: JSON.stringify({ changes: { tracker: "linear" } }),
      }
    );
    const body = (await response.json()) as { error: string };
    const after = await readConfigBytes();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Unable to write Lisa config");
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("accepts a same-origin sparse config write", async () => {
    await writeConfigPair();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://127.0.0.1:${serverPort()}`,
        },
        body: JSON.stringify({
          changes: {
            "quality.testCoverage.global.statements": 80,
            tracker: "linear",
          },
        }),
      }
    );
    const result = (await response.json()) as { ok: boolean };
    const committed = JSON.parse(
      await readFile(path.join(resources.dir, CONFIG_FILE), "utf8")
    ) as {
      tracker: string;
      quality: { testCoverage: { global: { statements: number } } };
    };
    const local = JSON.parse(
      await readFile(path.join(resources.dir, LOCAL_CONFIG_FILE), "utf8")
    ) as { github: { repo: string } };

    expect(response.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(committed).toEqual({
      tracker: "linear",
      quality: { testCoverage: { global: { statements: 80 } } },
    });
    expect(local).toEqual({ github: { repo: PRIVATE_LOCAL_REPO } });
  });

  it("serializes concurrent sparse writes so changes are not lost", async () => {
    await writeConfigPair();
    resources.server = await runUi(
      resources.dir,
      { port: "0", sync: false },
      { probes: [] }
    );

    const [trackerResponse, thresholdResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${serverPort()}/api/config`, {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://127.0.0.1:${serverPort()}`,
        },
        body: JSON.stringify({ changes: { tracker: "linear" } }),
      }),
      fetch(`http://127.0.0.1:${serverPort()}/api/config`, {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://127.0.0.1:${serverPort()}`,
        },
        body: JSON.stringify({
          changes: { "quality.testCoverage.global.statements": 81 },
        }),
      }),
    ]);
    const committed = JSON.parse(
      await readFile(path.join(resources.dir, CONFIG_FILE), "utf8")
    ) as {
      tracker: string;
      quality: { testCoverage: { global: { statements: number } } };
    };

    expect([trackerResponse.status, thresholdResponse.status]).toEqual([
      200, 200,
    ]);
    expect(committed).toEqual({
      tracker: "linear",
      quality: { testCoverage: { global: { statements: 81 } } },
    });
  });
});
/* eslint-enable max-lines -- restore repository defaults */
