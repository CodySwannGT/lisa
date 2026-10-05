/** Bounded subprocess lifecycle for optional project plugin registration. */
import { spawn } from "node:child_process";

/** Existing short vendor CLI probe budget. */
export const PLUGIN_PROBE_TIMEOUT_MS = 15_000;
/** Registration shares the normal reconciliation wait budget across commands. */
export const PLUGIN_REGISTRATION_TIMEOUT_MS = 120_000;
/** Grace period for the owned CLI group to finish after termination. */
const TERMINATION_GRACE_MS = 2_000;
/** Preserve Node exec's default per-stream capture limit. */
const MAX_CAPTURE_BYTES = 1_048_576;

/** One command's working directory and remaining operation budget. */
export interface PluginCommandOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
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
  return await new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    // The vendor CLI is user-installed; argv is never evaluated by a shell.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed vendor executable
    const child = spawn("claude", [...args], {
      cwd: options.cwd,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    /* eslint-disable functional/no-let -- process events accumulate until this promise settles */
    let stdout = "";
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    /* eslint-enable functional/no-let -- event state is confined to this invocation */
    const signal = (value: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        if (grouped) process.kill(-child.pid, value);
        else child.kill(value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    const terminate = (): void => {
      signal("SIGTERM");
      killTimer ??= setTimeout(() => signal("SIGKILL"), TERMINATION_GRACE_MS);
    };
    const observe = (chunk: string, stream: "stdout" | "stderr"): void => {
      const size = Buffer.byteLength(chunk);
      if (stream === "stdout") stdoutBytes += size;
      else stderrBytes += size;
      if (stdoutBytes > MAX_CAPTURE_BYTES || stderrBytes > MAX_CAPTURE_BYTES) {
        failure ??= new Error("Plugin command output exceeded capture limit");
        terminate();
      } else if (stream === "stdout" && failure === undefined) {
        stdout += chunk;
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => observe(chunk, "stdout"));
    // Count and drain stderr without copying vendor diagnostics into errors.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => observe(chunk, "stderr"));
    const deadline = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    child.on("error", error => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      reject(error);
    });
    child.on("close", code => {
      // A CLI may exit while leaving a background child. The detached group
      // was created by this invocation, so remaining members are ours alone.
      clearTimeout(deadline);
      clearTimeout(killTimer);
      const commandError = completionError(failure, timedOut, code);
      try {
        signal("SIGKILL");
      } catch (error) {
        reject(commandError ?? error);
        return;
      }
      if (commandError !== undefined) reject(commandError);
      else resolve({ stdout });
    });
  });
}
