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
 *
 * ## Interrupting a run
 *
 * The deadline was never the only way a run ends early. An operator — or an
 * agent told to free a contended machine — kills the gate runner, and because
 * this supervisor holds the ONLY handle to the detached group it started,
 * killing its parent used to leave it reparented to pid 1 with the whole tree
 * still executing. Measured: the kill reported success, `pgrep` for the runner
 * returned nothing, and eleven processes carried on (CodySwannGT/lisa#3829).
 *
 * So the supervisor watches for the run it serves going away, tears the tree
 * down through the same single reap the deadline uses, and SAYS SO. A silent
 * teardown would be the same defect wearing a different face: the operator who
 * asked for the run to stop cannot tell a stop from a survival either way.
 * @module scripts/lib/process-tree-runner
 */

import { spawn, spawnSync } from "node:child_process";

import { invokedAsScript } from "./invoked-as-script.mjs";

const KILL_GRACE_MS = 750;
const REAP_POLL_MS = 25;
const WINDOWS_TIMEOUT_EXIT_CODE = 255;
const TERMINATING_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/**
 * How often the supervisor asks whether the run it serves is still there.
 *
 * Four times a second. This is a liveness poll, not a budget: the cost of
 * asking is one `kill(pid, 0)` per watched pid, and the cost of asking too
 * rarely is measured in whole test suites that keep running for a machine
 * nobody is watching any more.
 */
const ORPHAN_POLL_MS = 250;
const DEFAULT_REAP_CONTROLS = Object.freeze({
  kill: killTree,
  exists: treeExists,
  now: Date.now,
  wait: milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)),
});

/**
 * Represent a supervisor timeout at the synchronous parent boundary.
 * @param {string} platform Node platform identifier.
 * @returns {{code: number|null, signal: "SIGKILL"|null}} Parent verdict.
 */
export function timeoutVerdictForPlatform(platform) {
  return platform === "win32"
    ? { code: WINDOWS_TIMEOUT_EXIT_CODE, signal: null }
    : { code: null, signal: "SIGKILL" };
}

/**
 * Whether a pid is worth watching for disappearance.
 *
 * `1` is excluded on purpose rather than by accident. It is both the pid an
 * orphan is reparented ONTO and a process that never exits, so watching it
 * would arm a condition that can never fire while looking exactly like a
 * watch that is working.
 * @param {unknown} value A candidate pid.
 * @returns {boolean} Whether it names a process that can meaningfully die.
 */
export function isWatchablePid(value) {
  return Number.isInteger(value) && value > 1;
}

/**
 * Parse the pids this supervisor was asked to outlive nobody but.
 * @param {readonly string[]} argv Raw arguments.
 * @returns {number[]} Watchable pids, in the order given, without duplicates.
 */
export function parseWatchPids(argv) {
  const prefix = "--watch-pid=";
  const pids = argv
    .filter(value => value.startsWith(prefix))
    .map(value => Number(value.slice(prefix.length)))
    .filter(pid => isWatchablePid(pid));
  return [...new Set(pids)];
}

function parseArguments(argv) {
  const timeoutArg = argv.find(value => value.startsWith("--timeout-ms="));
  const separator = argv.indexOf("--");
  const timeoutMs = Number(timeoutArg?.slice("--timeout-ms=".length));
  const flags = separator >= 0 ? argv.slice(0, separator) : argv;
  const command = separator >= 0 ? argv.slice(separator + 1).join(" ") : "";
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !command) {
    throw new Error(
      "usage: process-tree-runner.mjs --timeout-ms=<positive-ms> " +
        "[--watch-pid=<pid>]... -- <command>"
    );
  }
  return { command, timeoutMs, watchPids: parseWatchPids(flags) };
}

/**
 * Whether a pid no longer names a live process.
 *
 * Fail-CLOSED, matching every other liveness question in this file: only the
 * kernel's `ESRCH` proves absence. An `EPERM` — a pid that outlived the run and
 * was reused by another user's process — means the question was refused, not
 * answered, and refusing to answer must never be read as "the run is over".
 * That direction matters here more than anywhere else in the module: a wrong
 * "gone" tears down a gate run that was still executing correctly.
 * @param {number} pid The process to ask about.
 * @param {typeof process.kill} probe Injectable process probe.
 * @returns {boolean} Whether the process is provably absent.
 */
export function pidIsGone(pid, probe = process.kill) {
  try {
    probe(pid, 0);
    return false;
  } catch (error) {
    return isAbsentProcessError(error);
  }
}

/**
 * Why this supervisor should stop, if it should.
 *
 * Two separable questions, deliberately answered in one place so the report
 * can name WHICH one fired:
 *
 * 1. **Orphaning.** The process that started this supervisor is gone, so the
 *    verdict this run would produce has no one left to receive it. Detected by
 *    comparing the parent pid captured at start against the live one — a
 *    reparented process reads `1` (or a subreaper) instead of its launcher.
 * 2. **A watched pid died.** The caller named a process further up the chain —
 *    a git hook, say — whose death means the run is moot even though this
 *    supervisor's own parent is still alive.
 *
 * Watch-pid absence is proved with `pidIsGone`, which fails closed; the
 * orphan check needs no such care because a changed parent pid is a fact the
 * kernel reports directly and cannot be refused.
 * @param {object} options Inputs.
 * @param {number} options.launchParentPid Parent pid captured at start.
 * @param {number} options.currentParentPid Parent pid right now.
 * @param {readonly number[]} [options.watchPids] Pids to outlive nobody but.
 * @param {(pid: number) => boolean} [options.gone] Injectable absence probe.
 * @returns {string|null} An operator-readable reason, or null to keep running.
 */
export function interruptionReason({
  launchParentPid,
  currentParentPid,
  watchPids = [],
  gone = pidIsGone,
}) {
  if (isWatchablePid(launchParentPid) && currentParentPid !== launchParentPid) {
    return `the run that started it (pid ${launchParentPid}) exited`;
  }
  const dead = watchPids.find(pid => gone(pid));
  if (dead !== undefined) return `the run it serves (pid ${dead}) exited`;
  return null;
}

/**
 * The line an interrupted supervisor leaves behind.
 *
 * A silent teardown reintroduces the defect in a different form: the operator
 * who asked for the run to stop gets the same silence whether it stopped or
 * kept running. So this states three things — that the run was INTERRUPTED
 * rather than completed, why, and what was terminated — and it goes to stderr,
 * which the gate runner inherits.
 * @param {string} reason Why the supervisor stopped.
 * @param {number} pid The process-group leader that was reaped.
 * @returns {string} One line, for stderr.
 */
export function interruptionReport(reason, pid) {
  return (
    `🛑 gate command INTERRUPTED — ${reason}; terminated its process tree ` +
    `(group ${pid}) and every descendant. Nothing was proved by it.`
  );
}

/** Whether a failed POSIX process-group operation proved the group is absent. */
function isAbsentProcessError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}

/** Whether a process-group probe was denied without proving liveness. */
function isPermissionError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPERM"
  );
}

/**
 * Inspect a POSIX group after kill(0) is denied.
 *
 * A successful `ps` invocation does not prove it could see every process.
 * Hardened `/proc` visibility can omit the target group entirely, so a missing
 * row is unknown rather than evidence that the group is absent.
 * @param {number} pid Process-group identifier.
 * @param {typeof spawnSync} execute Injectable process-listing command.
 * @returns {boolean|undefined} Runnable, non-runnable, or not observable.
 */
export function processGroupHasRunnableMember(pid, execute = spawnSync) {
  const result = execute("ps", ["-axo", "pgid=,stat="], {
    encoding: "utf8",
    timeout: KILL_GRACE_MS,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.signal ?? result.status;
    throw new Error(`could not inspect gate process group ${pid} (${detail})`);
  }
  let observedGroup = false;
  let incompleteGroupRow = false;
  for (const row of String(result.stdout ?? "").split("\n")) {
    const [group, state] = row.trim().split(/\s+/u);
    if (Number(group) !== pid) continue;
    if (!state) {
      incompleteGroupRow = true;
      continue;
    }
    observedGroup = true;
    if (!state.startsWith("Z")) return true;
  }
  return observedGroup && !incompleteGroupRow ? false : undefined;
}

/**
 * Prove whether a POSIX process group still needs reaping.
 * @param {number} pid Process-group identifier.
 * @param {typeof process.kill} probe Injectable process-group probe.
 * @param {(pid:number)=>boolean|undefined} inspect Injectable visibility fallback.
 * @returns {boolean} Whether the group has a runnable member.
 */
export function posixTreeExists(
  pid,
  probe = process.kill,
  inspect = processGroupHasRunnableMember
) {
  try {
    probe(-pid, 0);
    return true;
  } catch (error) {
    if (isAbsentProcessError(error)) return false;
    if (!isPermissionError(error)) throw error;
  }

  const observed = inspect(pid);
  if (observed !== undefined) return observed;

  // The first EPERM proved that absence was not established, while a missing
  // ps row proves nothing under restricted process visibility. Re-probe after
  // the listing and accept absence only from the kernel's ESRCH result.
  try {
    probe(-pid, 0);
    return true;
  } catch (error) {
    if (isAbsentProcessError(error)) return false;
    throw error;
  }
}

/**
 * Test a Windows PID without pretending every tree disappeared immediately.
 * `process.kill(pid, 0)` sends no signal; on Windows it is the only portable
 * Node primitive that distinguishes a live root process from an absent one.
 * @param {number} pid Process identifier.
 * @param {(pid:number, signal:number)=>void} probe Injectable process probe.
 * @returns {boolean} Whether the process still exists.
 */
export function windowsTreeExists(pid, probe = process.kill) {
  try {
    probe(pid, 0);
    return true;
  } catch (error) {
    // probe-direction: fail-closed — only an ESRCH-shaped error proves the
    // process is gone. A blanket `return false` reported EPERM, and every other
    // failure to ask, as "the tree exited": `killWindowsTree` then returns
    // without killing anything and `waitForTreeExit` stops waiting, so a live
    // tree is left behind and recorded as reaped. That is the exact rule
    // `killTree` states two functions below — "Only ESRCH proves absence.
    // EPERM and every other error leave cleanup authority uncertain and must
    // fail the supervisor closed" — which the POSIX sibling followed and this
    // one did not.
    if (isAbsentProcessError(error)) return false;
    throw error;
  }
}

/**
 * Ask Windows to terminate the complete descendant tree and verify a failed
 * native command did not leave its root alive.
 * @param {number} pid Process identifier.
 * @param {string} signal Graceful or forced phase.
 * @param {typeof spawnSync} execute Injectable native command runner.
 * @param {(pid:number)=>boolean} exists Injectable liveness check.
 */
export function killWindowsTree(
  pid,
  signal,
  execute = spawnSync,
  exists = windowsTreeExists
) {
  if (!exists(pid)) return;
  const args = ["/pid", String(pid), "/T"];
  if (signal === "SIGKILL") args.push("/F");
  const result = execute("taskkill", args, {
    stdio: "ignore",
    timeout: KILL_GRACE_MS,
  });
  if ((result.error || result.status !== 0) && exists(pid)) {
    const detail = result.error?.message ?? result.signal ?? result.status;
    throw new Error(`taskkill ${args.join(" ")} failed (${detail})`);
  }
}

function killTree(pid, signal) {
  if (process.platform === "win32") {
    // Windows has no negative-pid process groups. taskkill /T is the native
    // tree primitive; /F is used only for the escalation.
    killWindowsTree(pid, signal);
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    // Only ESRCH proves absence. EPERM and every other error leave cleanup
    // authority uncertain and must fail the supervisor closed.
    if (!isAbsentProcessError(error)) throw error;
  }
}

function treeExists(pid) {
  if (process.platform === "win32") return windowsTreeExists(pid);
  return posixTreeExists(pid);
}

async function waitForTreeExit(pid, deadline, controls) {
  while (controls.exists(pid)) {
    if (controls.now() >= deadline) return false;
    await controls.wait(REAP_POLL_MS);
  }
  return true;
}

export async function reapTree(pid, controls = DEFAULT_REAP_CONTROLS) {
  let gracefulFailure;
  try {
    controls.kill(pid, "SIGTERM");
  } catch (error) {
    // A graceful native termination failure still gets the forced phase. The
    // error becomes terminal only if escalation also leaves the tree alive.
    gracefulFailure = error;
  }
  try {
    if (await waitForTreeExit(pid, controls.now() + KILL_GRACE_MS, controls)) {
      return;
    }
  } catch (error) {
    gracefulFailure ??= error;
  }

  let forcedFailure;
  try {
    controls.kill(pid, "SIGKILL");
  } catch (error) {
    forcedFailure = error;
  }
  try {
    if (await waitForTreeExit(pid, controls.now() + KILL_GRACE_MS, controls)) {
      return;
    }
  } catch (error) {
    forcedFailure ??= error;
  }
  const failure = forcedFailure ?? gracefulFailure;
  if (failure !== undefined) {
    throw new Error(
      `gate process tree ${pid} could not be reaped: ${failure instanceof Error ? failure.message : String(failure)}`
    );
  }
  throw new Error(`gate process tree ${pid} survived SIGKILL`);
}

/**
 * Run one command as a supervised process tree.
 *
 * The supervisor answers to three ways a run can end early — its deadline, a
 * terminating signal, and now the run it serves going away — and all three
 * share one reap, because a tree reaped twice is a tree whose second kill
 * lands on a recycled pid.
 * @param {string} command Shell source to supervise.
 * @param {number} timeoutMs Deadline for the whole tree.
 * @param {typeof reapTree} [reap] Injectable group reaper.
 * @param {object} [options] Interrupt-watch seams, injectable for tests.
 * @param {readonly number[]} [options.watchPids] Pids whose death ends this run.
 * @param {typeof interruptionReason} [options.detect] Interrupt predicate.
 * @param {number} [options.pollMs] How often to ask.
 * @param {(line: string) => void} [options.report] Where the report goes.
 * @param {number} [options.launchParentPid] Parent pid captured at start.
 * @returns {Promise<{code: number|null, signal: string|null}>} The verdict.
 */
export function supervise(command, timeoutMs, reap = reapTree, options = {}) {
  const {
    watchPids = [],
    detect = interruptionReason,
    pollMs = ORPHAN_POLL_MS,
    report = line => process.stderr.write(`${line}\n`),
    launchParentPid = process.ppid,
  } = options;
  return new Promise((resolve, reject) => {
    const shell =
      process.platform === "win32"
        ? process.env.ComSpec || "cmd.exe"
        : "/bin/sh";
    const shellArgs =
      process.platform === "win32"
        ? ["/d", "/s", "/c", command]
        : ["-c", command];
    let pendingSignal;
    let dispatchSignal = signal => {
      pendingSignal ??= signal;
    };
    const signalHandlers = new Map();
    const clearSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
      signalHandlers.clear();
    };
    // Install a dispatcher before the detached child can publish readiness.
    // A signal delivered synchronously by an adversarial spawn seam is queued
    // until the child PID and cleanup deadline have both been initialized.
    for (const signal of TERMINATING_SIGNALS) {
      const handler = () => dispatchSignal(signal);
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    const child = (() => {
      try {
        return spawn(shell, shellArgs, {
          detached: true,
          env: process.env,
          stdio: "inherit",
        });
      } catch (error) {
        clearSignalHandlers();
        reject(error);
        return undefined;
      }
    })();
    if (child === undefined) return;

    const pid = child.pid;
    if (pid === undefined) {
      clearSignalHandlers();
      // Node reports asynchronous spawn failures through `error`, even though
      // the missing pid is observable synchronously. Route that late event to
      // the promise so it cannot become an unhandled EventEmitter failure.
      child.once("error", error => {
        reject(
          new Error(
            `gate process tree did not start: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      });
      return;
    }

    let timedOut = false;
    let settled = false;
    let settling = false;
    let terminating = false;
    let reapPromise;
    const clearDeadline = () => {
      clearTimeout(deadline);
    };
    const cleanup = () => {
      clearDeadline();
      clearInterval(interruptWatch);
      clearSignalHandlers();
    };
    // Every exit path shares one reap. A signal that arrives while the direct
    // shell's close handler is reaping must join that operation instead of
    // starting a second kill sequence or taking the default signal action.
    const reapOnce = () => {
      reapPromise ??= reap(pid);
      return reapPromise;
    };
    const finish = async (code, signal) => {
      if (settled || settling) return;
      settling = true;
      clearDeadline();
      // A command may leave a background descendant after its direct shell
      // exits. Reap that residue fully before returning a verdict too.
      try {
        await reapOnce();
        settled = true;
        cleanup();
        resolve({ code, signal });
      } catch (error) {
        failReap(error);
      }
    };

    const failReap = error => {
      if (settled) return;
      settled = true;
      cleanup();
      // A failed reap means the child may never emit another event. Detaching
      // the handle and rejecting makes the supervisor terminal instead of
      // leaving its promise pending behind a live event-loop reference.
      child.unref();
      reject(
        new Error(
          `gate process-tree supervisor failed: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    };

    // Both early-stop paths below end the same way: reap the tree ONCE, say
    // what was terminated, then take the signal-shaped exit. `stopWith` exists
    // so the reporting cannot drift between them — a signal that tears the
    // tree down silently and a watch that reports is the same defect twice.
    const stopWith = (reason, signal) => {
      if (terminating || settled) return;
      terminating = true;
      settling = true;
      clearDeadline();
      clearInterval(interruptWatch);
      reapOnce().then(() => {
        cleanup();
        report(interruptionReport(reason, pid));
        // Restore the signal-shaped exit after the detached tree is gone.
        process.kill(process.pid, signal);
      }, failReap);
    };
    const relaySignal = signal => {
      stopWith(`it received ${signal}`, signal);
    };
    // The wiring this module always had the means for and nothing invoked.
    // Without it, killing the gate runner leaves this supervisor reparented to
    // pid 1 with its whole detached tree still executing — measured, and the
    // reason the tree survives is precisely that this supervisor holds the
    // only handle to it. Nothing else on the machine knows the group id.
    const interruptWatch = setInterval(() => {
      if (terminating || settling || settled) return;
      const reason = detect({
        launchParentPid,
        currentParentPid: process.ppid,
        watchPids,
      });
      // SIGTERM rather than the signal nobody sent: this supervisor was not
      // signalled, it outlived its purpose, and SIGTERM is the vocabulary the
      // gate runner already reads as "terminated, therefore no verdict".
      if (reason !== null) stopWith(reason, "SIGTERM");
    }, pollMs);
    const deadline = setTimeout(() => {
      timedOut = true;
      terminating = true;
      settling = true;
      clearDeadline();
      reapOnce().then(() => {
        cleanup();
        const verdict = timeoutVerdictForPlatform(process.platform);
        // A signal-shaped result is the existing gate runner vocabulary for
        // "no verdict". It also prevents an ordinary exit code such as 124
        // from being confused with a user command that returned that code.
        if (verdict.signal === null) {
          // Windows has no signal-shaped process result. 255 is a dedicated
          // supervisor timeout code with a documented (but unavoidable)
          // collision risk, well outside ordinary command exit conventions.
          process.exit(verdict.code);
        } else {
          process.kill(process.pid, verdict.signal);
        }
      }, failReap);
    }, timeoutMs);

    dispatchSignal = relaySignal;
    child.once("error", error => {
      if (settled || settling) return;
      settling = true;
      clearDeadline();
      reapOnce().then(() => {
        settled = true;
        cleanup();
        reject(error);
      }, failReap);
    });
    child.once("close", (code, signal) => {
      // On timeout, wait for the forced group reap above before this supervisor
      // ends. Exiting on the direct shell's close is the race that used to leave
      // its descendants alive.
      if (!timedOut) void finish(code, signal);
    });

    if (pendingSignal !== undefined) relaySignal(pendingSignal);
  });
}

async function main() {
  const { command, timeoutMs, watchPids } = parseArguments(
    process.argv.slice(2)
  );
  const result = await supervise(command, timeoutMs, reapTree, { watchPids });
  if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exitCode = result.code ?? 1;
  }
}

if (invokedAsScript(import.meta.url)) {
  await main();
}
