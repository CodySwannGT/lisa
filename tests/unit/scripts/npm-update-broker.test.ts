/** Native socket/child controls establish transport behavior, never hosted provider authority. */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, realpathSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { createConnection } from "node:net";
import { startControllerBroker } from "../../../all/copy-overwrite/scripts/lib/npm-update-controller-broker.mjs";
import { binaryDigest } from "../../../all/copy-overwrite/scripts/lib/npm-update-isolation.mjs";
import { sha256 } from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { readFileSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import { canonicalJson } from "../../../all/copy-overwrite/scripts/lisa-automation-provenance.mjs";
import { invokeControllerRecipe } from "../../../all/copy-overwrite/scripts/lib/npm-update-broker-client.mjs";

const CANONICAL_ENTRY = resolve(
  "all/copy-overwrite/scripts/lisa-work-item.mjs"
);
const CONTRACT_PROBE = "canonical-contract-probe";
const CONTRACT_VERSION = "contract-version";
const SYSTEM_PATH = "/usr/bin:/bin";
const REFUSAL = "controller request refused";

/** Private mkdtemp ownership is checked before any listener or credential; long ambient TMPDIR exceeds Unix bounds. */
function shortBrokerDirectory(bootstrap = false) {
  /* eslint-disable sonarjs/publicly-writable-directories -- mkdtemp creates and checks an owned0700 nonce; Unix sockets require short absolute paths. */
  const prefix = bootstrap
    ? "/tmp/lisa-broker-bootstrap-"
    : "/tmp/lisa-broker-";
  /* eslint-enable sonarjs/publicly-writable-directories -- end the bounded short Unix-socket fixture exception. */
  const root = realpathSync(mkdtempSync(prefix));
  expect(lstatSync(root).mode & 0o077).toBe(0);
  return root;
}

function request(path: string, value: unknown): Promise<any> {
  return new Promise((resolveResult, reject) => {
    const socket = createConnection(path);
    const chunks: Buffer[] = [];
    socket.on("connect", () => socket.end(`${JSON.stringify(value)}\n`));
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        resolveResult(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function withBroker(
  changes: object,
  operation: (broker: any, recipe: any) => Promise<void>
) {
  const root = shortBrokerDirectory();
  const entry = CANONICAL_ENTRY;
  const node = realpathSync(process.execPath);
  const recipe = {
    id: CONTRACT_PROBE,
    command: node,
    args: [entry, CONTRACT_VERSION],
    cwd: root,
    input: Buffer.alloc(0),
    env: { PATH: SYSTEM_PATH, HOME: root },
    allowed: [0],
    timeout: 5000,
    maximum: 65536,
    ...changes,
  };
  let broker;
  try {
    broker = await startControllerBroker({
      root,
      deadline: Date.now() + 10_000,
      graph: { [entry]: sha256(readFileSync(entry)) },
      node: { path: node, sha256: binaryDigest(node) },
      recipes: [recipe],
    });
    await operation(broker, recipe);
  } finally {
    await broker?.close();
    rmSync(root, { recursive: true });
  }
}

describe("closed native controller broker", () => {
  it("runs the genuine canonical helper through its exact non-null instrumented recipe without serializing its credential", async () => {
    // Local graph/token/native-GH fixture tests bootstrap fidelity, not released graph or GitHub authority.
    const root = shortBrokerDirectory(true);
    const entry = CANONICAL_ENTRY;
    const adapter = resolve(
      "all/copy-overwrite/scripts/lib/npm-update-execution-adapter.mjs"
    );
    const node = {
      path: realpathSync(process.execPath),
      version: "22.23.3",
      sha256: binaryDigest(realpathSync(process.execPath)),
    };
    const git = {
      path: realpathSync("/usr/bin/git"),
      version: "native unit control",
      sha256: binaryDigest(realpathSync("/usr/bin/git")),
    };
    const graph = Object.fromEntries(
      [entry, adapter].map(path => [path, sha256(readFileSync(path))])
    );
    const gh = resolve(root, "native-gh-fixture");
    writeFileSync(gh, "#!/bin/sh\nexit 99\n", { mode: 0o700 });
    mkdirSync(resolve(root, "gh-config"), { mode: 0o700 });
    const deadline = Date.now() + 10000;
    const args = [entry, CONTRACT_VERSION];
    const context = {
      version: 3,
      root,
      cwd: root,
      graph,
      routes: [],
      controller: { node, git },
      runtime: { tools: { node } },
      boundary: null,
      provider: {
        version: 1,
        deadline,
        cwd: root,
        home: root,
        nativeGh: { path: gh, sha256: binaryDigest(gh) },
        invocation: { entry, args, cwd: root },
        subject: {
          phase: "stage-read",
          repository: "acme/widgets",
          tracker: "acme/widgets",
          issue: "42",
          branch: `lisa/npm-${"a".repeat(64)}`,
          parent: "b".repeat(40),
          origin: { runId: "10", runAttempt: "1" },
          claim: "123",
          recovery: null,
          maintainer: "maintainer",
          pr: null,
          proofs: [],
        },
      },
    };
    const bytes = `${canonicalJson(context)}\n`;
    writeFileSync(resolve(root, "launcher.json"), bytes, { mode: 0o600 });
    const token = "synthetic-private-broker-token";
    expect(bytes).not.toContain(token);
    let broker;
    try {
      broker = await startControllerBroker({
        root,
        deadline,
        graph,
        node,
        recipes: [
          {
            id: "native-bootstrap",
            command: node.path,
            args,
            cwd: root,
            input: Buffer.alloc(0),
            env: { PATH: "/usr/bin:/bin", HOME: root, GH_TOKEN: token },
            allowed: [0],
            timeout: 5000,
            maximum: 65536,
            context,
          },
        ],
      });
      const result = await invokeControllerRecipe(
        { root, path: broker.path, deadline },
        "native-bootstrap"
      );
      expect(result.code).toBe(0);
      expect(result.stdout.toString()).toMatch(/^\d+\.\d+\.\d+\n$/);
      expect(result.stderr.toString()).toBe("");
    } finally {
      await broker?.close();
      rmSync(root, { recursive: true });
    }
  });

  it("keeps an actual helper refusal nonzero despite the recipe's allowed-zero policy", async () => {
    const entry = resolve("all/copy-overwrite/scripts/lisa-work-item.mjs");
    await withBroker(
      { args: [entry, "unknown-helper-operation"] },
      async (broker, recipe) => {
        const result = await request(broker.path, { recipe: recipe.id });
        expect(result.ok).toBe(true);
        expect(result.code).toBe(1);
        expect(Buffer.from(result.stderr, "base64").toString()).toMatch(
          /Usage:/
        );
      }
    );
  });

  it("never turns an actual capture overflow into a zero exit", async () => {
    await withBroker({ maximum: 1 }, async (broker, recipe) => {
      await expect(
        request(broker.path, { recipe: recipe.id })
      ).resolves.toEqual({
        ok: false,
        error: REFUSAL,
      });
    });
  });

  it("snapshots the controller recipe before a caller attempts to mutate it", async () => {
    await withBroker({}, async (broker, recipe) => {
      recipe.args.splice(0, recipe.args.length, "-e", "process.exit(0)");
      recipe.env.NODE_OPTIONS = "--require=untrusted-file";
      const result = await request(broker.path, { recipe: recipe.id });
      expect(Buffer.from(result.stdout, "base64").toString()).toMatch(
        /^\d+\.\d+\.\d+\n$/
      );
    });
  });
  it("preserves genuine helper results through the closed client transport", async () => {
    const root = shortBrokerDirectory();
    const entry = CANONICAL_ENTRY;
    const node = realpathSync(process.execPath);
    let broker;
    try {
      broker = await startControllerBroker({
        root,
        deadline: Date.now() + 10_000,
        graph: { [entry]: sha256(readFileSync(entry)) },
        node: { path: node, sha256: binaryDigest(node) },
        recipes: [
          {
            id: CONTRACT_PROBE,
            command: node,
            args: [entry, CONTRACT_VERSION],
            cwd: root,
            input: Buffer.alloc(0),
            env: { PATH: SYSTEM_PATH, HOME: root },
            allowed: [0],
            timeout: 5000,
            maximum: 65536,
          },
        ],
      });
      const result = await invokeControllerRecipe(
        { root, path: broker.path, deadline: Date.now() + 5000 },
        CONTRACT_PROBE
      );
      expect(result.code).toBe(0);
      expect(result.stdout.toString()).toMatch(/^\d+\.\d+\.\d+\n$/);
      expect(result.stderr).toEqual(Buffer.alloc(0));
    } finally {
      await broker?.close();
      rmSync(root, { recursive: true });
    }
  });
  it("runs the genuine canonical contract probe and rejects worker-supplied commands", async () => {
    const root = shortBrokerDirectory();
    const entry = CANONICAL_ENTRY;
    const node = realpathSync(process.execPath);
    const recipe = {
      id: CONTRACT_PROBE,
      command: node,
      args: [entry, CONTRACT_VERSION],
      cwd: root,
      input: Buffer.alloc(0),
      env: { PATH: SYSTEM_PATH, HOME: root },
      allowed: [0],
      timeout: 5000,
      maximum: 65536,
    };
    let broker;
    try {
      broker = await startControllerBroker({
        root,
        deadline: Date.now() + 10_000,
        graph: { [entry]: sha256(readFileSync(entry)) },
        node: { path: node, sha256: binaryDigest(node) },
        recipes: [recipe],
      });
      const refused = await request(broker.path, {
        recipe: recipe.id,
        command: "/bin/sh",
        args: ["-c", "exit 0"],
      });
      expect(refused).toEqual({
        ok: false,
        error: REFUSAL,
      });
      const result = await request(broker.path, { recipe: recipe.id });
      expect(result.ok).toBe(true);
      expect(result.code).toBe(0);
      expect(Buffer.from(result.stdout, "base64").toString()).toMatch(
        /^\d+\.\d+\.\d+\n$/
      );
      expect(Buffer.from(result.stderr, "base64").length).toBe(0);
      await expect(
        request(broker.path, { recipe: recipe.id })
      ).resolves.toEqual({
        ok: false,
        error: REFUSAL,
      });
      await expect(
        request(broker.path, { recipe: "unallocated-subject" })
      ).resolves.toEqual({ ok: false, error: REFUSAL });
    } finally {
      await broker?.close();
      rmSync(root, { recursive: true });
    }
  });
});
