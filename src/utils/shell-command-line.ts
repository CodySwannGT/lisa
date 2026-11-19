/**
 * @file shell-command-line.ts
 * @description Builds the one shell invocation Lisa makes on purpose: running
 * an operator's whole command line (`lisa admit -- "bun run typecheck"`)
 * exactly as their shell would run it unadmitted.
 *
 * It is what Node's `shell: true` does, made explicit so the interpreter is an
 * absolute path rather than a `PATH` lookup and the one place a command line
 * reaches a shell is a small, tested function: `/bin/sh -c <line>` on POSIX,
 * `<absolute cmd.exe> /d /s /c "<line>"` with verbatim arguments on Windows.
 * The line is passed as a single argument and never assembled from parts, so
 * nothing Lisa adds is ever interpreted by the shell.
 * @module utils
 */
import { platform } from "node:process";

import { currentEnvironment } from "./process-environment.js";
import {
  commandInterpreter,
  type ExecutableSearchContext,
  type SpawnTarget,
} from "./resolve-executable.js";

/** The POSIX shell Node's own `shell: true` runs. */
const POSIX_SHELL = "/bin/sh";

/**
 * Builds what to spawn to run one command line through the platform's shell.
 * @param line - The operator's command line, passed through unchanged
 * @param context - Platform and environment; defaults to this process now
 * @returns The absolute shell, its argv, and `windowsVerbatimArguments`
 */
export function shellCommandLine(
  line: string,
  context: ExecutableSearchContext = {
    environment: currentEnvironment(),
    platform,
  }
): SpawnTarget {
  if (context.platform !== "win32") {
    return {
      file: POSIX_SHELL,
      args: ["-c", line],
      windowsVerbatimArguments: false,
    };
  }
  return {
    file: commandInterpreter(context.environment),
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}
