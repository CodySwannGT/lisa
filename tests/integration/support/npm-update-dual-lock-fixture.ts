/**
 * Native dual-lock fixtures for tests/integration/npm-update-dual-lock.test.ts.
 *
 * Every lock and every registry byte here is genuine npm output against the
 * public registry, recorded once by `scripts/record-npm-update-dual-lock-seed.mjs`
 * into one archive, which this module extracts. Nothing is synthesized. The suite runs on that record and never asks the
 * live registry: a single live request has taken 77s to answer, on a quiet
 * machine, and the suite's cases used to make dozens (CodySwannGT/lisa#5092).
 * @module tests/integration/support/npm-update-dual-lock-fixture
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import type { qualifiedBun } from "../../../all/copy-overwrite/scripts/lib/npm-update-bun.mjs";
import { bunCacheIn } from "../../../all/copy-overwrite/scripts/lib/npm-update-cache-seed.mjs";
import {
  runNpm,
  runProcess,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-process.mjs";
import { copyKeepingLinks } from "../../support/borrowed-node-modules.mjs";

export const BUN_LOCK_FILE = "bun.lock";
export const PACKAGE_FILE = "package.json";
export const NPM_LOCK_FILE = "package-lock.json";
export const FILES = [BUN_LOCK_FILE, NPM_LOCK_FILE, PACKAGE_FILE];
const IGNORE_SCRIPTS = "--ignore-scripts";
export const FROZEN = ["install", "--frozen-lockfile", IGNORE_SCRIPTS];
export const INSTALL_FLAGS = [IGNORE_SCRIPTS, "--no-audit", "--no-fund"];

const ARCHIVE = join(
  import.meta.dirname,
  "../../fixtures/npm-update-dual-lock/registry-record.tgz"
);
const TAR = "/usr/bin/tar";

/**
 * Take write access from everyone but the owner, as `cacheSeed` requires, so
 * the record does not depend on the umask it was extracted under.
 * @param path - A path inside the extracted record.
 */
function ownerWritable(path: string): void {
  const entry = lstatSync(path);
  chmodSync(path, entry.mode & 0o755);
  if (entry.isDirectory())
    for (const name of readdirSync(path)) ownerWritable(join(path, name));
}

/**
 * Extract the registry record once for this test file, and remove it after.
 * @returns The private folder holding it.
 */
function extractRecord(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lisa-dual-lock-")));
  afterAll(() => rmSync(root, { force: true, recursive: true }));
  boundedExecFileSync({
    label: "extract the dual-lock registry record",
    command: TAR,
    args: ["-xzf", ARCHIVE, "-C", root],
  });
  ownerWritable(root);
  return root;
}

const FIXTURES = extractRecord();

/** The version the fixture policy updates is-number to, from 6.0.0. */
export const VERSION = "7.0.0";

/** The updater configuration of the anonymous fixture host. */
export const config = {
  tracker: "github",
  github: { org: "fixture", repo: "host" },
};

/** The fixture host's update policy: is-number to {@link VERSION}. */
export const policy = {
  version: 1,
  repository: "fixture/host",
  directory: ".",
  target: "main",
  maintainer: "Fixture",
  lisaOwner: "absent",
  packages: [{ name: "is-number", version: VERSION }],
};

/**
 * The root alias, and the registry package it installs.
 *
 * Any registry package makes a genuine root alias, so this one is chosen for
 * a small packument: 8 versions, 15 KB in full. It was `react-is`, whose
 * thousands of canary versions make a 2.7 MB install packument and a 5.8 MB
 * full one. The updater's `npm outdated --long` reads the full packument of
 * every root dependency over the live registry, so a `react-is` root alias put
 * that download inside this case; one such fetch measured 87s
 * (CodySwannGT/lisa#5092). `react-is` still arrives through `pretty-format`'s
 * own aliases, the #4376 pattern, where npm needs it only to write the lock.
 */
export const ROOT_ALIAS = "fixture-ee-first";
export const ROOT_TARGET = "ee-first";
export const ROOT_VERSION = "1.1.1";
export const ROOT_IDENTITY = `${ROOT_TARGET}@${ROOT_VERSION}`;
/** Genuine root alias and a registry parent whose own dependencies are aliases. */
export const ALIASES = {
  [ROOT_ALIAS]: `npm:${ROOT_IDENTITY}`,
  "pretty-format": "30.5.1",
};
/** The recorded lock of the host that depends on is-number alone. */
export const PLAIN_LOCK = join(FIXTURES, "plain-package-lock.json");

/** The recorded lock of the host with root and transitive aliases. */
export const ALIAS_LOCK = join(FIXTURES, "alias-package-lock.json");

/**
 * The recorded npm and Bun caches, as `prepareUpdate`'s `cacheSeed` takes them.
 */
export const CACHE_SEED = {
  npm: join(FIXTURES, "seed/npm"),
  bun: join(FIXTURES, "seed/bun"),
} as const;

/** The update's tarball integrity, as the public registry publishes it. */
export const UPDATE_INTEGRITY =
  "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==";

/**
 * Where npm's cache keeps the bytes with one integrity.
 * @param npmCache - An npm cache folder.
 * @param integrity - An SRI string, `sha512-<base64>`.
 * @returns The content file's path.
 */
export function cachedTarball(npmCache: string, integrity: string): string {
  const split = integrity.indexOf("-");
  const hex = Buffer.from(integrity.slice(split + 1), "base64").toString("hex");
  return join(
    npmCache,
    "_cacache",
    "content-v2",
    integrity.slice(0, split),
    hex.slice(0, 2),
    hex.slice(2, 4),
    hex.slice(4)
  );
}

/** The updater inputs every seeded case passes beside its checkout. */
export const SEEDED = { policy, config, cacheSeed: CACHE_SEED };

/**
 * Give one of the suite's own private roots the recorded caches, offline.
 *
 * The same copy the updater makes of its `cacheSeed`, for the installs the
 * suite runs itself, so they too read only recorded bytes.
 * @param root - The private root, which is also HOME.
 * @param env - Its sanitized candidate environment.
 * @returns The environment, with npm put offline.
 */
export function seeded(
  root: string,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  // Bun keeps packages extracted, and trusts them without hashing them again.
  // The suite's own frozen Bun install of a proposal needs the update's, so it
  // is extracted here from npm's recorded tarball, once that tarball matches
  // the registry's integrity, instead of being committed as package source.
  const cached = cachedTarball(CACHE_SEED.npm, UPDATE_INTEGRITY);
  const tarball = readFileSync(cached);
  const digest = createHash("sha512").update(tarball).digest("base64");
  const extracted = join(bunCacheIn(root), `is-number@${VERSION}@@@1`);
  if (`sha512-${digest}` !== UPDATE_INTEGRITY)
    throw new Error("recorded update tarball differs from its integrity");
  cpSync(CACHE_SEED.npm, join(root, "npm-cache"), { recursive: true });
  cpSync(CACHE_SEED.bun, bunCacheIn(root), { recursive: true });
  mkdirSync(extracted, { recursive: true });
  boundedExecFileSync({
    label: "extract the update for Bun's cache",
    command: TAR,
    args: ["-xzf", cached, "-C", extracted, "--strip-components=1"],
  });
  return { ...env, NPM_CONFIG_OFFLINE: "true" };
}

/**
 * A native Bun runner bound to one checkout; every `install` is offline.
 * @param cwd - Fixture checkout.
 * @param env - Original sanitized candidate environment.
 * @returns A runner that accepts the listed exit codes.
 */
function bunIn(cwd: string, env: NodeJS.ProcessEnv) {
  return (args: string[], allowed = [0]) =>
    runProcess("bun", args[0] === "install" ? [...args, "--offline"] : args, {
      cwd,
      env,
      timeout: 120_000,
      allowed,
    });
}

/**
 * Commit genuine installer output; no lock or registry response is synthesized.
 * @param root - Positively owned native fixture root.
 * @param env - The root's environment, from {@link seeded}.
 * @param dual - Whether the host actually commits both locks.
 * @param aliases - Genuine root aliases and their registry parent fixture.
 * @param lockFile - The npm lock recorded for this manifest.
 * @returns Actual checkout and its native Bun runner.
 */
export async function baseline(
  root: string,
  env: NodeJS.ProcessEnv,
  dual = true,
  aliases: Record<string, string> = {},
  lockFile = PLAIN_LOCK
) {
  const cwd = join(root, "host");
  const npm = (args: string[]) => runNpm(args, { cwd, env, timeout: 120_000 });
  const bun = bunIn(cwd, env);
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
  writeFileSync(join(cwd, NPM_LOCK_FILE), readFileSync(lockFile), {
    mode: 0o600,
  });
  // npm refuses a lock that does not match the manifest, so a stale record
  // fails here rather than passing on the wrong tree.
  await npm(["ci", ...INSTALL_FLAGS]);
  if (dual) {
    expect((await bun(["--version"])).stdout.toString().trim()).toBe("1.4.4");
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

/**
 * Copy a committed baseline checkout so one case can change it freely.
 *
 * Symlinks are copied as written: `node_modules/.bin` holds relative links,
 * and resolving them would point the copy back into the source checkout.
 * @param source - Committed baseline checkout.
 * @param target - New checkout path inside the same private root.
 * @param env - Original sanitized candidate environment.
 * @returns The copy and its native Bun runner.
 */
export function copyCheckout(
  source: string,
  target: string,
  env: NodeJS.ProcessEnv
) {
  copyKeepingLinks(source, target);
  return { cwd: target, bun: bunIn(target, env) };
}

/**
 * Parse the checkout's Bun lock with the qualified native Bun.
 * @param native - Qualified native Bun runner.
 * @param cwd - Fixture checkout.
 * @returns The parsed lock.
 */
export async function parseBunLock(
  native: Awaited<ReturnType<typeof qualifiedBun>>,
  cwd: string
) {
  return JSON.parse(
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
}

/**
 * A promise with its resolver, for a fixture whose lifetime spans hooks.
 * @returns The promise and the function that resolves it.
 */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  const settle: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>(resolve => {
    settle.resolve = resolve;
  });
  return {
    promise,
    resolve: value => (settle.resolve as (value: T) => void)(value),
  };
}
