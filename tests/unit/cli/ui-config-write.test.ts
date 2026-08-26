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
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runUi } from "../../../src/cli/ui-cmd.js";
import { persistRoutedConfigChanges } from "../../../src/cli/ui-config-write-persistence.js";
import {
  getAtPath,
  type JsonObject,
  type JsonValue,
} from "../../../src/sync/json-path.js";
import { SYNC_REGISTRY } from "../../../src/sync/registry.js";
import { writeJson } from "../../../src/utils/index.js";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

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
const execFileAsync = promisify(execFile);
const CONFIG_FILE = ".lisa.config.json";
const LOCAL_CONFIG_FILE = ".lisa.config.local.json";
const CONTENT_TYPE_JSON = "application/json";
const MAX_CONFIG_BYTES = 128 * 1024;
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
 * Post exact request bytes so malformed UTF-8 and ambiguous JSON reach the
 * HTTP parser without JavaScript normalizing them first.
 * @param body - Exact bytes supplied as the request entity
 * @returns Endpoint response
 */
async function postRawBody(body: Buffer | string): Promise<Response> {
  return await fetch(`http://127.0.0.1:${serverPort()}/api/config`, {
    method: "POST",
    headers: {
      "content-type": CONTENT_TYPE_JSON,
      origin: `http://127.0.0.1:${serverPort()}`,
    },
    body,
  });
}

/**
 * Build a strict JSON config whose surgical schedule update lands at the exact
 * requested byte size. The expected form is intentionally hardcoded instead
 * of calling the renderer under test.
 * @param prospectiveBytes - Desired byte length after `off` becomes `daily`
 * @returns Source document two bytes smaller than the prospective document
 */
function configBeforeScheduleGrowth(prospectiveBytes: number): string {
  const fixedProspective = JSON.stringify({
    padding: "",
    health: { schedule: "daily" },
  });
  const paddingBytes = prospectiveBytes - Buffer.byteLength(fixedProspective);
  return JSON.stringify({
    padding: "x".repeat(paddingBytes),
    health: { schedule: "off" },
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

/**
 * Run one persistence transaction in a separate Bun process after a shared
 * start marker appears.
 * @param projectRoot - Real or aliased project directory
 * @param key - Committed dot path written by this child
 * @param value - JSON value persisted at the dot path
 * @param ready - Per-child marker proving imports completed
 * @param start - Shared marker releasing all ready children together
 * @returns Child completion once the transaction succeeds
 */
async function runConfigWriteChild(
  projectRoot: string,
  key: string,
  value: JsonValue,
  ready: string,
  start: string
): Promise<void> {
  const moduleUrl = pathToFileURL(
    path.resolve("src/cli/ui-config-write-persistence.ts")
  ).href;
  const script = [
    `const { persistRoutedConfigChanges } = await import(${JSON.stringify(moduleUrl)});`,
    'const { access, writeFile } = await import("node:fs/promises");',
    "const [projectRoot, key, valueText, ready, start] = process.argv.slice(-5);",
    'await writeFile(ready, "ready");',
    "while (true) { try { await access(start); break; } catch { await new Promise(resolve => setTimeout(resolve, 2)); } }",
    "await persistRoutedConfigChanges(projectRoot, { committed: { [key]: JSON.parse(valueText) }, local: {} }, () => undefined);",
  ].join(" ");
  await execFileAsync(
    "bun",
    ["--eval", script, projectRoot, key, JSON.stringify(value), ready, start],
    { cwd: path.resolve(".") }
  );
}

describe("POST /api/config", () => {
  it("rejects invalid UTF-8 request bytes before config I/O", async () => {
    await writeConfigPair();
    await startServer();
    const before = await readConfigBytes();
    const privateValue = "must-not-appear";
    const invalidUtf8 = Buffer.concat([
      Buffer.from(`{"changes":{"atlassian.email":"${privateValue}`),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"}}'),
    ]);

    const response = await postRawBody(invalidUtf8);
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(responseText).not.toContain(privateValue);
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it.each([
    '{"changes":{"health.schedule":"daily"},"changes":{"health.schedule":"weekly"}}',
    '{"changes":{"quality.testCoverage":{"global":{"statements":80,"statements":81}}}}',
    '{"changes":{"quality.testCoverage":[{"statements":80,"statements":81}]}}',
  ])(
    "rejects duplicate request properties recursively before config I/O",
    async duplicateBody => {
      await writeConfigPair();
      await startServer();
      const before = await readConfigBytes();

      const response = await postRawBody(duplicateBody);

      expect(response.status).toBe(400);
      expect(await readConfigBytes()).toStrictEqual(before);
    }
  );

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

  it("byte-preserves unrelated committed and local spans during mixed owner reconciliation", async () => {
    const stalePrivateEmail = "stale-private@example.test";
    const freshPrivateEmail = "fresh-private@example.test";
    const unrelatedCommitted = '  "unrelatedCommitted": {"odd" : [4,  5,6]}';
    const unrelatedLocal = '\t"unrelatedLocal": {"odd" : [3,  2,1]}';
    const committedBefore = [
      "{",
      '  "quality": {"testCoverage":{"global":{"statements":74,"branches":73}}, "keep" : "committed-sibling"},',
      `  "atlassian": {"email":"${stalePrivateEmail}","keep":"committed-atlassian"},`,
      unrelatedCommitted,
      "}",
      "",
    ].join("\n");
    const localBefore = [
      "{",
      '\t"quality": {"testCoverage":{"global":{"statements":61,"branches":62}}, "keep" : "local-sibling"},',
      unrelatedLocal,
      "}",
      "",
    ].join("\n");
    await writeFile(path.join(resources.dir, CONFIG_FILE), committedBefore);
    await writeFile(path.join(resources.dir, LOCAL_CONFIG_FILE), localBefore);
    await startServer();

    const response = await postChanges({
      "quality.testCoverage.global.statements": 88,
      "atlassian.email": freshPrivateEmail,
    });
    const responseText = await response.text();
    const committedAfter = await readFile(
      path.join(resources.dir, CONFIG_FILE),
      "utf8"
    );
    const localAfter = await readFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE),
      "utf8"
    );

    expect(response.status).toBe(200);
    expect(responseText).not.toContain(stalePrivateEmail);
    expect(responseText).not.toContain(freshPrivateEmail);
    expect(committedAfter).toContain(unrelatedCommitted);
    expect(localAfter).toContain(unrelatedLocal);
    expect(
      getAtPath(
        JSON.parse(committedAfter) as JsonObject,
        "quality.testCoverage.global.statements"
      )
    ).toBe(88);
    expect(
      getAtPath(JSON.parse(committedAfter) as JsonObject, "atlassian.email")
    ).toBeUndefined();
    expect(
      getAtPath(JSON.parse(localAfter) as JsonObject, "atlassian.email")
    ).toBe(freshPrivateEmail);
    expect(
      getAtPath(
        JSON.parse(localAfter) as JsonObject,
        "quality.testCoverage.global.statements"
      )
    ).toBeUndefined();
    expect(
      getAtPath(
        JSON.parse(localAfter) as JsonObject,
        "quality.testCoverage.global.branches"
      )
    ).toBe(62);
  });

  it("applies multiple committed and local insertions and removals without offset drift", async () => {
    const unrelatedCommitted = [
      '  "unrelatedCommitted": {',
      '    "odd" : [9,  8,7],',
      '    "keepSpacing"  :true',
      "  }",
    ].join("\n");
    const unrelatedLocal = [
      '\t"unrelatedLocal": {',
      '\t\t"odd" : [3,  2,1],',
      '\t\t"keepSpacing"  :true',
      "\t}",
    ].join("\n");
    await writeFile(
      path.join(resources.dir, CONFIG_FILE),
      [
        "{",
        '  "atlassian": {"email":"stale@example.test", "keep" : "committed-atlassian"},',
        '  "intake": {"assignee":"stale-user", "keep" : "committed-intake"},',
        '  "health": {"schedule":"off", "keep" : "committed-health"},',
        unrelatedCommitted,
        "}",
        "",
      ].join("\n")
    );
    await writeFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE),
      [
        "{",
        '\t"quality": {"testCoverage":{"global":{"statements":61,"branches":62,"functions":63}}, "keep" : "local-quality"},',
        '\t"health": {"schedule":"weekly", "keep" : "local-health"},',
        unrelatedLocal,
        "}",
        "",
      ].join("\n")
    );
    await startServer();

    const response = await postChanges({
      "quality.testCoverage.global.statements": 88,
      "quality.testCoverage.global.branches": 87,
      "health.schedule": "daily",
      "atlassian.email": "fresh@example.test",
      "intake.assignee": "fresh-user",
      "playStore.serviceAccountKeyPath": "/private/fresh.json",
    });
    const responseText = await response.text();
    const committedAfter = await readFile(
      path.join(resources.dir, CONFIG_FILE),
      "utf8"
    );
    const localAfter = await readFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE),
      "utf8"
    );
    const committed = JSON.parse(committedAfter) as JsonObject;
    const local = JSON.parse(localAfter) as JsonObject;

    expect(response.status).toBe(200);
    expect(responseText).not.toContain("fresh@example.test");
    expect(responseText).not.toContain("fresh-user");
    expect(responseText).not.toContain("/private/fresh.json");
    expect(committedAfter).toContain(unrelatedCommitted);
    expect(localAfter).toContain(unrelatedLocal);
    expect(getAtPath(committed, "quality.testCoverage.global")).toEqual({
      statements: 88,
      branches: 87,
    });
    expect(getAtPath(committed, "health.schedule")).toBe("daily");
    expect(getAtPath(committed, "atlassian.email")).toBeUndefined();
    expect(getAtPath(committed, "atlassian.keep")).toBe("committed-atlassian");
    expect(getAtPath(committed, "intake.assignee")).toBeUndefined();
    expect(getAtPath(committed, "intake.keep")).toBe("committed-intake");
    expect(getAtPath(local, "quality.testCoverage.global")).toEqual({
      functions: 63,
    });
    expect(getAtPath(local, "quality.keep")).toBe("local-quality");
    expect(getAtPath(local, "health.schedule")).toBeUndefined();
    expect(getAtPath(local, "health.keep")).toBe("local-health");
    expect(getAtPath(local, "atlassian.email")).toBe("fresh@example.test");
    expect(getAtPath(local, "intake.assignee")).toBe("fresh-user");
    expect(getAtPath(local, "playStore.serviceAccountKeyPath")).toBe(
      "/private/fresh.json"
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

  it("moves a local-owned value out of committed config without exposing it", async () => {
    const stalePrivateEmail = "stale.private@example.test";
    const currentPrivateEmail = "current.private@example.test";
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      atlassian: { email: stalePrivateEmail, keep: "committed-sibling" },
      health: { schedule: "off" },
    });
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
      github: { repo: PRIVATE_LOCAL_REPO },
    });
    await startServer();

    const response = await postChanges({
      "atlassian.email": currentPrivateEmail,
    });
    const responseText = await response.text();
    const committed = await readConfig(CONFIG_FILE);
    const local = await readConfig(LOCAL_CONFIG_FILE);

    expect(response.status).toBe(200);
    expect(responseText).not.toContain(stalePrivateEmail);
    expect(responseText).not.toContain(currentPrivateEmail);
    expect(getAtPath(committed, "atlassian.email")).toBeUndefined();
    expect(getAtPath(committed, "atlassian.keep")).toBe("committed-sibling");
    expect(getAtPath(local, "atlassian.email")).toBe(currentPrivateEmail);
    expect(getAtPath(local, "github.repo")).toBe(PRIVATE_LOCAL_REPO);
  });

  it.each([
    { shadow: "scalar-shadow", label: "scalar" },
    { shadow: ["array-shadow"], label: "array" },
  ] as const)(
    "rejects a $label ancestor that shadows routed owner cleanup",
    async ({ shadow }) => {
      await writeJson(path.join(resources.dir, CONFIG_FILE), {
        quality: { testCoverage: { global: { statements: 74 } } },
      });
      await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
        quality: shadow,
        atlassian: { email: "private-before@example.test" },
      });
      await startServer();
      const before = await readConfigBytes();

      const response = await postChanges({
        "quality.testCoverage.global.statements": 80,
        "atlassian.email": "private-after@example.test",
      });
      const responseText = await response.text();

      expect(response.status).toBe(500);
      expect(responseText).not.toContain("scalar-shadow");
      expect(responseText).not.toContain("array-shadow");
      expect(responseText).not.toContain("private-before@example.test");
      expect(responseText).not.toContain("private-after@example.test");
      expect(await readConfigBytes()).toStrictEqual(before);
    }
  );

  it.each([
    {
      key: "quality.testCoverage.global.statements",
      value: 80,
      expectedSibling: 62,
      removesRoot: false,
    },
    {
      key: "quality.testCoverage",
      value: {
        global: { statements: 80, branches: 81, functions: 82, lines: 83 },
      },
      expectedSibling: undefined,
      removesRoot: true,
    },
  ] as const)(
    "removes routed committed residue from local config for $key",
    async ({ key, value, expectedSibling, removesRoot }) => {
      await writeJson(path.join(resources.dir, CONFIG_FILE), {
        quality: { retained: "committed-sibling" },
      });
      await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {
        quality: {
          testCoverage: {
            global: { statements: 61, branches: 62 },
          },
          retained: "local-sibling",
        },
      });
      await startServer();

      const response = await postChanges({ [key]: value });
      const committed = await readConfig(CONFIG_FILE);
      const local = await readConfig(LOCAL_CONFIG_FILE);

      expect(response.status).toBe(200);
      expect(getAtPath(committed, key)).toEqual(value);
      expect(getAtPath(local, key)).toBeUndefined();
      expect(getAtPath(local, "quality.retained")).toBe("local-sibling");
      expect(getAtPath(committed, "quality.retained")).toBe(
        "committed-sibling"
      );
      expect(getAtPath(local, "quality.testCoverage.global.branches")).toBe(
        expectedSibling
      );
      expect(getAtPath(local, "quality.testCoverage") === undefined).toBe(
        removesRoot
      );
    }
  );

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

  it("prevalidates the non-owner document before publishing an owner change", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      health: { schedule: "off" },
    });
    await writeFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE),
      '{"atlassian": /* malformed */}\n'
    );
    await startServer();
    const committedBefore = await readFile(
      path.join(resources.dir, CONFIG_FILE)
    );
    const localBefore = await readFile(
      path.join(resources.dir, LOCAL_CONFIG_FILE)
    );

    const response = await postChanges({ "health.schedule": "daily" });

    expect(response.status).toBe(500);
    expect(await readFile(path.join(resources.dir, CONFIG_FILE))).toEqual(
      committedBefore
    );
    expect(await readFile(path.join(resources.dir, LOCAL_CONFIG_FILE))).toEqual(
      localBefore
    );
  });

  it.each([
    '{"quality":{"testCoverage":{"global":{"statements":71}},"testCoverage":{"global":{"statements":72}}}}\n',
    '{"quality":{"testCoverage":{"global":{"statements":71}}},"quality":{"testCoverage":{"global":{"statements":72}}}}\n',
  ])(
    "rejects duplicate changed-path or ancestor keys without mutating bytes",
    async duplicateCommitted => {
      await writeFile(
        path.join(resources.dir, CONFIG_FILE),
        duplicateCommitted
      );
      await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {});
      await startServer();
      const before = await readConfigBytes();

      const response = await postChanges({
        "quality.testCoverage.global.statements": 80,
      });

      expect(response.status).toBe(500);
      expect(await readConfigBytes()).toStrictEqual(before);
    }
  );

  it("rejects invalid UTF-8 without normalizing or mutating raw bytes", async () => {
    const invalidUtf8 = Buffer.concat([
      Buffer.from('{"handAuthored":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('","health":{"schedule":"off"}}\n'),
    ]);
    await writeFile(path.join(resources.dir, CONFIG_FILE), invalidUtf8);
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {});
    await startServer();
    const before = await readConfigBytes();

    const response = await postChanges({ "health.schedule": "daily" });

    expect(response.status).toBe(500);
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

  it(
    "serializes successful writes from separate processes",
    async () => {
      await writeJson(path.join(resources.dir, CONFIG_FILE), {
        padding: "x".repeat(96 * 1024),
        quality: { testCoverage: { global: {} } },
      });
      await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {});
      const start = path.join(resources.dir, "children.start");
      const firstReady = path.join(resources.dir, "first.ready");
      const secondReady = path.join(resources.dir, "second.ready");
      const first = runConfigWriteChild(
        resources.dir,
        "quality.testCoverage.global.statements",
        81,
        firstReady,
        start
      );
      const second = runConfigWriteChild(
        resources.dir,
        "quality.testCoverage.global.branches",
        82,
        secondReady,
        start
      );
      await vi.waitFor(async () => {
        await expect(stat(firstReady)).resolves.toBeDefined();
        await expect(stat(secondReady)).resolves.toBeDefined();
      });
      await writeFile(start, "start");

      await Promise.all([first, second]);
      const committed = await readConfig(CONFIG_FILE);

      expect(
        getAtPath(committed, "quality.testCoverage.global.statements")
      ).toBe(81);
      expect(getAtPath(committed, "quality.testCoverage.global.branches")).toBe(
        82
      );
    },
    ioLatencyBudgetMs(20_000)
  );

  it("canonicalizes symlink aliases onto one write transaction", async () => {
    await writeJson(path.join(resources.dir, CONFIG_FILE), {
      quality: { testCoverage: { global: {} } },
    });
    await writeJson(path.join(resources.dir, LOCAL_CONFIG_FILE), {});
    const alias = path.join(resources.dir, "project-alias");
    await symlink(".", alias, "dir");

    await Promise.all([
      persistRoutedConfigChanges(
        resources.dir,
        {
          committed: { "quality.testCoverage.global.statements": 81 },
          local: {},
        },
        () => undefined
      ),
      persistRoutedConfigChanges(
        alias,
        {
          committed: { "quality.testCoverage.global.branches": 82 },
          local: {},
        },
        () => undefined
      ),
    ]);

    const committed = await readConfig(CONFIG_FILE);
    expect(getAtPath(committed, "quality.testCoverage.global.statements")).toBe(
      81
    );
    expect(getAtPath(committed, "quality.testCoverage.global.branches")).toBe(
      82
    );
  });

  it.each(["root", "ancestor"] as const)(
    "rejects a byte-identical $case replacement during validation without writing it",
    async replacementCase => {
      const ancestor = path.join(resources.dir, "holder");
      const projectRoot = path.join(ancestor, "project");
      const moved = path.join(resources.dir, "moved-holder");
      await mkdir(projectRoot, { recursive: true });
      const committedText = '{"health":{"schedule":"off"}}\n';
      const localText = "{}\n";
      await writeFile(path.join(projectRoot, CONFIG_FILE), committedText);
      await writeFile(path.join(projectRoot, LOCAL_CONFIG_FILE), localText);

      await expect(
        persistRoutedConfigChanges(
          projectRoot,
          { committed: { "health.schedule": "daily" }, local: {} },
          () => {
            if (replacementCase === "root") {
              renameSync(projectRoot, moved);
              mkdirSync(projectRoot);
            } else {
              renameSync(ancestor, moved);
              mkdirSync(projectRoot, { recursive: true });
            }
            writeFileSync(path.join(projectRoot, CONFIG_FILE), committedText);
            writeFileSync(path.join(projectRoot, LOCAL_CONFIG_FILE), localText);
          }
        )
      ).rejects.toThrow("Config project root changed during write");

      expect(await readFile(path.join(projectRoot, CONFIG_FILE), "utf8")).toBe(
        committedText
      );
      expect(
        await readFile(path.join(projectRoot, LOCAL_CONFIG_FILE), "utf8")
      ).toBe(localText);
    }
  );

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

  it("rejects a concurrent mode change before replacing local config", async () => {
    await writeConfigPair();
    const localTarget = path.join(resources.dir, LOCAL_CONFIG_FILE);
    await chmod(localTarget, 0o644);
    const localBefore = await readFile(localTarget);

    await expect(
      persistRoutedConfigChanges(
        resources.dir,
        {
          committed: {},
          local: { "atlassian.email": "private@example.test" },
        },
        () => chmodSync(localTarget, 0o600)
      )
    ).rejects.toThrow(`${LOCAL_CONFIG_FILE} changed before atomic replacement`);

    expect(await readFile(localTarget)).toEqual(localBefore);
    expect((await stat(localTarget)).mode & 0o777).toBe(0o600);
  });

  it("rejects a changed read-only target before replacement", async () => {
    await writeConfigPair();
    await chmod(path.join(resources.dir, CONFIG_FILE), 0o444);
    await startServer();
    const before = await readConfigBytes();

    const response = await postChanges({ "health.schedule": "daily" });

    expect(response.status).toBe(500);
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("rejects a mixed write when either target is read-only", async () => {
    await writeConfigPair();
    await chmod(path.join(resources.dir, LOCAL_CONFIG_FILE), 0o444);
    await startServer();
    const before = await readConfigBytes();

    const response = await postChanges({
      "health.schedule": "daily",
      "atlassian.email": "private@example.test",
    });

    expect(response.status).toBe(500);
    expect(await readConfigBytes()).toStrictEqual(before);
  });

  it("preserves an explicitly permissive existing mode despite umask", async () => {
    await writeConfigPair();
    await chmod(path.join(resources.dir, CONFIG_FILE), 0o666);
    await startServer();
    const previousUmask = process.umask(0o077);
    try {
      const response = await postChanges({ "health.schedule": "daily" });
      expect(response.status).toBe(200);
    } finally {
      process.umask(previousUmask);
    }

    expect(
      (await stat(path.join(resources.dir, CONFIG_FILE))).mode & 0o777
    ).toBe(0o666);
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

  it("accepts a prospective config exactly at the 128 KiB safety limit", async () => {
    await writeFile(
      path.join(resources.dir, CONFIG_FILE),
      configBeforeScheduleGrowth(MAX_CONFIG_BYTES)
    );
    await writeFile(path.join(resources.dir, LOCAL_CONFIG_FILE), "{}\n");
    await startServer();

    const response = await postChanges({ "health.schedule": "daily" });

    expect(response.status).toBe(200);
    expect(
      (await readFile(path.join(resources.dir, CONFIG_FILE))).byteLength
    ).toBe(MAX_CONFIG_BYTES);
  });

  it("rejects an over-limit prospective config before either target publishes", async () => {
    await writeFile(
      path.join(resources.dir, CONFIG_FILE),
      configBeforeScheduleGrowth(MAX_CONFIG_BYTES + 1)
    );
    await writeFile(path.join(resources.dir, LOCAL_CONFIG_FILE), "{}\n");
    await startServer();
    const before = await readConfigBytes();
    const privateValue = "private-over-limit@example.test";

    const response = await postChanges({
      "health.schedule": "daily",
      "atlassian.email": privateValue,
    });
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).not.toContain(privateValue);
    expect(await readConfigBytes()).toStrictEqual(before);
  });
});
/* eslint-enable max-lines, sonarjs/no-duplicate-string -- restore repository test defaults */
