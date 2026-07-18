/**
 * Shell-out reachability checks for observability provider probes.
 *
 * Reuses the same CLIs/tokens skills already use (SENTRY_AUTH_TOKEN REST,
 * `aws sts` / `cloudwatch` / `xray`) — no second SDK.
 * @module cli/ui-observability-checks
 */
import { execFile } from "node:child_process";
import type {
  AwsCountCheck,
  SentryReachabilityCheck,
} from "./ui-observability-providers.js";

const NOT_AUTHENTICATED = "not-authenticated" as const;

/**
 * Read one env var through a single reviewable process.env exception.
 * @param name - Environment variable name
 * @returns Trimmed value, or undefined when unset/blank
 */
function readEnv(name: string): string | undefined {
  // eslint-disable-next-line no-restricted-syntax -- observability probe must read developer-local auth tokens once
  const value = process.env[name];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Run a fixed argv via execFile without a shell.
 * @param file - Executable name
 * @param args - Argument vector
 * @param timeoutMs - Child-process timeout
 * @param signal - Probe cancellation signal
 * @returns stdout on success
 */
async function runCommand(
  file: string,
  args: readonly string[],
  timeoutMs: number,
  signal: AbortSignal
): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed aws CLI
      file,
      [...args],
      { signal, timeout: timeoutMs, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * Classify an AWS CLI failure as missing auth vs other probe failure.
 * @param error - Thrown command error
 * @returns Whether the failure indicates missing credentials
 */
function isAwsAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return (
    lowered.includes("unable to locate credentials") ||
    lowered.includes("could not load credentials") ||
    lowered.includes("no credentials") ||
    lowered.includes("expiredtoken") ||
    lowered.includes("the security token included in the request is invalid") ||
    lowered.includes("is not authorized to perform") ||
    lowered.includes("accessdenied") ||
    lowered.includes("error loading sso") ||
    lowered.includes("sso session")
  );
}

/**
 * Confirm AWS identity, mapping credential failures to not-authenticated.
 * @param timeoutMs - Command budget
 * @param signal - Abort signal
 * @returns not-authenticated when credentials are missing; otherwise void
 */
async function requireAwsIdentity(
  timeoutMs: number,
  signal: AbortSignal
): Promise<typeof NOT_AUTHENTICATED | undefined> {
  try {
    await runCommand(
      "aws",
      ["sts", "get-caller-identity", "--output", "json"],
      timeoutMs,
      signal
    );
    return undefined;
  } catch (error) {
    if (isAwsAuthFailure(error)) {
      return NOT_AUTHENTICATED;
    }
    throw error;
  }
}

/**
 * Default Sentry reachability: REST when SENTRY_AUTH_TOKEN is set.
 * @param timeoutMs - Request budget
 * @param signal - Abort signal
 * @returns Reachability outcome
 */
export const defaultSentryCheck: SentryReachabilityCheck = async (
  timeoutMs,
  signal
) => {
  const token = readEnv("SENTRY_AUTH_TOKEN");
  if (token === undefined) {
    return NOT_AUTHENTICATED;
  }
  const response = await fetch("https://sentry.io/api/0/", {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
  });
  if (response.ok) {
    return "reachable";
  }
  if (response.status === 401 || response.status === 403) {
    return NOT_AUTHENTICATED;
  }
  throw new Error(`Sentry API returned HTTP ${String(response.status)}`);
};

/**
 * Count CloudWatch alarms after confirming AWS identity.
 * @param timeoutMs - Command budget
 * @param signal - Abort signal
 * @returns Alarm count, or not-authenticated
 */
export const defaultCloudWatchCheck: AwsCountCheck = async (
  timeoutMs,
  signal
) => {
  const auth = await requireAwsIdentity(timeoutMs, signal);
  if (auth !== undefined) {
    return auth;
  }
  const stdout = await runCommand(
    "aws",
    ["cloudwatch", "describe-alarms", "--output", "json"],
    timeoutMs,
    signal
  );
  const parsed = JSON.parse(stdout) as {
    MetricAlarms?: unknown[];
    CompositeAlarms?: unknown[];
  };
  const metric = Array.isArray(parsed.MetricAlarms)
    ? parsed.MetricAlarms.length
    : 0;
  const composite = Array.isArray(parsed.CompositeAlarms)
    ? parsed.CompositeAlarms.length
    : 0;
  return metric + composite;
};

/**
 * Count recent X-Ray traces after confirming AWS identity.
 * @param timeoutMs - Command budget
 * @param signal - Abort signal
 * @returns Trace count, or not-authenticated
 */
export const defaultXRayCheck: AwsCountCheck = async (timeoutMs, signal) => {
  const auth = await requireAwsIdentity(timeoutMs, signal);
  if (auth !== undefined) {
    return auth;
  }
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const stdout = await runCommand(
    "aws",
    [
      "xray",
      "get-trace-summaries",
      "--start-time",
      start.toISOString(),
      "--end-time",
      end.toISOString(),
      "--output",
      "json",
    ],
    timeoutMs,
    signal
  );
  const parsed = JSON.parse(stdout) as { TraceSummaries?: unknown[] };
  return Array.isArray(parsed.TraceSummaries)
    ? parsed.TraceSummaries.length
    : 0;
};
