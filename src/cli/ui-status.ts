/**
 * Live-status probe contract and bounded execution for `lisa ui`.
 * @module cli/ui-status
 */
import { execFile } from "node:child_process";
import type { JsonValue } from "../sync/json-path.js";
import { normalizeProbeResult, type ProbeResult } from "./ui-status-json.js";
export type { ProbeResult } from "./ui-status-json.js";

/** One bounded, independently executable live-status probe. */
export interface StatusProbe<T extends JsonValue = JsonValue> {
  /** Stable identifier used as the status endpoint's object key. */
  readonly id: string;
  /** Abort-aware operation returning an explicit tri-state result. */
  readonly run: (signal: AbortSignal) => Promise<ProbeResult<T>>;
  /** Maximum time the status endpoint will await this probe. */
  readonly timeoutMs: number;
}

/** Injectable check used by the reference GitHub authentication probe. */
export type GithubAuthCheck = (
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
  hostname: string
) => Promise<"authenticated" | "not-authenticated">;

/** Error used internally to distinguish a bounded probe timeout. */
class ProbeTimeoutError extends Error {
  /**
   * Create a probe timeout error.
   * @param timeoutMs - Configured timeout in milliseconds
   */
  constructor(timeoutMs: number) {
    super(`Probe timed out after ${timeoutMs}ms`);
    this.name = "ProbeTimeoutError";
  }
}

/**
 * Run one probe without allowing it to block siblings or fabricate data.
 * @param probe - Probe to execute
 * @returns Explicit result, or unknown for invalid input, failure, or timeout
 */
export async function runProbe<T extends JsonValue>(
  probe: StatusProbe<T>
): Promise<ProbeResult<T>> {
  if (!Number.isFinite(probe.timeoutMs) || probe.timeoutMs < 0) {
    return {
      state: "unknown",
      reason: "invalid-timeout",
      message: `Probe timeout must be a finite non-negative number; received ${String(probe.timeoutMs)}`,
    };
  }
  const controller = new AbortController();
  const timeout = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => reject(controller.signal.reason),
      { once: true }
    );
  });
  const timer = setTimeout(
    () => controller.abort(new ProbeTimeoutError(probe.timeoutMs)),
    probe.timeoutMs
  );
  try {
    const result = await Promise.race([probe.run(controller.signal), timeout]);
    return normalizeProbeResult(result);
  } catch (error) {
    const timedOut = error instanceof ProbeTimeoutError;
    return {
      state: "unknown",
      reason: timedOut ? "timeout" : "probe-failed",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute `gh auth status` without invoking a shell.
 * @param cwd - Project root used as the command working directory
 * @param timeoutMs - Child-process timeout in milliseconds
 * @param signal - Cancellation signal controlled by the probe runner
 * @param hostname - Project origin hostname whose active account is checked
 * @returns Authentication state when the command runs
 */
const runGithubAuthStatus: GithubAuthCheck = async (
  cwd,
  timeoutMs,
  signal,
  hostname
) =>
  await new Promise((resolve, reject) => {
    /* eslint-disable sonarjs/no-os-command-from-path -- fixed user-installed gh invocation */
    execFile(
      "gh",
      ["auth", "status", "--active", "--hostname", hostname, "--json", "hosts"],
      { cwd, signal, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as unknown;
          if (typeof parsed !== "object" || parsed === null) {
            throw new TypeError("GitHub auth status did not return an object");
          }
          const hosts = Reflect.get(parsed, "hosts") as unknown;
          if (typeof hosts !== "object" || hosts === null) {
            throw new TypeError("GitHub auth status omitted its hosts map");
          }
          const accounts = Reflect.get(hosts, hostname) as unknown;
          const authenticated =
            Array.isArray(accounts) &&
            accounts.some(
              account =>
                typeof account === "object" &&
                account !== null &&
                Reflect.get(account, "active") === true &&
                Reflect.get(account, "state") === "success"
            );
          resolve(authenticated ? "authenticated" : "not-authenticated");
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
    /* eslint-enable sonarjs/no-os-command-from-path -- fixed invocation ends */
  });

/**
 * Read the effective origin URL through git without invoking a shell.
 * @param cwd - Project root
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation signal
 * @returns Origin remote URL
 */
async function readOriginRemote(
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<string> {
  return await new Promise((resolve, reject) => {
    /* eslint-disable sonarjs/no-os-command-from-path -- fixed user-installed git invocation */
    execFile(
      "git",
      ["-C", cwd, "remote", "get-url", "origin"],
      { cwd, signal, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        const remote = stdout.trim();
        if (remote.length === 0) {
          reject(new Error("Project origin remote is empty"));
          return;
        }
        resolve(remote);
      }
    );
    /* eslint-enable sonarjs/no-os-command-from-path -- fixed invocation ends */
  });
}

/**
 * Extract a hostname from URL-form and scp-form git remotes.
 * @param remote - Git remote URL
 * @returns Hostname used by `gh auth status`
 */
function remoteHostname(remote: string): string {
  const normalize = (hostname: string): string => {
    const normalized = hostname.toLowerCase();
    return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
  };
  const scp = /^[^@\s]+@([^:\s]+):/u.exec(remote);
  if (scp?.[1] !== undefined) {
    return normalize(scp[1]);
  }
  try {
    const hostname = new URL(remote).hostname;
    if (hostname.length > 0) {
      return normalize(hostname);
    }
  } catch {
    // Fall through to the explicit error below.
  }
  throw new Error(`Unable to determine GitHub hostname from origin: ${remote}`);
}

/**
 * Create the reference GitHub authentication probe.
 * @param cwd - Project root used as the command working directory
 * @param check - Injectable command check used by focused tests
 * @returns Reference probe for the live-status transport
 */
export function createGithubAuthProbe(
  cwd: string,
  check: GithubAuthCheck = runGithubAuthStatus
): StatusProbe<boolean> {
  const timeoutMs = 5_000;
  return {
    id: "github-auth",
    timeoutMs,
    run: async signal => {
      const remote = await readOriginRemote(cwd, timeoutMs + 250, signal);
      const hostname = remoteHostname(remote);
      const state = await check(cwd, timeoutMs + 250, signal, hostname);
      return state === "authenticated"
        ? { state: "value", value: true }
        : {
            state: "unknown",
            reason: "not-authenticated",
            message: "GitHub CLI is not authenticated",
          };
    },
  };
}

/**
 * Validate probe keys before binding a server so status snapshots cannot lose data.
 * @param probes - Registered status probes
 */
export function validateStatusProbes(probes: readonly StatusProbe[]): void {
  for (const [index, probe] of probes.entries()) {
    if (probe.id.trim().length === 0) {
      throw new Error("Probe id must contain a non-whitespace character");
    }
    if (probes.slice(0, index).some(candidate => candidate.id === probe.id)) {
      throw new Error(`Duplicate probe id: ${probe.id}`);
    }
  }
}

/**
 * Execute all probes concurrently, with failures isolated per probe.
 * @param probes - Probes to execute
 * @returns Results keyed by stable probe identifier
 */
export async function readStatusSnapshot(
  probes: readonly StatusProbe[]
): Promise<Record<string, ProbeResult>> {
  const entries = await Promise.all(
    probes.map(async probe => [probe.id, await runProbe(probe)] as const)
  );
  return Object.fromEntries(entries);
}
