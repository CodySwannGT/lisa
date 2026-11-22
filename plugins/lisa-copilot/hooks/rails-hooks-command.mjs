// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded local Git/Bundler children used by Rails hook installation. */
import { spawn } from "node:child_process";

const REPOSITORY_ENVIRONMENT = new Set([
  "GIT_DIR",
  "GIT_COMMON_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
]);
const MAX_OUTPUT_BYTES = 16 * 1024;

/**
 * Execute one fixed local tool, killing its owned process group at the deadline.
 * @param {string} command Tool selected by the caller, never a shell expression.
 * @param {string[]} args Literal arguments.
 * @param {{cwd: string, timeoutMs: number, signal?: AbortSignal, env?: NodeJS.ProcessEnv, capture?: boolean}} options Execution scope.
 * @returns {Promise<{code: number|null, reason: string|null, stdout: string}>} Actual child outcome.
 */
export function runHookCommand(command, args, options) {
  if (options.signal?.aborted)
    return Promise.resolve({ code: null, reason: "ABORT_ERR", stdout: "" });
  return new Promise(resolve => {
    const env = Object.fromEntries(
      Object.entries(options.env ?? process.env).filter(
        ([name]) => !REPOSITORY_ENVIRONMENT.has(name)
      )
    );
    const budget = Math.max(1, Math.floor(options.timeoutMs));
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      detached: grouped,
      stdio: ["ignore", options.capture ? "pipe" : "ignore", "ignore"],
      // The owned timer kills the whole POSIX group first. Node's immediate-
      // child timeout is a second bounded backstop, not the cleanup mechanism.
      timeout: budget + 1_000,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    let finished = false;
    let reason = null;
    let bytes = 0;
    const chunks = [];
    const stop = failure => {
      if (finished) return;
      reason ??= failure;
      try {
        if (grouped && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // A group that has already exited needs no further signal.
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(() => stop("ETIMEDOUT"), budget);
    const abort = () => stop("ABORT_ERR");
    const complete = (code, failure) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({
        code,
        reason: reason ?? failure,
        stdout: Buffer.concat(chunks).toString("utf8"),
      });
    };
    child.stdout?.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) stop("OUTPUT_LIMIT");
      else chunks.push(chunk);
    });
    child.once("error", error => complete(null, error.code ?? "SPAWN_FAILED"));
    child.once("close", (code, signal) => complete(code, signal));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
