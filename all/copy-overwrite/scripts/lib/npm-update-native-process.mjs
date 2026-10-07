// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Literal native process supervision and capture preserve argv/stdin/status and cancellation. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { required } from "./npm-update-contract.mjs";
import { recordNativeFailure } from "./npm-update-invariants.mjs";

/** The complete supervisor vector, including its control overhead, is bounded literal data. */
function supervisedArguments(vector) {
  required(
    vector.length <= 512 &&
      vector.every(
        value =>
          typeof value === "string" &&
          !value.includes("\0") &&
          Buffer.byteLength(value) <= 65_536
      ) &&
      Buffer.byteLength(JSON.stringify(vector)) <= 262_144,
    "invalid or unbounded supervised argument vector"
  );
  return vector;
}

/** Explicit direct argv preserves authenticated bootstrap arguments without a shell hop. */
function startSupervised(command, args, timeout, cwd, env) {
  const supervisor = fileURLToPath(
    new URL("./process-tree-runner.mjs", import.meta.url)
  );
  required(
    typeof command === "string" && command.length > 0 && Array.isArray(args),
    "literal executable and arguments required"
  );
  return spawn(
    process.execPath,
    supervisedArguments([
      supervisor,
      `--timeout-ms=${timeout}`,
      `--watch-pid=${process.pid}`,
      "--direct-argv",
      "--",
      command,
      ...args,
    ]),
    { cwd, env, stdio: ["pipe", "pipe", "pipe"] }
  );
}

/**
 * Execute argv data in an owned session; timeout/output overflow never returns success.
 * @param {string} command Literal executable.
 * @param {string[]} args Original argument vector.
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, input?: string | Buffer,
 * timeout?: number, allowed?: number[], maximum?: number,
 * signal?: AbortSignal}} [options] Bounded execution.
 * @returns {Promise<{code: number, stdout: Buffer, stderr: Buffer}>} Actual child result.
 */
export function runProcess(
  command,
  args,
  {
    cwd,
    env,
    input,
    timeout = 30_000,
    allowed = [0],
    maximum = 3_145_728,
    signal: abortSignal,
  } = {}
) {
  required(
    process.platform !== "win32",
    "owned process sessions require Linux or macOS"
  );
  required(
    Number.isInteger(timeout) && timeout > 0 && timeout <= 1_800_000,
    "invalid child deadline"
  );
  required(
    abortSignal === undefined || abortSignal instanceof AbortSignal,
    "invalid child cancellation signal"
  );
  required(!abortSignal?.aborted, "child was cancelled before execution");
  return new Promise((resolve, reject) => {
    const child = startSupervised(command, args, timeout, cwd, env);
    captureProcess(child, {
      command,
      input,
      timeout,
      allowed,
      maximum,
      abortSignal,
    }).then(resolve, reject);
  });
}

/** Native close, not cancellation delivery, completes an owned child. */
function captureProcess(
  child,
  { command, input, timeout, allowed, maximum, abortSignal }
) {
  return new Promise((resolveResult, reject) => {
    const chunks = [];
    const errors = [];
    let size = 0;
    let failure;
    let category;
    let errno;
    let closed = false;
    const stop = (reason, kind) => {
      if (!failure) {
        failure = new Error(`npm updater: ${reason}`);
        category = kind;
      }
      if (!closed && child.pid) child.kill("SIGTERM");
    };
    const abort = () => stop("child was cancelled", "cancelled");
    abortSignal?.addEventListener("abort", abort, { once: true });
    if (abortSignal?.aborted) abort();
    const timer = setTimeout(
      () => stop("child exceeded deadline", "deadline"),
      timeout
    );
    const collect = target => data => {
      size += data.length;
      if (size > maximum) stop("child output exceeded bound", "output-bound");
      else target.push(data);
    };
    child.stdout.on("data", collect(chunks));
    child.stderr.on("data", collect(errors));
    child.on("error", error => {
      failure = error;
      category = "spawn-error";
      errno = error.code;
    });
    child.stdin.on("error", error => {
      if (error.code !== "EPIPE") stop("child input failed", "input-failed");
    });
    child.stdin.end(input);
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      abortSignal?.removeEventListener("abort", abort);
      if (failure || signal || !allowed.includes(code)) {
        const error =
          failure ?? new Error(`npm updater: child failed (${code ?? signal})`);
        recordNativeFailure(
          error,
          category ?? (signal ? "signal" : "exit"),
          code,
          signal,
          errno
        );
        reject(
          Object.assign(error, {
            stdout: Buffer.concat(chunks),
            stderr: Buffer.concat(errors),
            command,
            code,
            nativeCompleted: !failure && !signal,
          })
        );
        return;
      }
      resolveResult({
        code,
        stdout: Buffer.concat(chunks),
        stderr: Buffer.concat(errors),
      });
    });
  });
}
