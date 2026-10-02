/* eslint-disable code-organization/enforce-statement-order -- Open the command log before spawning the process that writes it. */
/** Bounded subprocesses for the real packed-host verification journey. */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";

/**
 * Run an actual child while leaving the loopback registry event loop available.
 * @param command - Actual child executable
 * @param args - Actual child arguments
 * @param cwd - Child working directory
 * @param env - Explicit child process environment
 * @param logs - Evidence log directory
 * @param label - Named evidence log boundary
 * @param baseMs - Quiet-box child deadline in milliseconds
 */
export async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  logs: string,
  label: string,
  baseMs = 30_000
): Promise<void> {
  const file = path.join(logs, `${label}.log`);
  const started = performance.now();
  const fd = fs.openSync(file, "a");
  fs.writeSync(
    fd,
    `${new Date().toISOString()} ${JSON.stringify([command, ...args])}\n`
  );
  const child = spawn(command, [...args], {
    cwd,
    env,
    stdio: ["ignore", fd, fd],
    detached: process.platform !== "win32",
  });
  const timer = setTimeout(() => {
    if (child.pid === undefined) return;
    if (process.platform === "win32") child.kill("SIGKILL");
    else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          child.kill("SIGKILL");
      }
    }
  }, ioLatencyBudgetMs(baseMs));
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", error => {
        child.removeAllListeners("close");
        reject(new Error(`${label}: ${error.message}`));
      });
      child.once("close", (code, signal) => {
        fs.writeSync(
          fd,
          `elapsed_ms=${Math.round(performance.now() - started)} exit=${code} signal=${signal}\n`
        );
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `${label}: exit ${code}, signal ${signal}\n${fs.readFileSync(file, "utf8").slice(-8_000)}`
            )
          );
      });
    });
  } finally {
    clearTimeout(timer);
    fs.closeSync(fd);
  }
}

/* eslint-enable code-organization/enforce-statement-order -- End the chronological fixture harness. */
