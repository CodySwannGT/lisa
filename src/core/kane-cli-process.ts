/** Process and host-browser boundary for the Kane adapter. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { env as processEnvironment } from "node:process";
import type {
  ChromeAvailabilityProbe,
  KaneCommandRunner,
} from "./kane-cli-types.js";

/**
 * Detect a locally installed Chromium-family browser without launching it.
 * @returns True when a supported browser path exists
 */
export const isChromeAvailable: ChromeAvailabilityProbe = () => {
  const configured = processEnvironment.CHROME_PATH;
  const programFiles = processEnvironment.PROGRAMFILES;
  const programFilesX86 = processEnvironment["PROGRAMFILES(X86)"];
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
 * Output and timeout state for one Kane invocation. The child reports its
 * streams through events until it closes, so the state accumulates on this
 * instance and is read once, when the close event settles the run.
 */
class KaneRunCapture {
  private stdout = "";
  private stderr = "";
  private timedOut = false;

  /**
   * Append a standard-output chunk.
   * @param chunk - Decoded output
   */
  appendStdout(chunk: string): void {
    this.stdout += chunk;
  }

  /**
   * Append a standard-error chunk.
   * @param chunk - Decoded output
   */
  appendStderr(chunk: string): void {
    this.stderr += chunk;
  }

  /**
   * Record a spawn or process error on its own standard-error line.
   * @param error - The error the child process emitted
   */
  recordError(error: Error): void {
    this.stderr += `${this.stderr.length === 0 ? "" : "\n"}${error.message}`;
  }

  /** Note that the deadline killed the child. */
  markTimedOut(): void {
    this.timedOut = true;
  }

  /**
   * Settle the run.
   * @param code - Exit code the child closed with, or null when signalled
   * @returns Captured exit code and streams
   */
  result(code: number | null): {
    exitCode: number;
    stdout: string;
    stderr: string;
  } {
    return {
      exitCode: this.timedOut ? 3 : (code ?? 2),
      stdout: this.stdout,
      stderr: this.stderr,
    };
  }
}

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
    const capture = new KaneRunCapture();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => capture.appendStdout(chunk));
    child.stderr.on("data", (chunk: string) => capture.appendStderr(chunk));
    child.on("error", error => capture.recordError(error));
    const timeout = setTimeout(() => {
      capture.markTimedOut();
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("close", code => {
      clearTimeout(timeout);
      resolve(capture.result(code));
    });
  });
