#!/usr/bin/env node
/** Public entrypoint for birth-bound test supervision and scratch cleanup. */
import { invokedAsScript } from "../../scripts/lib/invoked-as-script.mjs";

import {
  resolveScratchRouteProfile,
  type ScratchRouteProfile,
} from "../configs/vitest/scratch-route-profile.js";
import { superviseTestRun } from "./lisa-test-run-supervisor.js";

export { assertTestRunPlatform } from "./lisa-test-run-platform.js";

/** Dedicated operational-failure exit status. */
const OPERATIONAL_FAILURE_EXIT = 1;

/** Fully parsed public invocation before scratch authority is created. */
interface TestRunInvocation {
  readonly profile: ScratchRouteProfile;
  readonly argv: readonly [string, ...string[]];
}

/**
 * Parse the exact public `--profile <route> -- <command>` syntax.
 * @param argv - Public CLI arguments
 * @returns Validated route profile and payload argv
 */
function commandArgv(argv: readonly string[]): TestRunInvocation {
  if (
    argv[0] !== "--profile" ||
    argv[1] === undefined ||
    argv[2] !== "--" ||
    argv.length < 4 ||
    argv[3] === undefined
  ) {
    throw new Error(
      "Usage: lisa-test-run --profile <route> -- <executable> [args...]"
    );
  }
  return {
    profile: resolveScratchRouteProfile(argv[1]),
    argv: argv.slice(3) as [string, ...string[]],
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
    const outcome = await superviseTestRun(invocation.argv, invocation.profile);
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
