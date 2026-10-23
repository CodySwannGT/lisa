/**
 * The one place that decides what a test does when it needs a runtime only CI
 * is guaranteed to provision: an exact qualified Node, a native host Bun, the
 * Rails gem set, the reviewed CI Node.
 *
 * In CI a missing runtime is a provisioning bug, so the test fails exactly as
 * before. On a developer machine it is not a verdict about the code: the test
 * is skipped with the runtime and the remedy named, on stderr and as the skip
 * note, and CI still runs it on every pull request. Without this, a local push
 * gate demanded a CI-identical machine and blocked unrelated changes.
 * @module tests/support/ci-runtime
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { getCurrentTest } from "vitest/suite";

import { BUILD_ENV_FINGERPRINTS } from "../../src/core/bootstrap-environment.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

/** A required runtime that this machine does not provide. */
export class CiRuntimeUnavailable extends Error {
  /**
   * Name the missing runtime and how to provide it.
   * @param runtime - Exact runtime the test needs, e.g. `Node 22.23.3`
   * @param remedy - How a developer provides it locally
   */
  constructor(
    readonly runtime: string,
    readonly remedy: string
  ) {
    super(`${runtime} is required but unavailable. ${remedy}`);
    this.name = "CiRuntimeUnavailable";
  }
}

/**
 * Whether this process runs under CI, by the same fingerprints Lisa's bootstrap
 * guard uses.
 * @param env - Environment to inspect
 * @returns True when any CI fingerprint is set
 */
export function isCiRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return BUILD_ENV_FINGERPRINTS.some(name => Boolean(env[name]));
}

/**
 * The skip note a deferred test carries.
 * @param runtime - Missing runtime
 * @param remedy - Local remedy
 * @returns One line naming both, prefixed so it is searchable
 */
export function deferralNote(runtime: string, remedy: string): string {
  return `DEFERRED TO CI: needs ${runtime}. ${remedy}`;
}

/**
 * Decide a missing runtime: in CI fail, locally announce it and return the
 * note. Shared by the per-test and per-suite entry points.
 * @param runtime - Missing runtime
 * @param remedy - Local remedy
 * @param env - Environment to inspect
 * @returns The skip note (local runs only)
 */
function decide(
  runtime: string,
  remedy: string,
  env: NodeJS.ProcessEnv
): string {
  if (isCiRun(env)) throw new CiRuntimeUnavailable(runtime, remedy);
  const note = deferralNote(runtime, remedy);
  process.stderr.write(`\n⏭  ${note}\n`);
  return note;
}

/**
 * Stop the running test because a CI-only runtime is missing. Fails in CI;
 * skips the current test with a named note elsewhere.
 * @param runtime - Missing runtime
 * @param remedy - Local remedy
 * @param env - Environment to inspect
 * @returns Never: always throws (a failure, or Vitest's skip signal)
 */
export function deferToCi(
  runtime: string,
  remedy: string,
  env: NodeJS.ProcessEnv = process.env
): never {
  const note = decide(runtime, remedy, env);
  const test = getCurrentTest();
  // Outside a running test there is nothing to skip; failing is the only
  // honest outcome. Suites deciding before collection use suiteDeferral.
  if (test === undefined) throw new CiRuntimeUnavailable(runtime, remedy);
  return test.context.skip(note);
}

/**
 * Decide at collection time for a suite whose setup needs the runtime; pass
 * the result to `describe.skipIf`.
 * @param isAvailable - Probe for the runtime
 * @param runtime - Runtime the suite needs
 * @param remedy - Local remedy
 * @param env - Environment to inspect
 * @returns The skip note when the suite must be deferred, else undefined
 */
export function suiteDeferral(
  isAvailable: () => boolean,
  runtime: string,
  remedy: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (isAvailable()) return undefined;
  return decide(runtime, remedy, env);
}

/**
 * Whether a probe command exits zero, for suites whose runtime is a toolchain
 * rather than one executable (a gem set, a library).
 * @param command - Executable on PATH
 * @param args - Probe arguments
 * @returns True on exit zero; false on any failure, including a missing command
 */
export function probeSucceeds(
  command: string,
  args: readonly string[]
): boolean {
  try {
    return (
      boundedSpawnSync({ label: `probe ${command}`, command, args }).status ===
      0
    );
  } catch {
    return false;
  }
}

/**
 * The executable of an already-installed mise runtime, never installing one.
 * Used only off CI, where the workflow provisions runtimes itself.
 * @param tool - mise tool name, e.g. `node`
 * @param version - Exact version
 * @param binary - Executable name inside the install's `bin`
 * @returns Absolute executable path, or undefined when mise or the version is absent
 */
export function installedMiseRuntime(
  tool: string,
  version: string,
  binary: string
): string | undefined {
  try {
    const where = boundedSpawnSync({
      label: `locate installed mise ${tool}@${version}`,
      command: "mise",
      args: ["where", `${tool}@${version}`],
    });
    if (where.status !== 0) return undefined;
    const executable = path.join(where.stdout.trim(), "bin", binary);
    return existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}
