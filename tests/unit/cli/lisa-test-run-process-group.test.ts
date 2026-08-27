/** Fail-closed process-birth controls for supervised group drainage. */
import { describe, expect, it, vi } from "vitest";

import {
  drainTestRunTarget,
  type TestRunTargetIntent,
} from "../../../src/cli/lisa-test-run-process-group.js";

const TARGET: TestRunTargetIntent = {
  pid: 4242,
  pgid: 4242,
  processBirthFingerprint: "armed-birth",
};

describe("test-run process-group birth authority", () => {
  it("refuses a live recycled group when its armed leader is absent", async () => {
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => false,
          processBirthFingerprint: () => {
            throw new Error("an absent leader has no birth authority");
          },
          processGroupAlive: () => true,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).rejects.toThrow(/leader is absent.*refusing group signal/iu);
    expect(signal).not.toHaveBeenCalled();
  });

  it("accepts an already-absent leader and group without signalling", async () => {
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => false,
          processBirthFingerprint: () => undefined,
          processGroupAlive: () => false,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).resolves.toBeUndefined();
    expect(signal).not.toHaveBeenCalled();
  });

  it("retries an unavailable live birth probe then fails without signalling", async () => {
    const birth = vi.fn<() => string | undefined>(() => undefined);
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => true,
          processBirthFingerprint: birth,
          processGroupAlive: () => true,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).rejects.toThrow(/remained unavailable/iu);
    expect(birth.mock.calls.length).toBeGreaterThan(1);
    expect(signal).not.toHaveBeenCalled();
  });

  it("refuses a mismatched live birth without signalling a recycled group", async () => {
    const signal = vi.fn();

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: () => true,
          processBirthFingerprint: () => "recycled-birth",
          processGroupAlive: () => true,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).rejects.toThrow(/fingerprint changed/iu);
    expect(signal).not.toHaveBeenCalled();
  });

  it("revalidates the leader birth before escalating to SIGKILL", async () => {
    const signal = vi.fn();
    const leaderAlive = vi
      .fn<() => boolean>()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    await expect(
      drainTestRunTarget(TARGET, {
        probes: {
          isProcessAlive: leaderAlive,
          processBirthFingerprint: () => "armed-birth",
          processGroupAlive: () => true,
          signalGroup: signal,
          delay: async () => undefined,
        },
      })
    ).rejects.toThrow(/leader is absent.*refusing group signal/iu);
    expect(signal).toHaveBeenCalledTimes(1);
    expect(signal).toHaveBeenCalledWith(TARGET.pgid, "SIGTERM");
  });
});
