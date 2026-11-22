/**
 * The one shell-free `gh` call site in the CLI.
 * @module cli/gh-cli
 */
import { execFile } from "node:child_process";

import { spawnTarget } from "../utils/resolve-executable.js";

/**
 * Run `gh` without a shell and return stdout.
 *
 * Exported so every `gh` read in the CLI goes through one shell-free call site.
 * A second one would mean a second place to get argument handling and
 * executable resolution right.
 * @param args - gh argv after the executable
 * @param cwd - Working directory
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation signal
 * @param maxBuffer - Optional output bound for paginated reads.
 * @returns Trimmed stdout
 */
export function runGh(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
  maxBuffer?: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Throws ExecutableNotFoundError (code ENOENT) when gh is not installed;
    // inside the executor that rejects, exactly as execFile's ENOENT did.
    const gh = spawnTarget("gh", args);
    execFile(
      gh.file,
      [...gh.args],
      {
        cwd,
        signal,
        timeout: timeoutMs,
        ...(maxBuffer === undefined ? {} : { maxBuffer }),
        encoding: "utf8",
        windowsVerbatimArguments: gh.windowsVerbatimArguments,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(Object.assign(error, { stderr }));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}
