#!/usr/bin/env node
/**
 * Record the registry data tests/integration/npm-update-dual-lock.test.ts runs
 * on, so the suite never asks the live registry (CodySwannGT/lisa#5092).
 *
 * Every byte comes from https://registry.npmjs.org/. This runs the commands
 * the suite and the updater it drives run, against the real registry, with
 * npm's and Bun's caches pointed at a fresh seed folder; what they fetched is
 * what an offline run will need. It also resolves each host's npm lock.
 *
 * The record is committed as one archive, tests/fixtures/npm-update-dual-lock/
 * registry-record.tgz, which the suite extracts. Registry responses are
 * third-party data, not Lisa source: kept loose they are cache files with no
 * name a scanner can read, and package metadata naming its authors' public
 * repositories. Recording again replaces the whole archive.
 *
 * Run it under the updater's own Node, so the cache holds what that npm asks
 * for:
 *
 *   mise exec node@22.23.3 bun@1.4.4 -- node scripts/record-npm-update-dual-lock-seed.mjs
 */
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ARCHIVE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/npm-update-dual-lock/registry-record.tgz"
);
const REGISTRY = "https://registry.npmjs.org/";
const IGNORE = "--ignore-scripts";
const FLAGS = [IGNORE, "--no-audit", "--no-fund"];
/** Bun's two installs, as the suite runs them and as the updater does. */
const BUN_LOCK = ["install", "--lockfile-only", IGNORE];
const BUN_FROZEN = ["install", "--frozen-lockfile", IGNORE];
const AT_REGISTRY = ["--registry", REGISTRY];
const UPDATE = "is-number@7.0.0";

/** The hosts the suite builds, as their manifests and recorded locks. */
const HOSTS = [
  {
    name: "alias",
    devDependencies: {
      "is-number": "6.0.0",
      "fixture-ee-first": "npm:ee-first@1.1.1",
      "pretty-format": "30.5.1",
    },
    lock: "alias-package-lock.json",
  },
  {
    name: "plain",
    devDependencies: { "is-number": "6.0.0" },
    lock: "plain-package-lock.json",
  },
];

if (process.versions.node !== "22.23.3")
  throw new Error(
    `run this under the updater's Node 22.23.3, not ${process.versions.node}`
  );

const scratch = mkdtempSync(join(tmpdir(), "lisa-dual-lock-seed-"));
const STAGE = join(scratch, "record");
const SEED = join(STAGE, "seed");
mkdirSync(join(SEED, "npm"), { recursive: true });
mkdirSync(join(SEED, "bun"), { recursive: true });
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: join(scratch, "home"),
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  TZ: "UTC",
  COPYFILE_DISABLE: "1",
  NPM_CONFIG_USERCONFIG: join(scratch, "npmrc"),
  NPM_CONFIG_GLOBALCONFIG: join(scratch, "global-npmrc"),
  NPM_CONFIG_CACHE: join(SEED, "npm"),
  NPM_CONFIG_REGISTRY: REGISTRY,
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  BUN_INSTALL_CACHE_DIR: join(SEED, "bun"),
  BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER: "1",
};
mkdirSync(env.HOME);

/**
 * Drop the links Bun's cache keeps beside each package, and the folders that
 * held only links. Bun writes them as absolute paths into this folder, so they
 * would point outside any copy, and the updater refuses a seed holding a link.
 * Bun reads a package from its `name@version` folder without them.
 * @param {string} folder - A folder inside the seed.
 */
function dropLinks(folder) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink()) rmSync(path);
    else if (entry.isDirectory()) {
      dropLinks(path);
      if (readdirSync(path).length === 0) rmSync(path, { recursive: true });
    }
  }
}

/**
 * Run one recording command, and stop on a failure it did not expect.
 * @param {string} cwd - Where to run it.
 * @param {string} command - The program.
 * @param {string[]} args - Its arguments.
 * @param {number[]} [allowed] - Exit codes that are not a failure.
 * @param {NodeJS.ProcessEnv} [runEnv] - Its environment.
 */
function run(cwd, command, args, allowed = [0], runEnv = env) {
  const done = spawnSync(command, args, {
    cwd,
    env: runEnv,
    encoding: "utf8",
    timeout: 600_000,
  });
  if (done.error !== undefined || !allowed.includes(done.status ?? -1))
    throw new Error(
      `${command} ${args.join(" ")} failed (${done.status}): ${done.stderr}`
    );
}

try {
  for (const host of HOSTS) {
    const cwd = join(scratch, host.name);
    mkdirSync(cwd);
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "anonymous-dual-lock-host",
        version: "1.0.0",
        private: true,
        devDependencies: host.devDependencies,
      })
    );
    // Resolving reads install packuments the suite never needs, since it
    // installs from this lock, so it gets a cache of its own.
    run(cwd, "npm", ["install", "--package-lock-only", ...FLAGS], [0], {
      ...env,
      NPM_CONFIG_CACHE: join(scratch, "resolve-cache"),
    });
    writeFileSync(
      join(STAGE, host.lock),
      readFileSync(join(cwd, "package-lock.json"))
    );
    // The suite's baseline, then the updater's prepare, in their order.
    run(cwd, "npm", ["ci", ...FLAGS]);
    run(cwd, "bun", BUN_LOCK);
    run(cwd, "bun", BUN_FROZEN);
    run(cwd, "npm", ["outdated", "--json", "--long"], [0, 1]);
    run(cwd, "npm", ["view", UPDATE, "--json"]);
    run(cwd, "npm", [
      "install",
      UPDATE,
      "--save-exact",
      "--package-lock-only",
      "--save-dev",
      ...FLAGS,
    ]);
    run(cwd, "bun", [...BUN_LOCK, ...AT_REGISTRY]);
    run(cwd, "npm", ["ci", ...FLAGS]);
    run(cwd, "bun", [...BUN_FROZEN, ...AT_REGISTRY]);
  }
  dropLinks(SEED);
  // Bun's extracted packages are package source, not registry data: the suite
  // extracts the one it needs from npm's recorded, integrity-checked tarball.
  for (const name of readdirSync(join(SEED, "bun")))
    if (lstatSync(join(SEED, "bun", name)).isDirectory())
      rmSync(join(SEED, "bun", name), { recursive: true });
  // npm's debug logs name local paths, and nothing offline reads them.
  rmSync(join(SEED, "npm", "_logs"), { force: true, recursive: true });
  // No local owner, extended attributes or macOS metadata in the archive.
  run(STAGE, "tar", [
    "-czf",
    ARCHIVE,
    "--uid",
    "0",
    "--gid",
    "0",
    "--uname",
    "",
    "--gname",
    "",
    "--no-xattrs",
    "--no-mac-metadata",
    "seed",
    ...HOSTS.map(host => host.lock),
  ]);
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
console.log(`recorded ${ARCHIVE}`);
