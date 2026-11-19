/** Process and host-browser boundary for the Kane adapter. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { text } from "node:stream/consumers";
import { readEnv } from "../utils/process-environment.js";
import type {
  ChromeAvailabilityProbe,
  KaneCommandResult,
  KaneCommandRunner,
} from "./kane-cli-types.js";

/**
 * Detect a locally installed Chromium-family browser without launching it.
 * @returns True when a supported browser path exists
 */
export const isChromeAvailable: ChromeAvailabilityProbe = () => {
  const configured = readEnv("CHROME_PATH");
  const programFiles = readEnv("PROGRAMFILES");
  const programFilesX86 = readEnv("PROGRAMFILES(X86)");
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    programFiles === undefined
      ? undefined
      : path.join(
          programFiles,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        ),
    programFilesX86 === undefined
      ? undefined
      : path.join(
          programFilesX86,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        ),
  ];
  return candidates.some(
    candidate => candidate !== undefined && existsSync(candidate)
  );
};

/**
 * Run a fixed-argv Kane child process without shell interpolation.
 * @param executable - Executable name
 * @param args - Fixed argument vector
 * @param options - Working directory, timeout, and environment
 * @returns Captured exit code and streams
 */
export const runKaneCommand: KaneCommandRunner = async (
  executable,
  args,
  options
) =>
  await new Promise(resolve => {
    // Kane is an explicitly configured user-installed CLI.
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Each piece of the result is a promise the child's own events settle, so
    // nothing accumulates in mutable state between the events.
    const stdout = text(child.stdout);
    const stderr = text(child.stderr);
    const failure = new Promise<string>(settle =>
      child.on("error", error => settle(error.message))
    );
    const timedOut = new Promise<boolean>(settle => {
      const timeout = setTimeout(() => {
        settle(true);
        child.kill("SIGKILL");
      }, options.timeoutMs);
      child.once("close", () => {
        clearTimeout(timeout);
        settle(false);
      });
    });
    child.once("close", code => {
      resolve(settleKaneRun(code, stdout, stderr, failure, timedOut));
    });
  });

/**
 * Assemble the result once the child has closed.
 * @param code - Exit code the child closed with, or null when signalled
 * @param stdout - The child's whole standard output
 * @param stderr - The child's whole standard error
 * @param failure - The spawn or process error's message, if one was emitted
 * @param timedOut - Whether the deadline killed the child
 * @returns Captured exit code and streams; a process error is appended to
 * standard error on its own line
 */
async function settleKaneRun(
  code: number | null,
  stdout: Promise<string>,
  stderr: Promise<string>,
  failure: Promise<string>,
  timedOut: Promise<boolean>
): Promise<KaneCommandResult> {
  const [out, err, message, killed] = await Promise.all([
    stdout,
    stderr,
    // An error, when there is one, is emitted before close.
    Promise.race([failure, Promise.resolve("")]),
    timedOut,
  ]);
  const separator = err.length === 0 || message.length === 0 ? "" : "\n";
  return {
    exitCode: killed ? 3 : (code ?? 2),
    stdout: out,
    stderr: `${err}${separator}${message}`,
  };
}
