#!/usr/bin/env node
/** Public entrypoint for birth-bound test supervision and scratch cleanup. */
// @ts-expect-error -- the shipped JavaScript helper carries the same checked JSDoc signature
import { invokedAsScript } from "../../scripts/lib/invoked-as-script.mjs";

import {
  resolveScratchRouteProfile,
  type ScratchRouteProfile,
} from "../configs/vitest/scratch-route-profile.js";
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

/** Run the public CLI and preserve the child result only after cleanup. */
async function main(): Promise<void> {
  const invocation = invocationOrExit();
  if (invocation === undefined) return;
  try {
    const outcome = await superviseTestRun(
      invocation.argv,
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
