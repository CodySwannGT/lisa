import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi } from "../../../src/cli/ui-cmd.js";
import { runConfigSync } from "../../../src/sync/config-sync.js";
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
const LEGACY_LINT_BUDGETS = {
  cognitiveComplexity: 20,
  maxLines: 400,
  maxLinesPerFunction: 100,
};

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

/** Start the endpoint server without the pre-serve sync used by production. */
async function startServer(): Promise<void> {
  resources.server = await runUi(
    resources.dir,
    { port: "0", sync: false },
    { probes: [] }
  );
}

/**
 * Submit a same-origin sparse config write to the active test server.
 * @param changes - Dot-path changes sent by the simulated UI save
 * @param origin - Request origin, defaulting to the active loopback listener
 * @returns Endpoint response
 */
async function postConfigChanges(
  changes: Record<string, unknown>,
  origin = `http://127.0.0.1:${serverPort()}`
): Promise<Response> {
  return fetch(`http://127.0.0.1:${serverPort()}/api/config`, {
    method: "POST",
    headers: {
      "content-type": CONTENT_TYPE_JSON,
      origin,
    },
    body: JSON.stringify({ changes }),
  });
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
  it("rejects non-loopback origins without writing config files", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await postConfigChanges(
      { tracker: "jira" },
      "https://attacker.example"
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
    await startServer();
    const before = await readConfigBytes();

    const response = await postConfigChanges(
      { tracker: "jira" },
      "http://127.0.0.1:9"
    );
    const after = await readConfigBytes();

    expect(response.status).toBe(403);
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("rejects origins with credentials or extra URL components", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await postConfigChanges(
      { tracker: "jira" },
      `http://user@127.0.0.1:${serverPort()}/path`
    );
    const after = await readConfigBytes();

    expect(response.status).toBe(403);
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("rejects malformed write payloads before touching config files", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await postConfigChanges({ "quality..global": 80 });
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
    await startServer();
    const before = await readConfigBytes();

    const response = await postConfigChanges({ tracker: "linear" });
    const body = (await response.json()) as { error: string };
    const after = await readConfigBytes();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Unable to write Lisa config");
    expect(after.committed).toStrictEqual(before.committed);
    expect(after.local).toStrictEqual(before.local);
  });

  it("accepts a same-origin sparse config write", async () => {
    await writeConfigPair();
    await startServer();

    const response = await postConfigChanges({
      "quality.testCoverage.global.statements": 80,
      tracker: "linear",
    });
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
    await startServer();

    const [trackerResponse, thresholdResponse] = await Promise.all([
      postConfigChanges({ tracker: "linear" }),
      postConfigChanges({ "quality.testCoverage.global.statements": 81 }),
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

  it("removes only the edited owner from flat populated provenance", async () => {
    const coverage = { global: { statements: 74 } };
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      quality: {
        lintBudgets: LEGACY_LINT_BUDGETS,
        testCoverage: coverage,
      },
      _lisaSync: {
        populated: {
          "quality.lintBudgets": LEGACY_LINT_BUDGETS,
          "quality.testCoverage": coverage,
        },
      },
    });
    await startServer();

    const response = await postConfigChanges({
      "quality.lintBudgets": {
        cognitiveComplexity: 20,
        maxLines: 425,
        maxLinesPerFunction: 100,
      },
    });
    const committed = JSON.parse(
      await readFile(path.join(resources.dir, CONFIG_FILE), "utf8")
    ) as {
      quality: { lintBudgets: { maxLines: number } };
      _lisaSync: { populated: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(committed.quality.lintBudgets.maxLines).toBe(425);
    expect(committed._lisaSync.populated).toEqual({
      "quality.testCoverage": { global: { statements: 74 } },
    });
  });

  it("keeps a descendant human save through sync while untouched owners evolve", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      quality: { lintBudgets: LEGACY_LINT_BUDGETS },
      wiki: { source: { path: "wiki" }, ttlSeconds: 120 },
      _lisaSync: {
        populated: {
          "quality.lintBudgets": LEGACY_LINT_BUDGETS,
          "wiki.ttlSeconds": 120,
        },
      },
    });
    await startServer();

    const response = await postConfigChanges({
      "quality.lintBudgets.maxLines": 400,
    });
    const report = await runConfigSync(resources.dir);
    const committed = JSON.parse(
      await readFile(path.join(resources.dir, CONFIG_FILE), "utf8")
    ) as {
      quality: { lintBudgets: { maxLines: number } };
      wiki: { ttlSeconds: number };
      _lisaSync: { populated: Record<string, unknown> };
    };

    expect(response.status).toBe(200);
    expect(committed.quality.lintBudgets.maxLines).toBe(400);
    expect(committed.wiki.ttlSeconds).toBe(300);
    expect(
      committed._lisaSync.populated["quality.lintBudgets"]
    ).toBeUndefined();
    expect(
      report.actions.filter(action => action.kind === "default-evolved")
    ).toEqual([
      {
        key: "wiki.ttlSeconds",
        kind: "default-evolved",
        detail: "value still matched the old default; updated to the new one",
      },
    ]);
  });

  it("leaves config bytes and provenance untouched when a write is rejected", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      health: { schedule: "weekly" },
      quality: { lintBudgets: LEGACY_LINT_BUDGETS },
      _lisaSync: {
        populated: {
          "health.schedule": "weekly",
          "quality.lintBudgets": LEGACY_LINT_BUDGETS,
        },
      },
    });
    await startServer();
    const configPath = path.join(resources.dir, CONFIG_FILE);
    const before = await readFile(configPath);

    const response = await postConfigChanges({
      "health.schedule": "hourly",
      "quality.lintBudgets.maxLines": 400,
    });
    const after = await readFile(configPath);
    const committed = JSON.parse(after.toString("utf8")) as {
      _lisaSync: { populated: Record<string, unknown> };
    };

    expect(response.status).toBe(400);
    expect(after).toStrictEqual(before);
    expect(committed._lisaSync.populated).toEqual({
      "health.schedule": "weekly",
      "quality.lintBudgets": {
        cognitiveComplexity: 20,
        maxLines: 400,
        maxLinesPerFunction: 100,
      },
    });
  });
});
