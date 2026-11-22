/** Bounded subprocess lifecycle for optional project plugin registration. */
import { type ChildProcess, spawn } from "node:child_process";
import { spawnTarget } from "../utils/resolve-executable.js";

/** Existing short vendor CLI probe budget. */
export const PLUGIN_PROBE_TIMEOUT_MS = 15_000;
/** Registration shares the normal reconciliation wait budget across commands. */
export const PLUGIN_REGISTRATION_TIMEOUT_MS = 120_000;
/**
 * Budget for pruning dead-checkout registrations in one apply. A machine with a
 * large backlog clears it over several applies instead of stalling one.
 */
export const PLUGIN_PRUNE_TIMEOUT_MS = 30_000;
/** Grace period for the owned CLI group to finish after termination. */
const TERMINATION_GRACE_MS = 2_000;
/** Preserve Node exec's default per-stream capture limit. */
const MAX_CAPTURE_BYTES = 1_048_576;
/**
 * Capture limit for `claude plugin list --json`. The registry lists every
 * project-scope registration on the machine, and a long-lived workstation's
 * list passes 2 MB — over the default limit, which made each list call fail
 * and every caller fall back silently (#4645).
 */
export const PLUGIN_LIST_MAX_CAPTURE_BYTES = 33_554_432;

/** One command's working directory and remaining operation budget. */
export interface PluginCommandOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
  /** Per-stream capture limit; defaults to Node exec's 1 MiB. */
  readonly maxCaptureBytes?: number;
}

/**
 * Preserve the command's failure before attempting final cleanup.
 * @param failure - Earlier stream or command error
 * @param timedOut - Whether the operation exceeded its deadline
 * @param code - Observed process exit code
 * @returns Original failure, timeout, nonzero exit, or no command error
 */
function completionError(
  failure: Error | undefined,
  timedOut: boolean,
  code: number | null
): Error | undefined {
  return (
    failure ??
    (timedOut
      ? new Error("Plugin command timed out")
      : code !== 0
        ? new Error(`Plugin command exited ${String(code)}`)
        : undefined)
  );
}

/**
 * Lifecycle state for one vendor CLI invocation: captured output, per-stream
 * byte counts, the first failure, and the deadline and kill timers. The child
 * reports through events until it closes, so the state lives on this instance.
 */
class PluginCommandRun {
  /** Captured standard output, kept only while no failure has occurred. */
  stdout = "";
  private timedOut = false;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private failure: Error | undefined;

  /**
   * Creates the state for one invocation.
   * @param child - The spawned vendor CLI
   * @param grouped - Whether the child leads its own process group
   * @param maxCaptureBytes - Per-stream capture limit
   */
  constructor(
    private readonly child: ChildProcess,
    private readonly grouped: boolean,
    private readonly maxCaptureBytes: number
  ) {}

  /**
   * Send a signal to the owned process group, or to the child alone.
   * @param value - Signal to send
   */
  signal(value: NodeJS.Signals): void {
    if (this.child.pid === undefined) return;
    try {
      if (this.grouped) process.kill(-this.child.pid, value);
      else this.child.kill(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }

  /** Ask the child to stop, escalating to SIGKILL after the grace period. */
  terminate(): void {
    this.signal("SIGTERM");
    this.killTimer ??= setTimeout(
      () => this.signal("SIGKILL"),
      TERMINATION_GRACE_MS
    );
  }

  /**
   * Account for one output chunk, terminating once a stream passes the limit.
   * @param chunk - Decoded output
   * @param stream - Which stream produced it
   */
  observe(chunk: string, stream: "stdout" | "stderr"): void {
    const size = Buffer.byteLength(chunk);
    if (stream === "stdout") this.stdoutBytes += size;
    else this.stderrBytes += size;
    if (
      this.stdoutBytes > this.maxCaptureBytes ||
      this.stderrBytes > this.maxCaptureBytes
    ) {
      // Terminate once. Buffered chunks keep arriving after SIGTERM, and
      // re-signalling a group whose leader has exited throws EPERM on macOS
      // from inside this stream listener — an uncaught exception.
      if (this.failure === undefined) {
        this.failure = new Error(
          "Plugin command output exceeded capture limit"
        );
        this.terminate();
      }
    } else if (stream === "stdout" && this.failure === undefined) {
      this.stdout += chunk;
    }
  }

  /**
   * Start the command deadline.
   * @param timeoutMs - Remaining operation budget
   */
  armDeadline(timeoutMs: number): void {
    this.deadline = setTimeout(() => {
      this.timedOut = true;
      this.terminate();
    }, timeoutMs);
  }

  /** Cancel the deadline and any pending escalation. */
  clearTimers(): void {
    clearTimeout(this.deadline);
    clearTimeout(this.killTimer);
  }

  /**
   * The error this invocation ends with, if any.
   * @param code - Observed process exit code
   * @returns Original failure, timeout, nonzero exit, or undefined
   */
  completionError(code: number | null): Error | undefined {
    return completionError(this.failure, this.timedOut, code);
  }
}

/**
 * Run the vendor CLI without a shell or input prompts, with a command deadline.
 * POSIX cleanup covers the owned process group. Windows retains direct-child
 * termination only; descendant cleanup is not established on that platform.
 * @param args - Fixed plugin-command argument vector
 * @param options - Project root and remaining deadline
 * @returns Captured stdout after the entire subprocess lifecycle completes
 */
export async function runPluginCommand(
  args: readonly string[],
  options: PluginCommandOptions
): Promise<{ readonly stdout: string }> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("Plugin registration operation deadline reached");
  }
  const maxCaptureBytes = options.maxCaptureBytes ?? MAX_CAPTURE_BYTES;
  return await new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    // The vendor CLI is user-installed; argv is never evaluated by a shell,
    // except that a Windows npm `.cmd` shim runs through an absolute cmd.exe
    // with every argument escaped (see spawnTarget). A missing CLI throws
    // ENOENT here, which rejects this promise as the spawn error did.
    const claude = spawnTarget("claude", args);
    const child = spawn(claude.file, [...claude.args], {
      cwd: options.cwd,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: claude.windowsVerbatimArguments,
    });
    const run = new PluginCommandRun(child, grouped, maxCaptureBytes);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => run.observe(chunk, "stdout"));
    // Count and drain stderr without copying vendor diagnostics into errors.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => run.observe(chunk, "stderr"));
    run.armDeadline(options.timeoutMs);
    child.on("error", error => {
      run.clearTimers();
      reject(error);
    });
    child.on("close", code => {
      // A CLI may exit while leaving a background child. The detached group
      // was created by this invocation, so remaining members are ours alone.
      run.clearTimers();
      const commandError = run.completionError(code);
      try {
        run.signal("SIGKILL");
      } catch (error) {
        reject(commandError ?? error);
        return;
      }
      if (commandError !== undefined) reject(commandError);
      else resolve({ stdout: run.stdout });
    });
  });
}
