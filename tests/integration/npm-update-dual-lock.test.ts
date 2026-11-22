/** Native registry installations expose lock coherence independently of provider fixtures. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { cleanupTempDir } from "../helpers/test-utils.js";
import { suiteDeferral } from "../support/ci-runtime.js";
import { bunFreeNodeBin } from "./support/bun-free-node-bin.js";
import { prepareNativeUpdate as prepareUpdate } from "./support/npm-update-native-prepare.js";
import {
  pathBunIsNative,
  requireNativeBun,
} from "./support/native-path-bun.js";
import {
  ALIAS_LOCK,
  ALIASES,
  baseline,
  BUN_LOCK_FILE,
  copyCheckout,
  deferred,
  FILES,
  FROZEN,
  INSTALL_FLAGS,
  NPM_LOCK_FILE,
  PACKAGE_FILE,
  parseBunLock,
  ROOT_ALIAS,
  ROOT_IDENTITY,
  ROOT_TARGET,
  ROOT_VERSION,
  seeded,
  SEEDED,
  VERSION,
} from "./support/npm-update-dual-lock-fixture.js";
import {
  qualifiedBun,
  verifyBunLock,
} from "../../all/copy-overwrite/scripts/lib/npm-update-bun.mjs";
import {
  runNpm,
  runProcess,
  withPrivateRoot,
} from "../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";

useIoLatencyBudget();
/** The shared alias baseline: its private root, environment and checkout. */
interface AliasBaseline {
  root: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

// Both alias cases need the same genuine baseline, so it is installed once and
// each case works on its own copy. The corrupted-identity probes need only that
// coherent lock, not an update or frozen installs, so they are a case of their
// own (CodySwannGT/lisa#5040).
describe.skipIf(
  suiteDeferral(
    pathBunIsNative,
    "a native (non-symlinked) Bun first on PATH",
    "Put the real Bun executable ahead of any npm-global or shim `bun`, e.g. `mise use bun@1.4.4`."
  ) !== undefined
)("native registry alias locks", () => {
  let shared: AliasBaseline | undefined;
  let held: Promise<void> | undefined;
  let releaseRoot: () => void = () => undefined;

  /**
   * The shared baseline, or the reason it is missing.
   * @returns The baseline beforeAll installed.
   */
  function current(): AliasBaseline {
    if (shared === undefined)
      throw new Error("alias baseline unavailable: its beforeAll failed");
    return shared;
  }

  // Promises rather than events, so neither side depends on which runs first:
  // a release that arrives before the root is ready (a timed-out beforeAll)
  // still lets the root close, and a failure after ready reaches afterAll's
  // `await held` instead of an emitter with no listener.
  beforeAll(async () => {
    const release = deferred<void>();
    releaseRoot = () => release.resolve();
    const ready = deferred<AliasBaseline>();
    held = withPrivateRoot(async (root, privateEnv) => {
      const env = seeded(root, privateEnv);
      const { cwd } = await baseline(root, env, true, ALIASES, ALIAS_LOCK);
      ready.resolve({ root, env, cwd });
      await release.promise;
    });
    shared = await Promise.race([
      ready.promise,
      held.then(() => {
        throw new Error("alias baseline root closed before it was ready");
      }),
    ]);
  });

  afterAll(async () => {
    releaseRoot();
    await held;
    if (shared !== undefined) expect(existsSync(shared.root)).toBe(false);
  });

  it("preserves genuine root and transitive registry aliases", async () => {
    const base = current();
    const { env } = base;
    const observed = await (async () => {
      const { cwd, bun } = copyCheckout(
        base.cwd,
        join(base.root, "preserve"),
        env
      );
      const originalBun = readFileSync(join(cwd, BUN_LOCK_FILE));
      const originalNpm = JSON.parse(
        readFileSync(join(cwd, NPM_LOCK_FILE), "utf8")
      );
      expect(originalNpm.packages[`node_modules/${ROOT_ALIAS}`].name).toBe(
        ROOT_TARGET
      );
      const parent = originalNpm.packages["node_modules/pretty-format"];
      expect(parent.dependencies["@jest/react-is-18"]).toBe(
        "npm:react-is@^18.3.1"
      );
      expect(parent.dependencies["@jest/react-is-19"]).toBe(
        "npm:react-is@^19.2.5"
      );
      for (const alias of ["@jest/react-is-18", "@jest/react-is-19"])
        expect(originalNpm.packages[`node_modules/${alias}`].name).toBe(
          "react-is"
        );
      const native = await qualifiedBun(env);
      const parse = () => parseBunLock(native, cwd);
      const before = await parse();
      expect(before.packages[ROOT_ALIAS][0]).toBe(ROOT_IDENTITY);
      const prepared = await prepareUpdate({ cwd, ...SEEDED }, env);
      expect(prepared.status).toBe("prepared");
      if (!("proposal" in prepared) || !("installedAfter" in prepared.npm))
        throw new Error("native alias preparation did not produce an update");
      expect(prepared.npm.installedAfter).toEqual({ "is-number": VERSION });
      expect(prepared.proposal.bunLockSha256).toBe(
        createHash("sha256").update(originalBun).digest("hex")
      );
      const files = Object.keys(prepared.proposal.files).sort((a, b) =>
        a.localeCompare(b)
      );
      expect(files).toEqual(FILES);
      for (const [file, bytes] of Object.entries(prepared.proposal.files)) {
        if (typeof bytes !== "string")
          throw new Error("non-text proposal file");
        writeFileSync(join(cwd, file), bytes, { mode: 0o600 });
      }
      const snapshot = files.map(file => ({
        file,
        bytes: readFileSync(join(cwd, file)),
      }));
      const frozenNpm = await runNpm(["ci", ...INSTALL_FLAGS], {
        cwd,
        env,
        timeout: 120_000,
      });
      const frozen = await bun(FROZEN);
      expect(frozenNpm.code).toBe(0);
      expect(frozen.code).toBe(0);
      expect(
        snapshot.every(({ file, bytes }) =>
          readFileSync(join(cwd, file)).equals(bytes)
        )
      ).toBe(true);
      const valid = await parse();
      expect(valid.packages[ROOT_ALIAS][0]).toBe(ROOT_IDENTITY);
      expect(
        Object.values(valid.packages).some(
          (row: unknown) =>
            Array.isArray(row) &&
            typeof row[0] === "string" &&
            row[0].startsWith("react-is@19.")
        )
      ).toBe(true);
      await verifyBunLock(native, cwd);
      const resolved = await parse();
      const npmLock = JSON.parse(
        readFileSync(join(cwd, NPM_LOCK_FILE), "utf8")
      );
      resolved.packages[ROOT_ALIAS][1] =
        npmLock.packages[`node_modules/${ROOT_ALIAS}`].resolved;
      writeFileSync(join(cwd, BUN_LOCK_FILE), JSON.stringify(resolved));
      await verifyBunLock(native, cwd);
      const result = {
        files,
        frozenNpmExit: frozenNpm.code,
        frozenBunExit: frozen.code,
        producerCleanup: prepared.cleanup.absent,
      };
      console.log("native-registry-alias-observation", JSON.stringify(result));
      return result;
    })();
    expect(observed.producerCleanup).toBe(true);
  });

  it("refuses a Bun lock whose alias identity differs from the npm lock", async () => {
    const base = current();
    const { env } = base;
    const { cwd } = copyCheckout(base.cwd, join(base.root, "corrupt"), env);
    const committed = readFileSync(join(cwd, BUN_LOCK_FILE));
    const native = await qualifiedBun(env);
    await verifyBunLock(native, cwd);
    const rejected = [];
    for (const [field, index, replacement] of [
      ["name", 0, `definitely-absent-registry-identity@${ROOT_VERSION}`],
      ["version", 0, `${ROOT_TARGET}@0.0.0`],
      ["integrity", 3, `sha512-${Buffer.alloc(64).toString("base64")}`],
      [
        "resolved",
        1,
        `https://example.invalid/${ROOT_TARGET}-${ROOT_VERSION}.tgz`,
      ],
    ] as const) {
      const corrupt = await parseBunLock(native, cwd);
      corrupt.packages[ROOT_ALIAS][index] = replacement;
      writeFileSync(join(cwd, BUN_LOCK_FILE), JSON.stringify(corrupt));
      await expect(verifyBunLock(native, cwd)).rejects.toThrow(
        "Bun package identity differs from public npm lock"
      );
      rejected.push(field);
      writeFileSync(join(cwd, BUN_LOCK_FILE), committed);
      await verifyBunLock(native, cwd);
    }
    expect(rejected).toEqual(["name", "version", "integrity", "resolved"]);
  });
});

describe("native optional Bun lock preparation", () => {
  it("preserves a coherent three-file proposal for both genuine frozen installers", async () => {
    requireNativeBun();
    let fixtureRoot = "";
    const observed = await withPrivateRoot(async (root, privateEnv) => {
      fixtureRoot = root;
      const env = seeded(root, privateEnv);
      const { cwd, bun } = await baseline(root, env);
      const oldBun = readFileSync(join(cwd, BUN_LOCK_FILE));
      const prepared = await prepareUpdate({ cwd, ...SEEDED }, env);
      expect(prepared.status).toBe("prepared");
      if (!("proposal" in prepared) || !("installedAfter" in prepared.npm))
        throw new Error("native preparation did not produce an update");
      expect(prepared.npm.installedAfter).toEqual({ "is-number": VERSION });
      expect(prepared.proposal.bunLockSha256).toBe(
        createHash("sha256").update(oldBun).digest("hex")
      );
      for (const [file, bytes] of Object.entries(prepared.proposal.files)) {
        if (typeof bytes !== "string")
          throw new Error("non-text proposal file");
        writeFileSync(join(cwd, file), bytes, { mode: 0o600 });
      }
      const frozen = await bun(FROZEN, [0, 1]);
      const result = {
        files: Object.keys(prepared.proposal.files).sort((a, b) =>
          a.localeCompare(b)
        ),
        frozenBunExit: frozen.code,
        frozenBunDiagnostic: frozen.stderr.toString(),
        producerCleanup: prepared.cleanup.absent,
        oldBunRetained: oldBun.equals(readFileSync(join(cwd, BUN_LOCK_FILE))),
      };
      console.log("native-dual-lock-observation", JSON.stringify(result));
      return result;
    });
    expect(existsSync(fixtureRoot)).toBe(false);
    expect(observed.producerCleanup).toBe(true);
    expect(observed.frozenBunExit, observed.frozenBunDiagnostic).toBe(0);
    expect(observed.files).toEqual(FILES);
    expect(observed.oldBunRetained).toBe(false);
  });

  it("prepares the original npm-only cohort with no Bun executable available", async () => {
    const inheritedPath = process.env.PATH;
    let fixtureRoot = "";
    const node = await runProcess("node", ["-p", "process.execPath"], {
      env: process.env,
    });
    const nodeOnly = await bunFreeNodeBin(node.stdout.toString().trim());
    try {
      process.env.PATH = `${nodeOnly.bin}:/usr/bin:/bin`;
      const observed = await withPrivateRoot(async (root, privateEnv) => {
        fixtureRoot = root;
        const env = seeded(root, privateEnv);
        const { cwd } = await baseline(root, env, false);
        const unavailable = await runProcess("bun", ["--version"], {
          cwd,
          env,
          allowed: [0, 1],
        });
        expect(unavailable.code).toBe(1);
        expect(unavailable.stderr.toString()).toContain("ENOENT");
        const prepared = await prepareUpdate({ cwd, ...SEEDED }, env);
        expect(prepared.status).toBe("prepared");
        if (!("proposal" in prepared) || !("installedAfter" in prepared.npm))
          throw new Error("native preparation did not produce an update");
        expect(prepared.npm.installedAfter).toEqual({ "is-number": VERSION });
        return prepared;
      });
      expect(existsSync(fixtureRoot)).toBe(false);
      expect(observed.cleanup.absent).toBe(true);
      expect(
        Object.keys(observed.proposal.files).sort((a, b) => a.localeCompare(b))
      ).toEqual([NPM_LOCK_FILE, PACKAGE_FILE]);
      expect(Object.hasOwn(observed.proposal, "bunLockSha256")).toBe(false);
    } finally {
      process.env.PATH = inheritedPath;
      await cleanupTempDir(nodeOnly.root);
    }
  });
});
