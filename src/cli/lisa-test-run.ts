#!/usr/bin/env node
/** Public entrypoint: sweep, shard, admit, then run the test payload. */
import * as os from "node:os";
import * as path from "node:path";
import { env } from "node:process";

// @ts-expect-error -- the shipped JavaScript helper carries the same checked JSDoc signature
import { invokedAsScript } from "../../scripts/lib/invoked-as-script.mjs";
import { worktreeDependencyProblem } from "../../all/copy-overwrite/scripts/lib/worktree-dependencies.mjs";

import { socketSafeTempBase } from "../configs/vitest/socket-safe-temp-base.js";
import { admitTestRun } from "./lisa-test-run-admission.js";
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
  runTestPayload,
  type TestRunAdapter,
} from "./lisa-test-run-payload.js";
import { startOfRunSweep } from "./lisa-test-run-sweep.js";

/** Dedicated operational-failure exit status. */
const OPERATIONAL_FAILURE_EXIT = 1;

/**
 * Route names the generated `test*` scripts pass as `--profile`.
 *
 * The profile used to select a scratch prefix registry. That registry was
 * retired with the per-test policing (CodySwannGT/lisa#4602); the name is still
 * validated so a typo in a script fails loudly instead of being ignored, and so
 * every shipped script keeps working unchanged.
 */
const ROUTE_PROFILES: ReadonlySet<string> = new Set([
  "lisa",
  "typescript",
  "npm-package",
  "node",
  "expo",
  "nestjs",
  "cdk",
  "harper-fabric",
  "phaser",
]);

/** Fully parsed public invocation. */
interface TestRunInvocation {
  readonly profile: string;
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
  if (!ROUTE_PROFILES.has(argv[1])) {
    throw new Error(`Unknown lisa-test-run profile: ${argv[1]}`);
  }
  return {
    profile: argv[1],
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

/**
 * Move the run off a temp base too long for native Unix socket fixtures,
 * before the sweep reads it and the payload inherits it.
 */
function selectSocketSafeTempBase(): void {
  const current = os.tmpdir();
  const replacement = socketSafeTempBase(current);
  if (replacement === undefined) return;
  env.TMPDIR = replacement;
  process.stderr.write(
    `lisa-test-run: TMPDIR ${current} is too long for native Unix socket fixtures; using ${replacement}.\n`
  );
}

/** Run the public CLI and preserve the payload's result. */
async function main(): Promise<void> {
  const invocation = invocationOrExit();
  if (invocation === undefined) return;
  try {
    const dependencyProblem = worktreeDependencyProblem();
    if (dependencyProblem) throw new Error(dependencyProblem);
    selectSocketSafeTempBase();
    // After the temp base is final, so the sweep reads the TMPDIR the run uses.
    Object.assign(env, await startOfRunSweep(env));
    const payload = applyShardPlan(invocation.argv);
    if (typeof payload === "number") process.exit(payload);
    const release = await admitTestRun(payload, env, process.cwd());
    if (typeof release === "number") process.exit(release);
    const outcome = await runTestPayload(payload, env).finally(release);
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
