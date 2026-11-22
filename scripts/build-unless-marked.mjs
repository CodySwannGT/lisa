#!/usr/bin/env node
/**
 * Build Lisa unless the push's build-once marker proves the build is current.
 *
 * `lisa-test-run` used to run `bun run build` unconditionally, so a push that
 * ran two test gates built twice more after the gate runner's own build
 * (CodySwannGT/lisa#4595). This skips the build only when `LISA_BUILD_MARKER`
 * names a marker whose tree, lockfile and tool versions match the current
 * working tree. Anything else — no variable, a missing or unreadable marker, a
 * different tree — builds exactly as before, so a stale `dist/` is still rebuilt
 * (CodySwannGT/lisa#3778).
 *
 * `--probe-plugins` builds nothing. It exits 0 when the marker matches AND
 * records `plugins/` (with every materialized path) as clean before the
 * up-front build, which is what lets `check:plugins` skip its own rebuild and
 * go straight to the diff; it exits 1 otherwise.
 * @module build-unless-marked
 */

import { spawnSync } from "node:child_process";

import { checkBuildMarker } from "../all/copy-overwrite/scripts/lib/build-marker.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Run the build, or skip it when the marker matches.
 * @param {string[]} [argv] Arguments.
 * @param {object} [options] Options.
 * @param {string} [options.cwd] Project root.
 * @param {NodeJS.ProcessEnv} [options.env] Environment.
 * @param {(cwd: string) => import("../all/copy-overwrite/scripts/lib/build-marker.mjs").BuildFingerprint} [options.fingerprint] Fingerprinter.
 * @param {(cwd: string) => number|null} [options.build] Build runner.
 * @param {(line: string) => void} [options.log] Logger.
 * @returns {number} Exit code.
 */
export function main(
  argv = process.argv.slice(2),
  {
    cwd = process.cwd(),
    env = process.env,
    fingerprint,
    build = runBuild,
    log = line => console.log(line),
  } = {}
) {
  const decision = checkBuildMarker({
    cwd,
    env,
    ...(fingerprint ? { fingerprint } : {}),
  });
  if (argv.includes("--probe-plugins")) {
    if (decision.match && decision.marker?.pluginsCleanBeforeBuild === true) {
      log(`build skipped: ${decision.reason}`);
      return 0;
    }
    if (env.LISA_BUILD_MARKER) {
      const why = decision.match
        ? "plugins were dirty before the build"
        : decision.reason;
      log(`rebuilding plugins: ${why}`);
    }
    return 1;
  }
  if (decision.match) {
    log(`build skipped: ${decision.reason}`);
    return 0;
  }
  if (env.LISA_BUILD_MARKER) log(`building: ${decision.reason}`);
  return build(cwd) ?? 1;
}

/**
 * Run `bun run build` with inherited stdio.
 * @param {string} cwd Project root.
 * @returns {number|null} Exit code.
 */
function runBuild(cwd) {
  return spawnSync("bun", ["run", "build"], { cwd, stdio: "inherit" }).status;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main());
}
