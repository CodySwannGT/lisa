import { describe, expect, it, vi } from "vitest";
import {
  CLOUDWATCH_ALARMS_PROBE_ID,
  createCloudWatchAlarmsProbe,
  createObservabilityProviderProbes,
  createSentryProbe,
  createXRayProbe,
  mapAwsCountCheck,
  mapSentryReachability,
  SENTRY_PROBE_ID,
  XRAY_PROBE_ID,
  type AwsCountCheck,
  type SentryReachabilityCheck,
} from "../../../src/cli/ui-observability-providers.js";
import { runProbe } from "../../../src/cli/ui-cmd.js";

const NOT_AUTHENTICATED = "not-authenticated" as const;
const CONNECTED = "connected";
const CONNECTED_BUT_EMPTY = "connected-but-empty";
const REACHABLE = "reachable" as const;

/**
 * Build an injectable Sentry reachability check.
 * @param outcome - Fixed reachability outcome
 * @returns Check used by focused probe tests
 */
function sentryCheck(
  outcome: typeof REACHABLE | typeof NOT_AUTHENTICATED
): SentryReachabilityCheck {
  return vi.fn(async () => outcome);
}

/**
 * Build an injectable AWS count check.
 * @param outcome - Count outcome or auth failure
 * @returns Check used by focused probe tests
 */
function awsCountCheck(
  outcome: number | typeof NOT_AUTHENTICATED
): AwsCountCheck {
  return vi.fn(async () => outcome);
}

describe("mapSentryReachability", () => {
  it("maps reachable auth to connected", () => {
    expect(mapSentryReachability(REACHABLE)).toEqual({
      state: "value",
      value: { status: CONNECTED },
    });
  });

  it("maps missing auth to unknown with not-authenticated reason", () => {
    const result = mapSentryReachability(NOT_AUTHENTICATED);
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe(NOT_AUTHENTICATED);
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message.toLowerCase()).not.toContain("disconnected");
    }
  });
});

describe("mapAwsCountCheck", () => {
  it("maps not-authenticated to unknown, never disconnected", () => {
    const result = mapAwsCountCheck(NOT_AUTHENTICATED, "alarms");
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe(NOT_AUTHENTICATED);
      expect(result.message.toLowerCase()).not.toContain("disconnected");
    }
  });

  it("maps a positive count to connected", () => {
    expect(mapAwsCountCheck(3, "alarms")).toEqual({
      state: "value",
      value: { status: CONNECTED },
    });
  });

  it("maps zero alarms to connected-but-empty", () => {
    expect(mapAwsCountCheck(0, "alarms")).toEqual({
      state: "value",
      value: { status: CONNECTED_BUT_EMPTY, emptyKind: "alarms" },
    });
  });

  it("maps zero traces to connected-but-empty", () => {
    expect(mapAwsCountCheck(0, "traces")).toEqual({
      state: "value",
      value: { status: CONNECTED_BUT_EMPTY, emptyKind: "traces" },
    });
  });
});

describe("createSentryProbe", () => {
  it("registers under the sentry id with a bounded timeout", () => {
    const probe = createSentryProbe({ check: sentryCheck(REACHABLE) });
    expect(probe.id).toBe(SENTRY_PROBE_ID);
    expect(probe.timeoutMs).toBeGreaterThan(0);
    expect(Number.isFinite(probe.timeoutMs)).toBe(true);
  });

  it("reports connected when Sentry auth is reachable", async () => {
    const result = await runProbe(
      createSentryProbe({ check: sentryCheck(REACHABLE) })
    );
    expect(result).toEqual({
      state: "value",
      value: { status: CONNECTED },
    });
  });

  it("reports unknown with reason when Sentry is unreachable", async () => {
    const result = await runProbe(
      createSentryProbe({ check: sentryCheck(NOT_AUTHENTICATED) })
    );
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe(NOT_AUTHENTICATED);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("degrades to unknown when the check throws", async () => {
    const result = await runProbe(
      createSentryProbe({
        check: async () => {
          throw new Error("sentry substrate exploded");
        },
      })
    );
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe("probe-failed");
      expect(result.message).toContain("sentry substrate exploded");
    }
  });
});

describe("createCloudWatchAlarmsProbe", () => {
  it("registers under the cloudwatch-alarms id", () => {
    expect(createCloudWatchAlarmsProbe({ check: awsCountCheck(1) }).id).toBe(
      CLOUDWATCH_ALARMS_PROBE_ID
    );
  });

  it("reports connected when alarms exist", async () => {
    const result = await runProbe(
      createCloudWatchAlarmsProbe({ check: awsCountCheck(2) })
    );
    expect(result).toEqual({
      state: "value",
      value: { status: CONNECTED },
    });
  });

  it("reports connected-but-empty when credentials work but alarms are zero", async () => {
    const result = await runProbe(
      createCloudWatchAlarmsProbe({ check: awsCountCheck(0) })
    );
    expect(result).toEqual({
      state: "value",
      value: { status: CONNECTED_BUT_EMPTY, emptyKind: "alarms" },
    });
  });

  it("reports unknown-not-authenticated when AWS credentials are missing", async () => {
    const result = await runProbe(
      createCloudWatchAlarmsProbe({
        check: awsCountCheck(NOT_AUTHENTICATED),
      })
    );
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe(NOT_AUTHENTICATED);
      expect(result.message.toLowerCase()).not.toContain("disconnected");
    }
  });
});

describe("createXRayProbe", () => {
  it("registers under the x-ray id", () => {
    expect(createXRayProbe({ check: awsCountCheck(1) }).id).toBe(XRAY_PROBE_ID);
  });

  it("reports connected when traces exist", async () => {
    const result = await runProbe(createXRayProbe({ check: awsCountCheck(5) }));
    expect(result).toEqual({
      state: "value",
      value: { status: CONNECTED },
    });
  });

  it("reports connected-but-empty when credentials work but traces are zero", async () => {
    const result = await runProbe(createXRayProbe({ check: awsCountCheck(0) }));
    expect(result).toEqual({
      state: "value",
      value: { status: CONNECTED_BUT_EMPTY, emptyKind: "traces" },
    });
  });

  it("reports unknown-not-authenticated when AWS credentials are missing", async () => {
    const result = await runProbe(
      createXRayProbe({ check: awsCountCheck(NOT_AUTHENTICATED) })
    );
    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe(NOT_AUTHENTICATED);
      expect(result.message.toLowerCase()).not.toContain("disconnected");
    }
  });
});

describe("createObservabilityProviderProbes", () => {
  it("returns sentry, cloudwatch-alarms, and x-ray probes in that order", () => {
    const probes = createObservabilityProviderProbes();
    expect(probes.map(probe => probe.id)).toEqual([
      SENTRY_PROBE_ID,
      CLOUDWATCH_ALARMS_PROBE_ID,
      XRAY_PROBE_ID,
    ]);
  });
});
