/**
 * Real-process fixtures for the process-tree supervisor's executable verdict.
 *
 * The runner is asynchronous internally but is consumed through `spawnSync`.
 * These helpers keep the test at that real boundary: a POSIX signal must remain
 * a signal, while an ordinary high exit code must remain a number.
 * @module tests/helpers/process-tree-runner-verdict
 */
import type { SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { boundedSpawnSync } from "../../all/copy-overwrite/scripts/lib/bounded-spawn.mjs";
import { ioLatencyBudgetMs } from "./io-latency-budget.js";

/**
 * Signals the production supervisor explicitly arms and transports on POSIX.
 */
export const POSIX_TERMINATING_SIGNALS = [
  "SIGHUP",
  "SIGINT",
  "SIGTERM",
] as const;

/** Absolute path to the shipped common supervisor. */
export const PROCESS_TREE_RUNNER = path.resolve(
  "all/copy-overwrite/scripts/lib/process-tree-runner.mjs"
);

/** Long enough that only a fixture-requested termination should end the run. */
const SUPERVISOR_TIMEOUT_ARGUMENT = "--timeout-ms=30000";

/** Quiet-machine budget for one real supervisor invocation. */
const SUPERVISOR_CHILD_BUDGET_MS = 5_000;

/**
 * Explicit ceiling for a valid process table. Node's implicit 1 MiB default is
 * smaller than a real `ps` response when one process carries a long file list.
 */
const PROCESS_TABLE_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

/** One planted descendant plus the shell command that owns it. */
export interface DescendantSignalFixture {
  /** Shell source passed through the real supervisor. */
  readonly command: string;
  /** File in which the shell publishes the planted descendant PID. */
  readonly pidFile: string;
  /** Unique command-line token used to prove the planted process is absent. */
  readonly token: string;
}

/**
 * Quote one value for the POSIX shell used by the production runner.
 * @param value - Untrusted value to transport as one shell argument.
 * @returns Single-quoted POSIX shell source.
 */
function posixQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * Run the canonical supervisor through its synchronous parent boundary.
 * @param command - Shell source the supervisor should own.
 * @param timeoutArgument - Supervisor-owned command deadline.
 * @returns The parent-visible process result.
 */
export function runProcessTreeSupervisor(
  command: string,
  timeoutArgument = SUPERVISOR_TIMEOUT_ARGUMENT
): SpawnSyncReturns<string> {
  return boundedSpawnSync(
    process.execPath,
    [PROCESS_TREE_RUNNER, timeoutArgument, "--", command],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: ioLatencyBudgetMs(SUPERVISOR_CHILD_BUDGET_MS),
    }
  );
}

/**
 * Make the direct POSIX shell terminate from one real signal.
 * @param signal - Named signal to deliver to the shell itself.
 * @returns Shell source that has no numeric-exit translation layer.
 */
export function selfSignalCommand(
  signal: (typeof POSIX_TERMINATING_SIGNALS)[number]
): string {
  return `kill -${signal.slice("SIG".length)} $$`;
}

/**
 * Terminate the runner-owned POSIX process group from the capture pipeline.
 * @param signal - Named signal to deliver to the owned process group.
 * @returns Shell source that cannot leave `tee` as a false-success survivor.
 */
export function processGroupSignalCommand(
  signal: (typeof POSIX_TERMINATING_SIGNALS)[number]
): string {
  return `kill -${signal.slice("SIG".length)} 0`;
}

/**
 * Make an ordinary shell exit, including signal-shaped numeric values.
 * @param code - Numeric status deliberately selected by the command.
 * @returns Platform shell source that exits with exactly that number.
 */
export function numericExitCommand(code: number): string {
  return process.platform === "win32" ? `exit /b ${code}` : `exit ${code}`;
}

/**
 * Make a child process exit normally without terminating its wrapper shell.
 * @param code - Numeric status deliberately selected by the child.
 * @returns Shell source that leaves a following status-file write reachable.
 */
export function childNumericExitCommand(code: number): string {
  const source = `process.exit(${code});`;
  if (process.platform === "win32") {
    return `"${process.execPath}" -e "${source}"`;
  }
  return `${posixQuote(process.execPath)} -e ${posixQuote(source)}`;
}

/**
 * Plant a live descendant, publish its PID, then signal the owning shell.
 * @param root - Per-case temporary directory.
 * @param signal - Signal that terminates the direct shell.
 * @returns Fixture paths, identity token, and command.
 */
export function descendantSignalFixture(
  root: string,
  signal: (typeof POSIX_TERMINATING_SIGNALS)[number]
): DescendantSignalFixture {
  const pidFile = path.join(root, "descendant.pid");
  const token = path.join(root, "owned-descendant-token");
  const keepAlive = "setInterval(() => {}, 1000);";
  const child = [
    posixQuote(process.execPath),
    "-e",
    posixQuote(keepAlive),
    posixQuote(token),
  ].join(" ");
  const command = `${child} & echo $! > ${posixQuote(pidFile)}; ${selfSignalCommand(signal)}`;
  return { command, pidFile, token };
}

/**
 * Read the planted PID only after the shell proved it published one.
 * @param pidFile - Fixture-owned PID file.
 * @returns A positive process identifier.
 */
export function readFixturePid(pidFile: string): number {
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`fixture published an invalid PID: ${String(pid)}`);
  }
  return pid;
}

/**
 * Find non-zombie processes carrying one unguessable fixture token.
 * @param token - Exact token embedded in the child command line.
 * @returns Matching process identifiers.
 */
export function tokenProcessIds(token: string): readonly number[] {
  const processRow = /^(\d+)\s+(\S+)/u;
  const listed = boundedSpawnSync("ps", ["-axo", "pid=,stat=,command="], {
    encoding: "utf8",
    maxBuffer: PROCESS_TABLE_MAX_BUFFER_BYTES,
    timeout: ioLatencyBudgetMs(1_000),
  });
  if (listed.error || listed.status !== 0) {
    const diagnosis = listed.error?.message ?? listed.stderr;
    throw new Error(`could not inspect fixture processes: ${diagnosis}`);
  }
  return String(listed.stdout ?? "")
    .split("\n")
    .filter(row => row.includes(token))
    .map(row => processRow.exec(row.trim()))
    .filter((match): match is RegExpMatchArray =>
      Boolean(match && !match[2]?.startsWith("Z"))
    )
    .map(match => Number(match[1]));
}

/**
 * Remove only processes proven to carry a per-case unguessable token.
 * @param token - Exact command-line token owned by the case.
 */
export function cleanupTokenProcesses(token: string): void {
  for (const pid of tokenProcessIds(token)) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "ESRCH"
      ) {
        throw error;
      }
    }
  }
}
