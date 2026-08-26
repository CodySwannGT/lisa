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
});
