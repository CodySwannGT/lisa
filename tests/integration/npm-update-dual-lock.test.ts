/** Native registry installations expose lock coherence independently of provider fixtures. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import { prepareUpdate } from "../../all/copy-overwrite/scripts/lib/npm-update-prepare.mjs";
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
const BUN_LOCK_FILE = "bun.lock";
const PACKAGE_FILE = "package.json";
const NPM_LOCK_FILE = "package-lock.json";
const FILES = [BUN_LOCK_FILE, NPM_LOCK_FILE, PACKAGE_FILE];
const IGNORE_SCRIPTS = "--ignore-scripts";
const FROZEN = ["install", "--frozen-lockfile", IGNORE_SCRIPTS];
const VERSION = "7.0.0";
const INSTALL_FLAGS = [IGNORE_SCRIPTS, "--no-audit", "--no-fund"];
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

/**
 * Commit genuine installer output; no lock or registry response is synthesized.
 * @param root - Positively owned native fixture root.
 * @param env - Original sanitized candidate environment.
 * @param dual - Whether the host actually commits both locks.
 * @param aliases - Genuine root aliases and their registry parent fixture.
 * @returns Actual checkout and its native Bun runner.
 */
async function baseline(
  root: string,
  env: NodeJS.ProcessEnv,
  dual = true,
  aliases: Record<string, string> = {}
) {
  const cwd = join(root, "host");
  const npm = (args: string[]) => runNpm(args, { cwd, env, timeout: 120_000 });
  const bun = (args: string[], allowed = [0]) =>
    runProcess("bun", args, { cwd, env, timeout: 120_000, allowed });
  const git = (args: string[]) => runProcess("git", args, { cwd, env });
  mkdirSync(cwd, { mode: 0o700 });
  writeFileSync(
    join(cwd, PACKAGE_FILE),
    JSON.stringify({
      name: "anonymous-dual-lock-host",
      version: "1.0.0",
      private: true,
      devDependencies: { "is-number": "6.0.0", ...aliases },
    }),
    { mode: 0o600 }
  );
  await npm(["install", "--package-lock-only", ...INSTALL_FLAGS]);
  if (dual) {
    expect((await bun(["--version"])).stdout.toString().trim()).toBe("1.3.8");
    await bun(["install", "--lockfile-only", IGNORE_SCRIPTS]);
    await bun(FROZEN);
  }
  await git(["init"]);
  await git([
    "add",
    "--",
    ...FILES.filter(file => dual || file !== BUN_LOCK_FILE),
  ]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "Committed native dual locks",
  ]);
  return { cwd, bun };
}

describe("native optional Bun lock preparation", () => {
  it("preserves genuine root and transitive registry aliases and refuses corrupted identities", async () => {
    let fixtureRoot = "";
    const observed = await withPrivateRoot(async (root, env) => {
      fixtureRoot = root;
      const { cwd, bun } = await baseline(root, env, true, {
        "fixture-react-is": "npm:react-is@18.3.1",
        "pretty-format": "30.5.1",
      });
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
      const parse = async () =>
        JSON.parse(
          (
            await native(
              [
                "--eval",
                "process.stdout.write(JSON.stringify(Bun.JSONC.parse(await Bun.stdin.text())))",
              ],
              { cwd, input: readFileSync(join(cwd, BUN_LOCK_FILE)) }
            )
          ).stdout.toString()
        );
      const before = await parse();
      expect(before.packages["fixture-react-is"][0]).toBe("react-is@18.3.1");
      const prepared = await prepareUpdate({ cwd, policy, config });
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
      writeFileSync(
        join(cwd, BUN_LOCK_FILE),
        prepared.proposal.files[BUN_LOCK_FILE]
      );
      const rejected = [];
      for (const [field, index, replacement] of [
        ["name", 0, "definitely-absent-registry-identity@18.3.1"],
        ["version", 0, "react-is@0.0.0"],
        ["integrity", 3, `sha512-${Buffer.alloc(64).toString("base64")}`],
        ["resolved", 1, "https://example.invalid/react-is-18.3.1.tgz"],
      ] as const) {
        const corrupt = await parse();
        corrupt.packages["fixture-react-is"][index] = replacement;
        writeFileSync(join(cwd, BUN_LOCK_FILE), JSON.stringify(corrupt));
        await expect(verifyBunLock(native, cwd)).rejects.toThrow(
          "Bun package identity differs from public npm lock"
        );
        rejected.push(field);
        writeFileSync(
          join(cwd, BUN_LOCK_FILE),
          prepared.proposal.files[BUN_LOCK_FILE]
        );
        await verifyBunLock(native, cwd);
      }
      const result = {
        files,
        frozenNpmExit: frozenNpm.code,
        frozenBunExit: frozen.code,
        rejected,
        producerCleanup: prepared.cleanup.absent,
      };
      console.log("native-registry-alias-observation", JSON.stringify(result));
      return result;
    });
    expect(existsSync(fixtureRoot)).toBe(false);
    expect(observed.producerCleanup).toBe(true);
    expect(observed.rejected).toEqual([
      "name",
      "version",
      "integrity",
      "resolved",
    ]);
  });

  it("preserves a coherent three-file proposal for both genuine frozen installers", async () => {
    let fixtureRoot = "";
    const observed = await withPrivateRoot(async (root, env) => {
      fixtureRoot = root;
      const { cwd, bun } = await baseline(root, env);
      const oldBun = readFileSync(join(cwd, BUN_LOCK_FILE));
      const prepared = await prepareUpdate({ cwd, policy, config });
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
    try {
      process.env.PATH = `${dirname(node.stdout.toString().trim())}:/usr/bin:/bin`;
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
        const prepared = await prepareUpdate({ cwd, policy, config });
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
    }
  });
});
