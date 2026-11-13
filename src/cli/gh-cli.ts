/**
 * The one shell-free `gh` call site in the CLI.
 * @module cli/gh-cli
 */
import { execFile } from "node:child_process";

/**
 * Run `gh` without a shell and return stdout.
 *
 * Exported so every `gh` read in the CLI goes through one shell-free call site.
 * A second one would mean a second place to get argument handling and the
 * command-from-PATH exemption right.
 * @param args - gh argv after the executable
 * @param cwd - Working directory
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation signal
 * @returns Trimmed stdout
 */
export function runGh(
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const ghExecutable = "gh";
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed gh executable
      ghExecutable,
      [...args],
      { cwd, signal, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}
