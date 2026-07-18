/**
 * Live-status probes for connected observability providers.
 *
 * READ-ONLY detection by reachability (Sentry auth, CloudWatch alarms, X-Ray
 * traces). Missing credentials degrade to unknown — never a fabricated
 * "disconnected" claim.
 * @module cli/ui-observability-providers
 */
import type { JsonValue } from "../sync/json-path.js";
import type { ProbeResult, StatusProbe } from "./ui-status.js";
import {
  defaultCloudWatchCheck,
  defaultSentryCheck,
  defaultXRayCheck,
} from "./ui-observability-checks.js";

/** Structured value for a reachable observability provider. */
export type ObservabilityProviderValue = {
  readonly [key: string]: JsonValue;
  readonly status: "connected" | "connected-but-empty";
  readonly emptyKind?: "alarms" | "traces";
};

/** Injectable Sentry reachability check. */
export type SentryReachabilityCheck = (
  timeoutMs: number,
  signal: AbortSignal
) => Promise<"reachable" | "not-authenticated">;

/** Injectable AWS count check (alarms or traces), or not-authenticated. */
export type AwsCountCheck = (
  timeoutMs: number,
  signal: AbortSignal
) => Promise<number | "not-authenticated">;

export const SENTRY_PROBE_ID = "sentry";
export const CLOUDWATCH_ALARMS_PROBE_ID = "cloudwatch-alarms";
export const XRAY_PROBE_ID = "x-ray";

const PROBE_TIMEOUT_MS = 5_000;
const NOT_AUTHENTICATED = "not-authenticated";
const SENTRY_UNKNOWN_MESSAGE =
  "Sentry auth/MCP is not reachable — authenticate Sentry MCP/CLI or set SENTRY_AUTH_TOKEN";
const AWS_UNKNOWN_MESSAGE =
  "AWS credentials are not authenticated for this machine";

/**
 * Map Sentry reachability onto the live-status tri-state.
 * @param outcome - Reachability check result
 * @returns Probe result for the sentry provider
 */
export function mapSentryReachability(
  outcome: "reachable" | "not-authenticated"
): ProbeResult<ObservabilityProviderValue> {
  if (outcome === "reachable") {
    return { state: "value", value: { status: "connected" } };
  }
  return {
    state: "unknown",
    reason: NOT_AUTHENTICATED,
    message: SENTRY_UNKNOWN_MESSAGE,
  };
}

/**
 * Map an AWS count check onto connected / empty / unknown.
 * @param outcome - Count or not-authenticated
 * @param emptyKind - Whether zero means no alarms or no traces
 * @returns Probe result for CloudWatch or X-Ray
 */
export function mapAwsCountCheck(
  outcome: number | "not-authenticated",
  emptyKind: "alarms" | "traces"
): ProbeResult<ObservabilityProviderValue> {
  if (outcome === "not-authenticated") {
    return {
      state: "unknown",
      reason: NOT_AUTHENTICATED,
      message: AWS_UNKNOWN_MESSAGE,
    };
  }
  if (outcome > 0) {
    return { state: "value", value: { status: "connected" } };
  }
  return {
    state: "value",
    value: { status: "connected-but-empty", emptyKind },
  };
}

/**
 * Create the Sentry observability probe.
 * @param options - Injectable collaborators
 * @param options.check - Optional reachability check for focused tests
 * @returns Bounded status probe
 */
export function createSentryProbe(
  options: {
    readonly check?: SentryReachabilityCheck;
  } = {}
): StatusProbe<ObservabilityProviderValue> {
  const check = options.check ?? defaultSentryCheck;
  return {
    id: SENTRY_PROBE_ID,
    timeoutMs: PROBE_TIMEOUT_MS,
    run: async signal =>
      mapSentryReachability(await check(PROBE_TIMEOUT_MS + 250, signal)),
  };
}

/**
 * Create the CloudWatch Alarms observability probe.
 * @param options - Injectable collaborators
 * @param options.check - Optional alarm-count check for focused tests
 * @returns Bounded status probe
 */
export function createCloudWatchAlarmsProbe(
  options: {
    readonly check?: AwsCountCheck;
  } = {}
): StatusProbe<ObservabilityProviderValue> {
  const check = options.check ?? defaultCloudWatchCheck;
  return {
    id: CLOUDWATCH_ALARMS_PROBE_ID,
    timeoutMs: PROBE_TIMEOUT_MS,
    run: async signal =>
      mapAwsCountCheck(await check(PROBE_TIMEOUT_MS + 250, signal), "alarms"),
  };
}

/**
 * Create the X-Ray observability probe.
 * @param options - Injectable collaborators
 * @param options.check - Optional trace-count check for focused tests
 * @returns Bounded status probe
 */
export function createXRayProbe(
  options: {
    readonly check?: AwsCountCheck;
  } = {}
): StatusProbe<ObservabilityProviderValue> {
  const check = options.check ?? defaultXRayCheck;
  return {
    id: XRAY_PROBE_ID,
    timeoutMs: PROBE_TIMEOUT_MS,
    run: async signal =>
      mapAwsCountCheck(await check(PROBE_TIMEOUT_MS + 250, signal), "traces"),
  };
}

/**
 * Register all three observability provider probes.
 * @returns Sentry, CloudWatch Alarms, and X-Ray probes
 */
export function createObservabilityProviderProbes(): readonly StatusProbe<ObservabilityProviderValue>[] {
  return [
    createSentryProbe(),
    createCloudWatchAlarmsProbe(),
    createXRayProbe(),
  ];
}
