#!/usr/bin/env node
/** Public entrypoint for birth-bound test supervision and scratch cleanup. */
import * as path from "node:path";
import { env } from "node:process";

// @ts-expect-error -- the shipped JavaScript helper carries the same checked JSDoc signature
import { invokedAsScript } from "../../scripts/lib/invoked-as-script.mjs";
import { worktreeDependencyProblem } from "../../all/copy-overwrite/scripts/lib/worktree-dependencies.mjs";

import {
  resolveScratchRouteProfile,
  type ScratchRouteProfile,
} from "../configs/vitest/scratch-route-profile.js";
import { mergeJestShards } from "./lisa-test-run-jest-merge.js";
import {
  gatherVitestBlobs,
  readShardReceipts,
  SHARD_ENV_NAMES,
  shardArgv,
  shardPlanFrom,
  shardRunnerOf,
  vitestMergeArgv,
  writeShardReceipt,
} from "./lisa-test-run-shard.js";
import {
  superviseTestRun,
  type TestRunAdapter,
} from "./lisa-test-run-supervisor.js";

export { assertTestRunPlatform } from "./lisa-test-run-process-group.js";

/** Dedicated operational-failure exit status. */
const OPERATIONAL_FAILURE_EXIT = 1;

/** Fully parsed public invocation before scratch authority is created. */
interface TestRunInvocation {
  readonly profile: ScratchRouteProfile;
  readonly adapter: TestRunAdapter;
  readonly argv: readonly [string, ...string[]];
}

/**
 * Parse the exact public `--profile <route> --adapter <kind> -- <command>` syntax.
 * @param argv - Public CLI arguments
 * @returns Validated route profile and payload argv
 */
function commandArgv(argv: readonly string[]): TestRunInvocation {
  if (
    argv[0] !== "--profile" ||
    argv[1] === undefined ||
    argv[2] !== "--adapter" ||
    (argv[3] !== "vitest" && argv[3] !== "direct") ||
    argv[4] !== "--" ||
    argv.length < 6 ||
    argv[5] === undefined
  ) {
    throw new Error(
      "Usage: lisa-test-run --profile <route> --adapter vitest|direct -- <executable> [args...]"
    );
  }
  return {
    profile: resolveScratchRouteProfile(argv[1]),
    adapter: argv[3],
    argv: argv.slice(5) as [string, ...string[]],
  };
}

/**
 * Parse public input or emit the usage verdict without starting companions.
 * @returns Validated invocation or undefined after a usage verdict
 */
function invocationOrExit(): TestRunInvocation | undefined {
  try {
    return commandArgv(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exitCode = 2;
    return undefined;
  }
}

/**
 * Apply the shard plan `quality.yml` put in the environment, if any.
 *
 * The variables are removed before the payload starts. Lisa's own suites spawn
 * `lisa-test-run` as a fixture, and an inherited shard plan would make every
 * one of those nested runs shard itself.
 * @param argv - Payload argv as parsed
 * @returns The argv to supervise, or an exit code when no test run is needed
 */
function applyShardPlan(
  argv: readonly [string, ...string[]]
): readonly [string, ...string[]] | number {
  const plan = shardPlanFrom(env);
  for (const name of SHARD_ENV_NAMES) delete env[name];
  if (plan.kind === "none") return argv;
  const runner = shardRunnerOf(argv);
  if (plan.kind === "shard") {
    writeShardReceipt(plan, runner, argv);
    return shardArgv(argv, runner, plan);
  }
  const receipts = readShardReceipts(plan.directory, plan.total);
  if (receipts[0]?.runner !== runner) {
    throw new Error(
      `the shards ran ${receipts[0]?.runner}, but this merge would run ${runner}.`
    );
  }
  if (runner === "jest") return mergeJestShards(argv, receipts);
  const blobs = path.join(plan.directory, ".lisa-vitest-blobs");
  gatherVitestBlobs(receipts, blobs);
  return vitestMergeArgv(argv, blobs);
}

/** Run the public CLI and preserve the child result only after cleanup. */
async function main(): Promise<void> {
  const invocation = invocationOrExit();
  if (invocation === undefined) return;
  try {
    const dependencyProblem = worktreeDependencyProblem();
    if (dependencyProblem) throw new Error(dependencyProblem);
    const payload = applyShardPlan(invocation.argv);
    if (typeof payload === "number") process.exit(payload);
    const outcome = await superviseTestRun(
      payload,
      invocation.profile,
      invocation.adapter
    );
    if (outcome.signal !== null) {
      process.removeAllListeners(outcome.signal);
      process.kill(process.pid, outcome.signal);
      return;
    }
    process.exit(outcome.code ?? OPERATIONAL_FAILURE_EXIT);
  } catch (error) {
    process.stderr.write(
      `lisa-test-run failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(OPERATIONAL_FAILURE_EXIT);
  }
}

if (invokedAsScript(import.meta.url)) void main();
