import { describe, expect, it, vi } from "vitest";
import {
  createLisaVersionProbe,
  mapLisaVersionCheck,
  runProbe,
} from "../../../src/cli/ui-cmd.js";
import type {
  DoctorCheck,
  DoctorDependencies,
} from "../../../src/cli/doctor.js";
import { checkVersion } from "../../../src/cli/doctor.js";

const LISA_VERSION_PROBE_ID = "lisa-version";
const VERSION_CHECK_NAME = "Lisa version current?";
const LATEST_UNAVAILABLE_PREFIX = "Latest version unavailable";
const NETWORK_ERROR_REASON = "network-error";
const CURRENT_MATCHING = "2.200.0";
const CURRENT_BEHIND = "2.199.0";
const LATEST_AHEAD = "2.233.1";

/**
 * Build injectable doctor deps with a stubbed update check.
 * @param runUpdateCheck - Stubbed npm update check
 * @returns Partial doctor dependencies for the probe
 */
function depsWith(
  runUpdateCheck: DoctorDependencies["runUpdateCheck"]
): Partial<DoctorDependencies> {
  return {
    runUpdateCheck,
    fetchImpl: vi.fn<typeof fetch>(),
    setExitCode: vi.fn(),
    write: vi.fn(),
  };
}

describe("checkVersion export", () => {
  it("remains callable for the live-status probe without semantic change", async () => {
    const check = await checkVersion(
      {
        fetchImpl: vi.fn<typeof fetch>(),
        runUpdateCheck: vi.fn(async () => ({
          current: CURRENT_MATCHING,
          latest: CURRENT_MATCHING,
          isOutdated: false,
        })),
        setExitCode: vi.fn(),
        write: vi.fn(),
      },
      false
    );

    expect(check).toEqual({
      name: VERSION_CHECK_NAME,
      status: "ok",
      detail: `Installed ${CURRENT_MATCHING}; latest is ${CURRENT_MATCHING}`,
    });
  });
});

describe("mapLisaVersionCheck", () => {
  it("maps an up-to-date doctor check to a non-outdated value", () => {
    const check: DoctorCheck = {
      name: VERSION_CHECK_NAME,
      status: "ok",
      detail: `Installed ${CURRENT_MATCHING}; latest is ${CURRENT_MATCHING}`,
    };

    expect(mapLisaVersionCheck(check)).toEqual({
      state: "value",
      value: {
        current: CURRENT_MATCHING,
        latest: CURRENT_MATCHING,
        outdated: false,
      },
    });
  });

  it("maps a behind doctor check to an outdated value with both versions", () => {
    const check: DoctorCheck = {
      name: VERSION_CHECK_NAME,
      status: "warn",
      detail: `Installed ${CURRENT_BEHIND}; latest is ${CURRENT_MATCHING}`,
    };

    expect(mapLisaVersionCheck(check)).toEqual({
      state: "value",
      value: {
        current: CURRENT_BEHIND,
        latest: CURRENT_MATCHING,
        outdated: true,
      },
    });
  });

  it("maps latest-unavailable to unknown, never a green value", () => {
    const check: DoctorCheck = {
      name: VERSION_CHECK_NAME,
      status: "warn",
      detail: `${LATEST_UNAVAILABLE_PREFIX} (${NETWORK_ERROR_REASON})`,
    };

    const result = mapLisaVersionCheck(check);

    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe(NETWORK_ERROR_REASON);
      expect(result.message).toContain(LATEST_UNAVAILABLE_PREFIX);
    }
  });

  it("maps offline skip (doctor ok) to unknown so it cannot become green", () => {
    const check: DoctorCheck = {
      name: VERSION_CHECK_NAME,
      status: "ok",
      detail: "Skipped network check in offline mode",
    };

    const result = mapLisaVersionCheck(check);

    expect(result).toEqual({
      state: "unknown",
      reason: "offline-skipped",
      message: "Skipped network check in offline mode",
    });
  });
});

describe("createLisaVersionProbe", () => {
  it("registers with the lisa-version id and a bounded timeout", () => {
    const probe = createLisaVersionProbe();

    expect(probe.id).toBe(LISA_VERSION_PROBE_ID);
    expect(Number.isFinite(probe.timeoutMs)).toBe(true);
    expect(probe.timeoutMs).toBeGreaterThan(0);
  });

  it("reports up-to-date when checkVersion finds matching latest", async () => {
    const result = await runProbe(
      createLisaVersionProbe(
        depsWith(
          vi.fn(async () => ({
            current: CURRENT_MATCHING,
            latest: CURRENT_MATCHING,
            isOutdated: false,
          }))
        )
      )
    );

    expect(result).toEqual({
      state: "value",
      value: {
        current: CURRENT_MATCHING,
        latest: CURRENT_MATCHING,
        outdated: false,
      },
    });
  });

  it("reports behind with both versions when checkVersion warns outdated", async () => {
    const result = await runProbe(
      createLisaVersionProbe(
        depsWith(
          vi.fn(async () => ({
            current: CURRENT_BEHIND,
            latest: LATEST_AHEAD,
            isOutdated: true,
          }))
        )
      )
    );

    expect(result).toEqual({
      state: "value",
      value: {
        current: CURRENT_BEHIND,
        latest: LATEST_AHEAD,
        outdated: true,
      },
    });
  });

  it("reports unknown when latest is unavailable", async () => {
    const result = await runProbe(
      createLisaVersionProbe(
        depsWith(
          vi.fn(async () => ({
            current: CURRENT_MATCHING,
            latest: null,
            isOutdated: false,
            reason: NETWORK_ERROR_REASON,
          }))
        )
      )
    );

    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe(NETWORK_ERROR_REASON);
      expect(result.message).toContain(LATEST_UNAVAILABLE_PREFIX);
    }
  });

  it("always calls checkVersion with offline:false (never the false-green skip)", async () => {
    const runUpdateCheck = vi.fn(async () => ({
      current: CURRENT_MATCHING,
      latest: CURRENT_MATCHING,
      isOutdated: false,
    }));

    await runProbe(createLisaVersionProbe(depsWith(runUpdateCheck)));

    expect(runUpdateCheck).toHaveBeenCalled();
  });

  it("degrades to unknown when the update check throws", async () => {
    const result = await runProbe(
      createLisaVersionProbe(
        depsWith(
          vi.fn(async () => {
            throw new Error("registry exploded");
          })
        )
      )
    );

    expect(result.state).toBe("unknown");
    if (result.state === "unknown") {
      expect(result.reason).toBe("probe-failed");
      expect(result.message).toContain("registry exploded");
    }
  });
});
