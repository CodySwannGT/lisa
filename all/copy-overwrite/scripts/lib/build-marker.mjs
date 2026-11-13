// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Build once per push, and let later steps prove they may skip their own build.
 *
 * A push used to build the package two or three times: every test gate runs a
 * build before testing, and the plugin drift check rebuilds again. Repeating a
 * deterministic build against the same tree proves nothing new
 * (CodySwannGT/lisa#4595).
 *
 * The gate runner builds once, up front, at `--moment=push`, and records WHAT it
 * built in a marker: the tree hash of the working tree, the lockfile hash, and
 * the node and bun versions. It exports the marker's path as
 * `LISA_BUILD_MARKER`. A later step skips its build only when every recorded
 * fact still matches the current tree. Any mismatch, a missing or unreadable
 * marker, or no `LISA_BUILD_MARKER` at all means "build exactly as before", so a
 * stale `dist/` is still rebuilt (CodySwannGT/lisa#3778).
 *
 * The behaviour is off unless `.lisa.config.json` sets
 * `pushGate.buildOnce: true`. With it off nothing here runs.
 * @module build-marker
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The environment variable that hands the marker to every gate. */
export const BUILD_MARKER_ENV = "LISA_BUILD_MARKER";

/** Where the marker lives, relative to the project root (gitignored). */
export const BUILD_MARKER_PATH = ".lisa/build-marker.json";

/** The schema token a reader refuses to parse past. */
export const BUILD_MARKER_SCHEMA = "lisa.build-marker/v1";

/** The id of the build step in the push timing report. */
export const BUILD_ONCE_ID = "build-once";

/** Lockfiles in the order they are looked for. */
const LOCKFILES = Object.freeze([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

/** Git's location variables, which a hook exports to its children. */
const GIT_LOCATION_ENV = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
]);

/** The generated-artifact manifest whose paths count as "plugin" output. */
const MATERIALIZED_MANIFEST = "plugins/materialized-artifacts.json";

/**
 * Read and validate `pushGate.buildOnce` from a parsed `.lisa.config.json`.
 *
 * An unrecognised value is refused rather than defaulted: a typo must not
 * silently switch a behaviour on or off for the project that asked for it.
 * @param {Record<string, unknown>|null|undefined} config Parsed config.
 * @returns {boolean} Whether build-once is switched on (default `false`).
 * @throws {Error} When `pushGate` or `pushGate.buildOnce` has the wrong type.
 */
export function buildOnceEnabled(config) {
  const pushGate = config?.pushGate;
  if (pushGate === undefined) return false;
  if (
    pushGate === null ||
    typeof pushGate !== "object" ||
    Array.isArray(pushGate)
  ) {
    throw new Error(
      `pushGate is ${JSON.stringify(pushGate)}; expected an object such as ` +
        `{ "buildOnce": true }.`
    );
  }
  const { buildOnce } = pushGate;
  if (buildOnce === undefined) return false;
  if (typeof buildOnce !== "boolean") {
    throw new Error(
      `pushGate.buildOnce is ${JSON.stringify(buildOnce)}; expected true or false.`
    );
  }
  return buildOnce;
}

/**
 * Run git and return trimmed stdout, or null when git fails.
 * @param {string[]} args Git arguments.
 * @param {object} [options] Options.
 * @param {string} [options.cwd] Working directory.
 * @param {NodeJS.ProcessEnv} [options.env] Extra environment.
 * @returns {string|null} Output, or null on failure.
 */
function git(args, { cwd = process.cwd(), env = {} } = {}) {
  // Git exports these to hook children. Inherited, they would point this at
  // whatever repository and index the hook was invoked for instead of `cwd`'s,
  // and an inherited GIT_INDEX_FILE would defeat the private index below.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !GIT_LOCATION_ENV.has(key))
  );
  const child = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...inherited, ...env },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (child.status !== 0) return null;
  return child.stdout.trim();
}

/**
 * The tree hash of the working tree as it is now, tracked and untracked files
 * alike (ignored files excluded), without touching the real index.
 *
 * A private copy of the index keeps git's stat cache, so this costs about as
 * much as `git status`.
 * @param {string} [cwd] Project root.
 * @returns {string|null} The tree hash, or null when it cannot be computed.
 */
export function workingTreeHash(cwd = process.cwd()) {
  const indexPath = git(
    ["rev-parse", "--path-format=absolute", "--git-path", "index"],
    {
      cwd,
    }
  );
  if (!indexPath) return null;
  const scratch = mkdtempSync(join(tmpdir(), "lisa-build-marker-"));
  const tempIndex = join(scratch, "index");
  try {
    if (existsSync(indexPath)) {
      copyFileSync(indexPath, tempIndex);
      // Keep the index's own mtime. Git treats an entry modified in the same
      // second as the index as "racily clean" and re-hashes it; a copy stamped
      // NOW would make git trust that entry's stat data, so a same-size edit
      // made within that second would hash as the old content.
      const { atime, mtime } = statSync(indexPath);
      utimesSync(tempIndex, atime, mtime);
    }
    const env = { GIT_INDEX_FILE: tempIndex };
    if (git(["add", "-A", "--", "."], { cwd, env }) === null) return null;
    return git(["write-tree"], { cwd, env });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The first lockfile present and the sha256 of its bytes.
 * @param {string} [cwd] Project root.
 * @returns {{file: string, sha256: string}|null} The lockfile, or null if none.
 */
export function lockfileHash(cwd = process.cwd()) {
  const file = LOCKFILES.find(name => existsSync(join(cwd, name)));
  if (!file) return null;
  const sha256 = createHash("sha256")
    .update(readFileSync(join(cwd, file)))
    .digest("hex");
  return { file, sha256 };
}

/**
 * The bun version on PATH, or the running one, or null without bun.
 * @returns {string|null} The version.
 */
function bunVersion() {
  if (process.versions.bun) return process.versions.bun;
  const child = spawnSync("bun", ["--version"], { encoding: "utf8" });
  return child.status === 0 ? child.stdout.trim() : null;
}

/**
 * Everything a marker records about the inputs of a build.
 * @typedef {object} BuildFingerprint
 * @property {string|null} tree Working-tree hash.
 * @property {{file: string, sha256: string}|null} lockfile Lockfile hash.
 * @property {string} node Node version.
 * @property {string|null} bun Bun version.
 */

/**
 * Fingerprint the current working tree and toolchain.
 * @param {string} [cwd] Project root.
 * @returns {BuildFingerprint} The fingerprint.
 */
export function currentFingerprint(cwd = process.cwd()) {
  return {
    tree: workingTreeHash(cwd),
    lockfile: lockfileHash(cwd),
    node: process.versions.node,
    bun: bunVersion(),
  };
}

/**
 * Whether `plugins/` and every path the plugin build materializes outside it
 * are clean against git.
 * @param {string} [cwd] Project root.
 * @returns {boolean} True when nothing there has uncommitted changes.
 */
export function pluginsClean(cwd = process.cwd()) {
  const paths = ["plugins/"];
  const manifest = join(cwd, MATERIALIZED_MANIFEST);
  if (existsSync(manifest)) {
    try {
      const listed = JSON.parse(readFileSync(manifest, "utf8"));
      if (Array.isArray(listed)) paths.push(...listed.filter(Boolean));
    } catch {
      return false;
    }
  }
  const status = git(["status", "--porcelain", "--", ...paths], { cwd });
  return status === "";
}

/**
 * Decide whether a marker describes the current tree and toolchain.
 *
 * The marker records the tree before the build (`tree`) and after it
 * (`builtTree`). The current tree must equal `builtTree`: the build may itself
 * regenerate tracked artifacts, and the outputs on disk correspond to the tree
 * it left behind.
 * @param {object|null} marker A parsed marker.
 * @param {BuildFingerprint} current The current fingerprint.
 * @returns {{match: boolean, reason: string}} The decision and why.
 */
export function markerMatches(marker, current) {
  if (!marker || marker.schema !== BUILD_MARKER_SCHEMA) {
    return { match: false, reason: "no readable build marker" };
  }
  if (!current.tree || current.tree !== marker.builtTree) {
    return {
      match: false,
      reason: `tree ${current.tree ?? "unknown"} differs from built tree ${marker.builtTree}`,
    };
  }
  if (
    (current.lockfile?.file ?? null) !== (marker.lockfile?.file ?? null) ||
    (current.lockfile?.sha256 ?? null) !== (marker.lockfile?.sha256 ?? null)
  ) {
    return { match: false, reason: "lockfile changed" };
  }
  if (current.node !== marker.node) {
    return {
      match: false,
      reason: `node ${current.node} differs from ${marker.node}`,
    };
  }
  if ((current.bun ?? null) !== (marker.bun ?? null)) {
    return {
      match: false,
      reason: `bun ${current.bun} differs from ${marker.bun}`,
    };
  }
  return { match: true, reason: `marker matches tree ${current.tree}` };
}

/**
 * Read a marker file, or null when it is absent or unreadable.
 * @param {string|undefined} path Marker path.
 * @returns {object|null} The parsed marker.
 */
export function readBuildMarker(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Write a marker file.
 * @param {string} path Marker path.
 * @param {object} marker The marker.
 */
export function writeBuildMarker(path, marker) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`);
}

/**
 * Whether `LISA_BUILD_MARKER` names a marker matching the current tree.
 * @param {object} [options] Options.
 * @param {string} [options.cwd] Project root.
 * @param {NodeJS.ProcessEnv} [options.env] Environment to read the path from.
 * @param {(cwd: string) => BuildFingerprint} [options.fingerprint] Fingerprinter.
 * @returns {{match: boolean, reason: string, marker: object|null}} Decision.
 */
export function checkBuildMarker({
  cwd = process.cwd(),
  env = process.env,
  fingerprint = currentFingerprint,
} = {}) {
  const path = env[BUILD_MARKER_ENV];
  if (!path) {
    return {
      match: false,
      reason: `${BUILD_MARKER_ENV} is unset`,
      marker: null,
    };
  }
  const marker = readBuildMarker(resolve(cwd, path));
  return { ...markerMatches(marker, fingerprint(cwd)), marker };
}

/**
 * The build-once step's entry in the push timing report.
 * @typedef {object} BuildOnceEntry
 * @property {"build-once"} id Step id.
 * @property {string} level Always `required`: a failing build fails the push.
 * @property {string} command The command that ran.
 * @property {"passed"|"failed"} state Outcome, in the runner's STATE words.
 * @property {number|null} code Exit code.
 * @property {string} startedAt ISO start time.
 * @property {number} durationMs Wall time of the build.
 * @property {null} provedBy Always null; the build proves itself.
 *
 * Shaped like a push-timing gate entry so the runner can hand it to the
 * timing report (CodySwannGT/lisa#4591) as a pre-gate step.
 */

/**
 * Run the project's `build` script once before the push gates and record it.
 *
 * Returns null when build-once is off or the project has no `build` script, so
 * the push behaves exactly as before. On success the marker is written and its
 * path exported to `env`; on failure the marker is removed and the caller
 * fails the push.
 * @param {object} options Options.
 * @param {Record<string, unknown>|null|undefined} options.config Parsed config.
 * @param {string} options.runner Task-runner prefix, e.g. `bun run`.
 * @param {Record<string,string>|null} options.scripts Project scripts.
 * @param {(command: string) => {code: number|null}} options.exec Executor.
 * @param {string} [options.cwd] Project root.
 * @param {NodeJS.ProcessEnv} [options.env] Environment to export into.
 * @param {(cwd: string) => BuildFingerprint} [options.fingerprint] Fingerprinter.
 * @param {(cwd: string) => boolean} [options.isPluginsClean] Plugin cleanliness probe.
 * @param {() => number} [options.now] Clock in milliseconds.
 * @returns {BuildOnceEntry|null} The step entry, or null when it did not run.
 */
export function runBuildOnce({
  config,
  runner,
  scripts,
  exec,
  cwd = process.cwd(),
  env = process.env,
  fingerprint = currentFingerprint,
  isPluginsClean = pluginsClean,
  now = Date.now,
}) {
  if (!buildOnceEnabled(config)) return null;
  if (!scripts || typeof scripts.build !== "string") return null;
  const markerPath = join(cwd, BUILD_MARKER_PATH);
  rmSync(markerPath, { force: true });
  delete env[BUILD_MARKER_ENV];

  const before = fingerprint(cwd);
  const cleanBefore = isPluginsClean(cwd);
  const command = `${runner} build`;
  const started = now();
  const { code } = exec(command);
  const durationMs = now() - started;
  const entry = state => ({
    id: BUILD_ONCE_ID,
    level: "required",
    command,
    state,
    code,
    startedAt: new Date(started).toISOString(),
    durationMs,
    provedBy: null,
  });
  if (code !== 0) return entry("failed");
  const after = fingerprint(cwd);
  writeBuildMarker(markerPath, {
    schema: BUILD_MARKER_SCHEMA,
    tree: before.tree,
    builtTree: after.tree,
    lockfile: after.lockfile,
    node: after.node,
    bun: after.bun,
    pluginsCleanBeforeBuild: cleanBefore,
    builtAt: new Date().toISOString(),
  });
  env[BUILD_MARKER_ENV] = markerPath;
  return entry("passed");
}
