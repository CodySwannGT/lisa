#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Run one shell command in its own process group and reap the whole group.
 *
 * Node's synchronous timeout signals only the direct child. A gate command is
 * a tree (shell, package manager, test workers), so killing only the shell
 * leaves descendants running against scratch state the caller then removes.
 * This small asynchronous supervisor is invoked through a synchronous parent:
 * it owns the process-group id, applies the deadline, terminates the group, and
 * only then lets the parent continue.
 * @module scripts/lib/process-tree-runner
 */

import { spawn, spawnSync } from "node:child_process";

import { invokedAsScript } from "./invoked-as-script.mjs";

const KILL_GRACE_MS = 750;
const REAP_POLL_MS = 25;
const WINDOWS_TIMEOUT_EXIT_CODE = 255;
const TERMINATING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const DEFAULT_REAP_CONTROLS = Object.freeze({
  kill: killTree,
  exists: treeExists,
  now: Date.now,
  wait: milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)),
});

function parseArguments(argv) {
  const timeoutArg = argv.find(value => value.startsWith("--timeout-ms="));
  const separator = argv.indexOf("--");
  const timeoutMs = Number(timeoutArg?.slice("--timeout-ms=".length));
  const command = separator >= 0 ? argv.slice(separator + 1).join(" ") : "";
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !command) {
    throw new Error(
      "usage: process-tree-runner.mjs --timeout-ms=<positive-ms> -- <command>"
    );
  }
  return { command, timeoutMs };
}

function killTree(pid, signal) {
  if (process.platform === "win32") {
    // Windows has no negative-pid process groups. taskkill /T is the native
    // tree primitive; /F is used only for the escalation.
    const args = ["/pid", String(pid), "/T"];
    if (signal === "SIGKILL") args.push("/F");
    spawnSync("taskkill", args, { stdio: "ignore", timeout: KILL_GRACE_MS });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH means the whole group already exited.
  }
}

function treeExists(pid) {
  if (process.platform === "win32") return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForTreeExit(pid, deadline, controls) {
  while (controls.exists(pid)) {
    if (controls.now() >= deadline) return false;
    await controls.wait(REAP_POLL_MS);
  }
  return true;
}

export async function reapTree(pid, controls = DEFAULT_REAP_CONTROLS) {
  controls.kill(pid, "SIGTERM");
  if (await waitForTreeExit(pid, controls.now() + KILL_GRACE_MS, controls)) {
    return;
  }

  controls.kill(pid, "SIGKILL");
  if (!(await waitForTreeExit(pid, controls.now() + KILL_GRACE_MS, controls))) {
    throw new Error(`gate process tree ${pid} survived SIGKILL`);
  }
}

export function supervise(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const shell =
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "/bin/sh";
    const shellArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-c", command];
    const child = spawn(shell, shellArgs, {
      detached: true,
      env: process.env,
      stdio: "inherit",
    });
    const pid = child.pid;
    if (pid === undefined) {
      reject(new Error("gate process tree did not start"));
      return;
    }

    let timedOut = false;
    let settled = false;
    let terminating = false;
    const signalHandlers = new Map();
    const cleanup = () => {
      clearTimeout(deadline);
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
      signalHandlers.clear();
    };
    const finish = async (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      // A command may leave a background descendant after its direct shell
      // exits. Reap that residue fully before returning a verdict too.
      try {
        await reapTree(pid);
        resolve({ code, signal });
      } catch (error) {
        reject(error);
      }
    };

    const reportReapFailure = error => {
      console.error(
        `gate process-tree supervisor failed: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    };

    const relaySignal = signal => {
      if (terminating) return;
      terminating = true;
      cleanup();
      reapTree(pid).then(() => {
        // Restore the signal-shaped exit after the detached tree is gone.
        process.kill(process.pid, signal);
      }, reportReapFailure);
    };
    for (const signal of TERMINATING_SIGNALS) {
      const handler = () => relaySignal(signal);
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }

    const deadline = setTimeout(() => {
      timedOut = true;
      cleanup();
      reapTree(pid).then(() => {
        // A signal-shaped result is the existing gate runner vocabulary for
        // "no verdict". It also prevents an ordinary exit code such as 124
        // from being confused with a user command that returned that code.
        if (process.platform === "win32") {
          // Windows has no signal-shaped process result. 255 is a dedicated
          // supervisor timeout code with a documented (but unavoidable)
          // collision risk, well outside ordinary command exit conventions.
          process.exit(WINDOWS_TIMEOUT_EXIT_CODE);
        } else {
          process.kill(process.pid, "SIGKILL");
        }
      }, reportReapFailure);
    }, timeoutMs);

    child.once("error", error => {
      if (settled) return;
      settled = true;
      cleanup();
      reapTree(pid).then(
        () => reject(error),
        reapError => reject(reapError)
      );
    });
    child.once("close", (code, signal) => {
      // On timeout, wait for the forced group reap above before this supervisor
      // ends. Exiting on the direct shell's close is the race that used to leave
      // its descendants alive.
      if (!timedOut) void finish(code, signal);
    });
  });
}

async function main() {
  const { command, timeoutMs } = parseArguments(process.argv.slice(2));
  const result = await supervise(command, timeoutMs);
  if (result.signal) {
    process.exitCode = 128;
  } else {
    process.exitCode = result.code ?? 1;
  }
}

if (invokedAsScript(import.meta.url)) {
  await main();
}
