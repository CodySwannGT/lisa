/**
 * Bounded, process-group-scoped bash execution for tests that run real shell
 * scripts.
 *
 * Why this exists rather than `promisify(execFile)`:
 *
 * Fixtures that shell out to a script spawn a *tree* — bash, and under it `jq`,
 * `node -e`, and `git`. Two independent properties of the plain `execFile` path
 * combine into a process leak that has twice required manual cleanup (142 stale
 * trees on 2026-08-13, 227 on 2026-08-21):
 *
 * 1. `execFile`'s `timeout` / `killSignal` signal **only the direct child**.
 *    Killing bash reparents its still-running grandchildren to PID 1, which is
 *    precisely the observed orphan signature — the survivors are never bash,
 *    they are `jq`, `node -e`, and `git` sitting at PPID 1 at ~0% CPU.
 * 2. Nothing bounds the child's lifetime, and teardown lives only in an
 *    in-process `afterEach`, which cannot run when the worker itself is killed
 *    (SIGTERM/SIGKILL under load — the exit 143 / 137 this suite sees).
 *
 * So the child is spawned `detached`, making it the leader of a new process
 * group, and every teardown path signals the **group** (`process.kill(-pid)`).
 * That reaps grandchildren, which a direct-child kill provably does not.
 *
 * @module tests/helpers/bounded-bash
 */
import { spawn } from "node:child_process";
import { latch } from "./latch.js";

/** Absolute bash, so a writeable `PATH` entry cannot choose the shell. */
const BASH = "/bin/bash";

/** Default wall-clock bound for a single fixture script run. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Grace period between the group SIGTERM and the group SIGKILL. */
const KILL_GRACE_MS = 2_000;

/**
 * Process groups spawned by this module that have not yet been reaped.
 *
 * The one mutable cell this module keeps, deliberately: it is the registry of
 * live OS process groups, which the process-exit and signal handlers below
 * must reach after every caller's stack has gone. Nothing returned from a run
 * can carry it there. The cell is replaced with a new immutable set on every
 * change rather than mutated in place.
 */
// Owner: the process exit/SIGINT/SIGTERM/SIGHUP handlers below (reapLiveGroups).
const liveGroups: { current: ReadonlySet<number> } = { current: new Set() };

/** Options accepted by {@link runBoundedBash}. */
export type BoundedBashOptions = {
  /** Working directory for the script. */
  readonly cwd?: string;
  /** Environment for the script. */
  readonly env?: NodeJS.ProcessEnv;
  /** Wall-clock bound in milliseconds. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
};

/** Result of a successful {@link runBoundedBash} call. */
export type BoundedBashResult = {
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Signal an entire process group, ignoring the race where it already exited.
 * @param pid - Process-group leader pid (the detached child).
 * @param signal - Signal to deliver to the group.
 */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is already gone. Nothing to reap.
  }
}

/**
 * Terminate a spawned process group: SIGTERM, then SIGKILL after a grace period.
 * @param pid - Process-group leader pid.
 */
function terminateGroup(pid: number): void {
  const escalation = setTimeout(() => {
    killGroup(pid, "SIGKILL");
  }, KILL_GRACE_MS);
  escalation.unref();
  killGroup(pid, "SIGTERM");
}

/**
 * Reap every process group this module still has outstanding.
 *
 * Exported so a suite can assert the teardown path directly, and wired to
 * process-exit signals below so an interrupted run still cleans up.
 */
export function reapLiveGroups(): void {
  for (const pid of liveGroups.current) {
    killGroup(pid, "SIGKILL");
  }
  liveGroups.current = new Set();
}

/**
 * Number of process groups still outstanding.
 * @returns Count of spawned groups not yet reaped. A test-visible leak counter.
 */
export function liveGroupCount(): number {
  return liveGroups.current.size;
}

process.once("exit", reapLiveGroups);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => {
    reapLiveGroups();
  });
}

/**
 * Run a bash script under a wall-clock bound, killing the whole process group
 * on timeout, on failure, and on interpreter exit.
 *
 * Mirrors `promisify(execFile)` semantics: resolves with `{ stdout, stderr }`
 * on exit code 0, rejects otherwise.
 *
 * @param scriptPath - Absolute path to the script to run under bash.
 * @param options - Working directory, environment, and timeout.
 * @returns Captured stdout and stderr.
 */
export async function runBoundedBash(
  scriptPath: string,
  options: BoundedBashOptions = {}
): Promise<BoundedBashResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn(BASH, [scriptPath], {
    cwd: options.cwd,
    // `detached` makes the child a process-group leader, so a single
    // `kill(-pid)` reaches its grandchildren. Without it, jq/node/git
    // survive as PPID-1 orphans.
    detached: true,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  // Settled, never rejected, so a run that fails to spawn leaves no unhandled
  // stream rejection behind.
  const output = Promise.allSettled([
    child.stdout.toArray(),
    child.stderr.toArray(),
  ]);
  const pid = child.pid;
  if (pid === undefined) {
    await closed;
    throw new Error(`failed to spawn bash for ${scriptPath}`);
  }
  liveGroups.current = new Set([...liveGroups.current, pid]);
  const timedOut = latch<boolean>();
  const timer = setTimeout(() => {
    timedOut.set(true);
    terminateGroup(pid);
  }, timeoutMs);
  try {
    const code = await closed;
    const [stdout, stderr] = (await output).map(streamed => {
      if (streamed.status === "rejected") throw streamed.reason;
      return streamed.value.map(String).join("");
    });
    if (await timedOut.read(false))
      throw new Error(
        `bash ${scriptPath} exceeded ${timeoutMs}ms and its process group was killed`
      );
    if (code !== 0)
      throw Object.assign(
        new Error(
          `bash ${scriptPath} exited with code ${String(code)}\n${stderr}`
        ),
        { code, stderr, stdout }
      );
    return { stderr: stderr ?? "", stdout: stdout ?? "" };
  } finally {
    clearTimeout(timer);
    liveGroups.current = new Set(
      [...liveGroups.current].filter(live => live !== pid)
    );
    // Sweep the group even on a clean exit: bash may have left a background
    // grandchild behind. One immediate signal only — a *deferred* SIGKILL
    // here could land on a pid the OS has recycled since the child exited.
    killGroup(pid, "SIGTERM");
  }
}
