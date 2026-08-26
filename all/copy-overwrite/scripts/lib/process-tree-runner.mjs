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
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      // A command may leave a background descendant after its direct shell
      // exits. Reap that residue before returning a verdict too.
      killTree(pid, "SIGTERM");
      resolve({ code, signal });
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      killTree(pid, "SIGTERM");
      setTimeout(() => {
        killTree(pid, "SIGKILL");
        // A signal-shaped result is the existing gate runner vocabulary for
        // "no verdict". It also prevents an ordinary exit code such as 124
        // from being confused with a user command that returned that code.
        if (process.platform === "win32") {
          process.exit(124);
        } else {
          process.kill(process.pid, "SIGKILL");
        }
      }, KILL_GRACE_MS);
    }, timeoutMs);

    child.once("error", error => {
      clearTimeout(deadline);
      killTree(pid, "SIGKILL");
      reject(error);
    });
    child.once("close", (code, signal) => {
      // On timeout, wait for the forced group reap above before this supervisor
      // ends. Exiting on the direct shell's close is the race that used to leave
      // its descendants alive.
      if (!timedOut) finish(code, signal);
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
