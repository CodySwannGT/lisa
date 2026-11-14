#!/usr/bin/env node
/**
 * One build for every integration-test shard leg (CodySwannGT/lisa#4599).
 *
 * `quality.yml`'s `🏗️ Build Once for Integration-Test Shards` job runs `build`:
 * it runs `bun run build` once through the build-once marker
 * (`all/copy-overwrite/scripts/lib/build-marker.mjs`, #4595) and packs `dist/`,
 * every file the build changed or added in the tree, and the marker into one
 * archive. Each leg runs `use`: it unpacks that archive over its checkout and
 * checks the marker, so `lisa-test-run` (`scripts/build-unless-marked.mjs`)
 * skips its own build for that exact tree and logs why. A leg whose tree,
 * lockfile or toolchain differs only warns here, and builds as before.
 *
 * Lisa-only: callers' gate tasks run no Lisa build.
 *
 * Usage:
 *   node scripts/integration-shard-build.mjs build <archive>
 *   node scripts/integration-shard-build.mjs use <archive> [--github-output <file>]
 * @module integration-shard-build
 */
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";

import {
  BUILD_MARKER_ENV,
  BUILD_MARKER_PATH,
  checkBuildMarker,
  runBuildOnce,
} from "../all/copy-overwrite/scripts/lib/build-marker.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * @typedef {object} Deps
 * @property {(command: string) => { code: number | null }} exec - Run a shell command with inherited output
 * @property {(command: string, args: ReadonlyArray<string>, input?: string) => { status: number | null, stdout: string }} spawn - Run a command
 * @property {typeof checkBuildMarker} check - Marker check
 * @property {typeof runBuildOnce} buildOnce - Build-once runner
 * @property {(line: string) => void} out - Standard output
 * @property {NodeJS.ProcessEnv} env - Environment
 */

/**
 * Build once, record the marker, and pack what the legs need.
 * @param {string} archive - Archive to write
 * @param {Deps} deps - Effects
 * @returns {number} Exit code
 */
function build(archive, deps) {
  const { scripts } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const entry = deps.buildOnce({
    config: { pushGate: { buildOnce: true } },
    runner: "bun run",
    scripts,
    exec: deps.exec,
    env: deps.env,
  });
  if (entry?.state !== "passed") return 1;
  // dist/ is ignored and the build may regenerate tracked files: ship both,
  // because the marker matches only the tree the build left behind.
  const changed = deps.spawn("git", [
    "ls-files",
    "-m",
    "-o",
    "--exclude-standard",
    "-z",
  ]);
  if (changed.status !== 0) return 1;
  const files = `${changed.stdout}dist\0${BUILD_MARKER_PATH}\0`;
  const packed = deps.spawn(
    "tar",
    ["--null", "-T", "-", "-czf", archive],
    files
  );
  if (packed.status !== 0) return 1;
  deps.out(
    `::notice title=Shared integration build::Built once in ${Math.round(entry.durationMs / 1000)} s; every integration-test shard reuses ${archive}.`
  );
  return 0;
}

/**
 * Unpack the shared build and report whether the marker matches this tree.
 * @param {string} archive - Archive the build job uploaded
 * @param {string | undefined} githubOutput - Step output file
 * @param {Deps} deps - Effects
 * @returns {number} Exit code
 */
function use(archive, githubOutput, deps) {
  if (deps.spawn("tar", ["-xzf", archive]).status !== 0) return 1;
  const { match, reason } = deps.check({
    env: { ...deps.env, [BUILD_MARKER_ENV]: BUILD_MARKER_PATH },
  });
  deps.out(
    match
      ? `::notice title=Shared integration build::Using the shared build (${reason}); this shard does not run bun run build.`
      : `::warning title=Shared integration build not used::${reason}, so lisa-test-run builds this shard itself.`
  );
  if (githubOutput !== undefined)
    fs.appendFileSync(githubOutput, `marker=${BUILD_MARKER_PATH}\n`);
  return 0;
}

/**
 * CLI entry.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name
 * @param {Deps} deps - Effects
 * @returns {number} Exit code
 */
export function main(argv, deps) {
  const [command, archive] = argv;
  const at = argv.indexOf("--github-output");
  if (archive === undefined || archive.startsWith("--")) return 2;
  if (command === "build") return build(archive, deps);
  if (command === "use")
    return use(archive, at === -1 ? undefined : argv[at + 1], deps);
  return 2;
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    exec: command => {
      try {
        execSync(command, { stdio: "inherit" });
        return { code: 0 };
      } catch (error) {
        return { code: error?.status ?? 1 };
      }
    },
    spawn: (command, args, input) => {
      const child = spawnSync(command, [...args], {
        encoding: "utf8",
        input,
        stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
        maxBuffer: 64 * 1024 * 1024,
      });
      return { status: child.status, stdout: child.stdout ?? "" };
    },
    check: checkBuildMarker,
    buildOnce: runBuildOnce,
    out: line => console.log(line),
    env: process.env,
  });
}
