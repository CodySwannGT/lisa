// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// The Windows-only helper owns a Job Object until all of its processes exit.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

const CLEANUP_TIMEOUT_MS = 30000;

/**
 * Launch the Windows shell in a native job using a temporary control directory.
 * The returned cleanup asks a running helper to stop and resolves only after
 * the helper confirms that its job is empty. Scratch is removed when the helper
 * closes or fails to start.
 * @param {string} command Shell source to run.
 * @returns {{child: import("node:child_process").ChildProcess, reap: () => Promise<void>}}
 * Native process boundary whose cleanup rejects when the helper cannot verify
 * an empty job.
 * @throws {Error} When temporary directory creation or synchronous spawn setup
 * fails.
 */
export function startWindowsProcessJob(command) {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-windows-job-"));
  const powershell = path.join(
    env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const script = fileURLToPath(
    new URL("./windows-process-job.ps1", import.meta.url)
  );
  let child;
  try {
    child = spawn(
      powershell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script],
      {
        // The native job supplies isolation. Keep the helper attached so
        // Windows PowerShell retains the caller's standard handles.
        stdio: "inherit",
        env: {
          ...env,
          TEMP: directory,
          TMP: directory,
          LISA_WINDOWS_PROCESS_JOB: JSON.stringify({
            command,
            directory,
            parentPid: process.pid,
            cwd: process.cwd(),
            originalTemp: env.TEMP ?? null,
            originalTmp: env.TMP ?? null,
          }),
        },
      }
    );
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  let closed = false;
  const completion = new Promise(resolve => {
    child.once("close", () => {
      closed = true;
      resolve();
    });
    child.once("error", () => {
      if (child.pid === undefined)
        rmSync(directory, { recursive: true, force: true });
    });
  });
  const reap = async () => {
    let timer;
    try {
      if (!closed) writeFileSync(path.join(directory, "stop"), "stop");
      await Promise.race([
        completion,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            // Killing the owner closes its job handle as a last resort, but
            // cannot supply a completed wait: reject instead of claiming reap.
            child.kill("SIGKILL");
            reject(
              new Error("Windows gate helper did not complete its cleanup wait")
            );
          }, CLEANUP_TIMEOUT_MS);
        }),
      ]);
      if (readFileSync(path.join(directory, "reaped"), "utf8") !== "reaped") {
        throw new Error("Windows gate helper did not confirm an empty job");
      }
    } catch (error) {
      throw new Error(
        `Windows gate cleanup was not verified (helper exit ${child.exitCode ?? child.signalCode ?? "pending"}): ${error.message}`
      );
    } finally {
      clearTimeout(timer);
      if (!closed) {
        // Give a killed helper time to close before a CLI rejection exits Node.
        // Still bound failure when the OS cannot stop the helper promptly.
        await Promise.race([
          completion,
          new Promise(resolve => {
            timer = setTimeout(resolve, 1000);
          }),
        ]);
        clearTimeout(timer);
      }
      if (closed) rmSync(directory, { recursive: true, force: true });
      else
        child.once("close", () =>
          rmSync(directory, { recursive: true, force: true })
        );
    }
  };
  return { child, reap };
}
