/* eslint-disable max-lines, sonarjs/no-duplicate-string -- one endpoint contract keeps cross-file all-or-nothing assertions beside routing and filesystem safety cases. */
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi } from "../../../src/cli/ui-cmd.js";
import {
  getAtPath,
  type JsonObject,
  type JsonValue,
} from "../../../src/sync/json-path.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { writeJson } from "../../../src/utils/index.js";

/** Mutable resources owned by each write-endpoint test. */
interface TestResources {
  dir: string;
  server: Server | undefined;
}

/** Raw config snapshots used to prove all-or-nothing request rejection. */
interface ConfigBytes {
  readonly committed: Buffer;
  readonly local: Buffer;
}

const resources: TestResources = { dir: "", server: undefined };
const CONFIG_FILE = ".lisa.config.json";
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";
const CONTENT_TYPE_JSON = "application/json";
const PRIVATE_LOCAL_REPO = "private-local";
const LOCAL_ONLY_CHANGES: Readonly<Record<string, JsonValue>> = {
  "atlassian.email": "operator@example.test",
  "intake.assignee": "operator-id",
  "playStore.serviceAccountKeyPath": "/private/play-store-key.json",
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

/** Start a write-endpoint server for the current isolated project. */
async function startServer(): Promise<void> {
  resources.server = await runUi(
    resources.dir,
    { port: "0", sync: false },
    { probes: [] }
  );
}

/**
 * Post sparse changes through the real loopback HTTP endpoint.
 * @param changes - Dot-path values to route and persist
 * @returns Endpoint response
 */
async function postChanges(
  changes: Readonly<Record<string, JsonValue>>
): Promise<Response> {
  return await fetch(`http://127.0.0.1:${serverPort()}/api/config`, {
    method: "POST",
    headers: {
      "content-type": CONTENT_TYPE_JSON,
      origin: `http://127.0.0.1:${serverPort()}`,
    },
    body: JSON.stringify({ changes }),
  });
}

/**
 * Read config files as raw bytes for no-partial-write assertions.
 * @returns Raw committed/local config bytes
 */
async function readConfigBytes(): Promise<ConfigBytes> {
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

/**
 * Parse one config document after the endpoint has written it.
 * @param filename - Committed or local config filename
 * @returns Strict JSON object
 */
async function readConfig(filename: string): Promise<JsonObject> {
  return JSON.parse(
    await readFile(path.join(resources.dir, filename), "utf8")
  ) as JsonObject;
}

describe("POST /api/config", () => {
  it("rejects non-loopback origins without writing config files", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ changes: { "health.schedule": "daily" } }),
      }
    );
    const body = (await response.json()) as { error: string };
    const after = await readConfigBytes();

    expect(response.status).toBe(403);
    expect(body.error).toContain("http://127.0.0.1");
    expect(after).toStrictEqual(before);
  });

  it("rejects a different loopback origin port without writing config files", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: "http://127.0.0.1:9",
        },
        body: JSON.stringify({ changes: { "health.schedule": "daily" } }),
      }
    );

    expect(response.status).toBe(403);
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("rejects origins with credentials or extra URL components", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await fetch(
      `http://127.0.0.1:${serverPort()}/api/config`,
      {
        method: "POST",
        headers: {
          "content-type": CONTENT_TYPE_JSON,
          origin: `http://user@127.0.0.1:${serverPort()}/path`,
        },
        body: JSON.stringify({ changes: { "health.schedule": "daily" } }),
      }
    );

    expect(response.status).toBe(403);
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("routes registry descendants to committed config and byte-preserves unrelated text", async () => {
    const committedBefore = [
      "{",
      '  "handAuthored": {"spacing" : [1,  2,3]},',
      '  "quality": {',
      '    "testCoverage": {"global": {"statements": 74, "branches": 73}}',
      "  }",
      "}",
      "",
    ].join("\n");
    await writeFile(path.join(resources.dir, CONFIG_FILE), committedBefore);
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
      github: { repo: PRIVATE_LOCAL_REPO },
    });
    const localBefore = await readFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE)
    );
    await startServer();

    const response = await postChanges({
      "quality.testCoverage.global.statements": 80,
    });
    const committedAfter = await readFile(
      path.join(resources.dir, CONFIG_FILE),
      "utf8"
    );

    expect(response.status).toBe(200);
    expect(committedAfter).toBe(committedBefore.replace("74", "80"));
    expect(committedAfter).toContain('"handAuthored": {"spacing" : [1,  2,3]}');
    expect(await readFile(path.join(resources.dir, LOCAL_CONFIG_FILE))).toEqual(
      localBefore
    );
  });

  it("derives committed roots from every live SYNC_REGISTRY entry", async () => {
    await writeConfigPair();
    await startServer();
    const registryChanges = Object.fromEntries(
      SYNC_REGISTRY.map(entry => [entry.key, entry.defaultValue])
    );

    const response = await postChanges(registryChanges);
    const committed = await readConfig(CONFIG_FILE);
    const local = await readConfig(LOCAL_CONFIG_FILE);

    expect(response.status).toBe(200);
    SYNC_REGISTRY.forEach(entry => {
      expect(getAtPath(committed, entry.key)).toEqual(entry.defaultValue);
      expect(getAtPath(local, entry.key)).toBeUndefined();
    });
  });

  it("routes every console-authorized local key without committed leakage", async () => {
    await writeConfigPair();
    await startServer();

    const response = await postChanges(LOCAL_ONLY_CHANGES);
    const committed = await readConfig(CONFIG_FILE);
    const local = await readConfig(LOCAL_CONFIG_FILE);

    expect(response.status).toBe(200);
    Object.entries(LOCAL_ONLY_CHANGES).forEach(([key, value]) => {
      expect(getAtPath(local, key)).toBe(value);
      expect(getAtPath(committed, key)).toBeUndefined();
    });
  });

  it("prevalidates and writes a mixed-target request while returning committed data only", async () => {
    await writeConfigPair();
    await startServer();
    const privateEmail = "private.operator@example.test";

    const response = await postChanges({
      "quality.testCoverage.global.statements": 82,
      "atlassian.email": privateEmail,
    });
    const responseText = await response.text();
    const result = JSON.parse(responseText) as {
      ok: boolean;
      config: JsonObject;
    };

    expect(response.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(
      getAtPath(result.config, "quality.testCoverage.global.statements")
    ).toBe(82);
    expect(getAtPath(result.config, "atlassian.email")).toBeUndefined();
    expect(responseText).not.toContain(privateEmail);
    expect(
      getAtPath(await readConfig(CONFIG_FILE), "atlassian.email")
    ).toBeUndefined();
    expect(
      getAtPath(await readConfig(LOCAL_CONFIG_FILE), "atlassian.email")
    ).toBe(privateEmail);
  });

  it.each([
    "tracker",
    "jira.verified_workflow_hash",
    "quality.testCoverageUnexpected",
    "qualityish.testCoverage",
    "atlassian.email.backup",
    "playStore.serviceAccountKeyPath.backup",
  ])(
    "rejects unknown or lookalike key %s before either target changes",
    async key => {
      await writeConfigPair();
      await startServer();
      const before = await readConfigBytes();
      const privateValue = "must-not-be-echoed";

      const response = await postChanges({
        "health.schedule": "daily",
        [key]: privateValue,
      });
      const body = (await response.json()) as { error: string };

      expect(response.status).toBe(400);
      expect(body.error).toBe(`Config key "${key}" is not writable`);
      expect(body.error).not.toContain(privateValue);
      expect(await readConfigBytes()).toStrictEqual(before);
    }
  );

  it("rejects invalid registry values before either mixed target changes", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await postChanges({
      "health.schedule": "hourly",
      "atlassian.email": "private@example.test",
    });
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(responseText).not.toContain("private@example.test");
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("rejects malformed strict JSON without partially writing the other target", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      quality: { testCoverage: { global: { statements: 74 } } },
    });
    const malformedLocal =
      '{\n  "atlassian": { /* JSONC is not allowed */ }\n}\n';
    await writeFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE),
      malformedLocal
    );
    await startServer();
    const before = await readConfigBytes();

    const response = await postChanges({
      "quality.testCoverage.global.statements": 83,
      "atlassian.email": "private@example.test",
    });

    expect(response.status).toBe(500);
    expect((await response.json()) as { error: string }).toEqual({
      error: "Unable to write Lisa config",
    });
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("rejects non-object config documents without replacing them", async () => {
    await writeFile(path.join(resources.dir, CONFIG_FILE), "[]\n");
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {});
    await startServer();
    const before = await readConfigBytes();

    const response = await postChanges({ "health.schedule": "weekly" });

    expect(response.status).toBe(500);
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("serializes concurrent committed and local writes without lost changes", async () => {
    await writeConfigPair();
    await startServer();
    const writes: readonly Readonly<Record<string, JsonValue>>[] = [
      { "quality.testCoverage.global.statements": 81 },
      { "quality.testCoverage.global.branches": 82 },
      { "quality.testCoverage.global.functions": 83 },
      { "quality.testCoverage.global.lines": 84 },
      { "atlassian.email": "concurrent@example.test" },
      { "intake.assignee": "concurrent-user" },
      { "playStore.serviceAccountKeyPath": "/private/concurrent.json" },
    ];

    const responses = await Promise.all(writes.map(postChanges));
    const committed = await readConfig(CONFIG_FILE);
    const local = await readConfig(LOCAL_CONFIG_FILE);

    expect(responses.map(response => response.status)).toEqual(
      writes.map(() => 200)
    );
    expect(getAtPath(committed, "quality.testCoverage.global")).toEqual({
      statements: 81,
      branches: 82,
      functions: 83,
      lines: 84,
    });
    expect(getAtPath(local, "atlassian.email")).toBe("concurrent@example.test");
    expect(getAtPath(local, "intake.assignee")).toBe("concurrent-user");
    expect(getAtPath(local, "playStore.serviceAccountKeyPath")).toBe(
      "/private/concurrent.json"
    );
  });

  it.each([
    "__proto__.polluted",
    "quality.__proto__.polluted",
    "constructor.prototype.polluted",
  ])("rejects prototype-pollution path %s", async key => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();

    const response = await postChanges({ [key]: "polluted" });

    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toEqual({
      error: `Config key "${key}" is not writable`,
    });
    expect(({} as { polluted?: string }).polluted).toBeUndefined();
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("refuses committed and local config symlinks without changing their targets", async () => {
    const externalCommitted = path.join(
      resources.dir,
      "external-committed.json"
    );
    const externalLocal = path.join(resources.dir, "external-local.json");
    await writeFile(externalCommitted, '{"health":{"schedule":"off"}}\n');
    await writeFile(externalLocal, "{}\n");
    await symlink(externalCommitted, path.join(resources.dir, CONFIG_FILE));
    await symlink(externalLocal, path.join(resources.dir, LOCAL_CONFIG_FILE));
    await startServer();

    const response = await postChanges({
      "health.schedule": "daily",
      "atlassian.email": "private@example.test",
    });

    expect(response.status).toBe(500);
    expect(await readFile(externalCommitted, "utf8")).toBe(
      '{"health":{"schedule":"off"}}\n'
    );
    expect(await readFile(externalLocal, "utf8")).toBe("{}\n");
    expect(
      (await lstat(path.join(resources.dir, CONFIG_FILE))).isSymbolicLink()
    ).toBe(true);
    expect(
      (
        await lstat(path.join(resources.dir, LOCAL_CONFIG_FILE))
      ).isSymbolicLink()
    ).toBe(true);
  });

  it("refuses non-regular config entries before opening them", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {});
    await mkdir(path.join(resources.dir, LOCAL_CONFIG_FILE));
    await startServer();
    const committedBefore = await readFile(
      path.join(resources.dir, CONFIG_FILE)
    );

    const response = await postChanges({
      "health.schedule": "daily",
      "atlassian.email": "private@example.test",
    });

    expect(response.status).toBe(500);
    expect(await readFile(path.join(resources.dir, CONFIG_FILE))).toEqual(
      committedBefore
    );
    expect(
      (await lstat(path.join(resources.dir, LOCAL_CONFIG_FILE))).isDirectory()
    ).toBe(true);
  });

  it("preserves existing file modes across atomic replacements", async () => {
    await writeConfigPair();
    await chmod(path.join(resources.dir, CONFIG_FILE), 0o640);
    await chmod(path.join(resources.dir, LOCAL_CONFIG_FILE), 0o604);
    await startServer();

    const response = await postChanges({
      "health.schedule": "daily",
      "atlassian.email": "private@example.test",
    });

    expect(response.status).toBe(200);
    expect(
      (await stat(path.join(resources.dir, CONFIG_FILE))).mode & 0o777
    ).toBe(0o640);
    expect(
      (await stat(path.join(resources.dir, LOCAL_CONFIG_FILE))).mode & 0o777
    ).toBe(0o604);
  });

  it("creates a missing local config with owner-only permissions", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {});
    await startServer();

    const response = await postChanges({
      "atlassian.email": "private@example.test",
    });

    expect(response.status).toBe(200);
    expect(
      (await stat(path.join(resources.dir, LOCAL_CONFIG_FILE))).mode & 0o777
    ).toBe(0o600);
  });

  it("skips atomic replacement when every routed value is already current", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      health: { schedule: "daily" },
    });
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
      atlassian: { email: "private@example.test" },
    });
    const committedBefore = await stat(path.join(resources.dir, CONFIG_FILE), {
      bigint: true,
    });
    const localBefore = await stat(
      path.join(resources.dir, LOCAL_CONFIG_FILE),
      {
        bigint: true,
      }
    );
    await startServer();

    const response = await postChanges({
      "health.schedule": "daily",
      "atlassian.email": "private@example.test",
    });
    const committedAfter = await stat(path.join(resources.dir, CONFIG_FILE), {
      bigint: true,
    });
    const localAfter = await stat(path.join(resources.dir, LOCAL_CONFIG_FILE), {
      bigint: true,
    });

    expect(response.status).toBe(200);
    expect([committedAfter.ino, committedAfter.mtimeNs]).toEqual([
      committedBefore.ino,
      committedBefore.mtimeNs,
    ]);
    expect([localAfter.ino, localAfter.mtimeNs]).toEqual([
      localBefore.ino,
      localBefore.mtimeNs,
    ]);
  });

  it("bounds existing config snapshots before reading their content", async () => {
    const oversized = JSON.stringify({
      handAuthored: "x".repeat(128 * 1024),
    });
    await writeFile(path.join(resources.dir, CONFIG_FILE), oversized);
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {});
    await startServer();
    const localBefore = await readFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE)
    );

    const response = await postChanges({ "health.schedule": "daily" });

    expect(response.status).toBe(500);
    expect(await readFile(path.join(resources.dir, CONFIG_FILE), "utf8")).toBe(
      oversized
    );
    expect(await readFile(path.join(resources.dir, LOCAL_CONFIG_FILE))).toEqual(
      localBefore
    );
  });
});
/* eslint-enable max-lines, sonarjs/no-duplicate-string -- restore repository test defaults */
