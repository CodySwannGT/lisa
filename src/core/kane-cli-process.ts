/** Process and host-browser boundary for the Kane adapter. */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import type {
  ChromeAvailabilityProbe,
  KaneCommandRunner,
} from "./kane-cli-types.js";

/**
 * Detect a locally installed Chromium-family browser without launching it.
 * @returns True when a supported browser path exists
 */
export const isChromeAvailable: ChromeAvailabilityProbe = () => {
  // eslint-disable-next-line no-restricted-syntax -- explicit user browser override
  const configured = process.env.CHROME_PATH;
  // eslint-disable-next-line no-restricted-syntax -- Windows installation root discovery
  const programFiles = process.env.PROGRAMFILES;
  // eslint-disable-next-line no-restricted-syntax -- Windows x86 installation root discovery
  const programFilesX86 = process.env["PROGRAMFILES(X86)"];
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
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed executable and argv
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    /* eslint-disable functional/no-let -- child streams accumulate until the close event */
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    /* eslint-enable functional/no-let -- accumulation ends with this promise */
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", error => {
      stderr += `${stderr.length === 0 ? "" : "\n"}${error.message}`;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("close", code => {
      clearTimeout(timeout);
      resolve({
        exitCode: timedOut ? 3 : (code ?? 2),
        stdout,
        stderr,
      });
    });
  });
