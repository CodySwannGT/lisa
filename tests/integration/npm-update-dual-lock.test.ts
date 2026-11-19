/** Native registry installations expose lock coherence independently of provider fixtures. */
import { EventEmitter, once } from "node:events";
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
  baseline,
  BUN_LOCK_FILE,
  copyCheckout,
  FILES,
  FROZEN,
  INSTALL_FLAGS,
  NPM_LOCK_FILE,
  PACKAGE_FILE,
  parseBunLock,
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
const VERSION = "7.0.0";
const config = { tracker: "github", github: { org: "fixture", repo: "host" } };
const policy = {
  version: 1,
  repository: "fixture/host",
  directory: ".",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: VERSION }],
};
/** Genuine root alias and a registry parent whose own dependencies are aliases. */
const ALIASES = {
  "fixture-react-is": "npm:react-is@18.3.1",
  "pretty-format": "30.5.1",
};
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
  const owner = new EventEmitter();
  let shared: AliasBaseline;
  let held: Promise<void>;

  beforeAll(async () => {
    const ready = once(owner, "ready");
    held = withPrivateRoot(async (root, env) => {
      const { cwd } = await baseline(root, env, true, ALIASES);
      owner.emit("ready", { root, env, cwd });
      await once(owner, "release");
    });
    held.catch((error: unknown) => owner.emit("error", error));
    [shared] = (await ready) as [AliasBaseline];
  });

  afterAll(async () => {
    owner.emit("release");
    await held;
    expect(existsSync(shared.root)).toBe(false);
  });

  it("preserves genuine root and transitive registry aliases", async () => {
    const { env } = shared;
    const observed = await (async () => {
      const { cwd, bun } = copyCheckout(
        shared.cwd,
        join(shared.root, "preserve"),
        env
      );
      const originalBun = readFileSync(join(cwd, BUN_LOCK_FILE));
      const originalNpm = JSON.parse(
        readFileSync(join(cwd, NPM_LOCK_FILE), "utf8")
      );
      expect(originalNpm.packages["node_modules/fixture-react-is"].name).toBe(
        "react-is"
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
      expect(before.packages["fixture-react-is"][0]).toBe("react-is@18.3.1");
      const prepared = await prepareUpdate({ cwd, policy, config }, env);
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
      expect(valid.packages["fixture-react-is"][0]).toBe("react-is@18.3.1");
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
      resolved.packages["fixture-react-is"][1] =
        npmLock.packages["node_modules/fixture-react-is"].resolved;
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
    const { env } = shared;
    const { cwd } = copyCheckout(shared.cwd, join(shared.root, "corrupt"), env);
    const committed = readFileSync(join(cwd, BUN_LOCK_FILE));
    const native = await qualifiedBun(env);
    await verifyBunLock(native, cwd);
    const rejected = [];
    for (const [field, index, replacement] of [
      ["name", 0, "definitely-absent-registry-identity@18.3.1"],
      ["version", 0, "react-is@0.0.0"],
      ["integrity", 3, `sha512-${Buffer.alloc(64).toString("base64")}`],
      ["resolved", 1, "https://example.invalid/react-is-18.3.1.tgz"],
    ] as const) {
      const corrupt = await parseBunLock(native, cwd);
      corrupt.packages["fixture-react-is"][index] = replacement;
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
    const observed = await withPrivateRoot(async (root, env) => {
      fixtureRoot = root;
      const { cwd, bun } = await baseline(root, env);
      const oldBun = readFileSync(join(cwd, BUN_LOCK_FILE));
      const prepared = await prepareUpdate({ cwd, policy, config }, env);
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
      const observed = await withPrivateRoot(async (root, env) => {
        fixtureRoot = root;
        const { cwd } = await baseline(root, env, false);
        const unavailable = await runProcess("bun", ["--version"], {
          cwd,
          env,
          allowed: [0, 1],
        });
        expect(unavailable.code).toBe(1);
        expect(unavailable.stderr.toString()).toContain("ENOENT");
        const prepared = await prepareUpdate({ cwd, policy, config }, env);
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
