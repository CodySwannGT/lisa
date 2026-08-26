/** Regression coverage for durable scratch-root ownership. */
import { describe, expect, it } from "vitest";

import {
  classifyScratchOwner,
  currentProcessBirthFingerprint,
  processBirthFingerprintSnapshot,
  type ScratchOwnerRecordV1,
} from "../../../src/configs/vitest/scratch-owner.js";

const owner = (birth: string): ScratchOwnerRecordV1 => ({
  schema: 1,
  pid: 42,
  processBirthFingerprint: birth,
  createdAt: "2026-08-25T12:00:00.000Z",
  token: "test-token",
  suiteLabel: "unit",
  registeredPrefixes: ["cdk.out"],
  namespace: { canonicalPath: "/authority/lisa-scratch", dev: 1, ino: 2 },
  root: {
    canonicalPath: "/authority/lisa-scratch/run-42-1-abc",
    dev: 1,
    ino: 3,
  },
});

describe("scratch owner process identity", () => {
  it("derives a stable birth fingerprint for the current process", () => {
    const first = currentProcessBirthFingerprint();
    const second = currentProcessBirthFingerprint();

    expect(first).toMatch(/^(?:linux:|darwin:|unsupported:)/u);
    expect(second).toBe(first);
  });

  it.each([
    ["dead", false, undefined, "reclaim"],
    ["matching birth", true, "birth-a", "preserve"],
    ["reused pid", true, "birth-b", "reclaim"],
    ["ambiguous live pid", true, undefined, "preserve"],
  ] as const)("classifies a %s owner", (_label, alive, observed, expected) => {
    expect(
      classifyScratchOwner(owner("birth-a"), {
        isProcessAlive: () => alive,
        processBirthFingerprint: () => observed,
      })
    ).toBe(expected);
  });

  it.each([
    [100, 1],
    [1_000, 4],
  ] as const)(
    "audits %i macOS owners through %i bounded bulk ps batch(es)",
    (ownerCount, expectedCalls) => {
      const calls: number[][] = [];
      const pids = Array.from({ length: ownerCount }, (_, index) => index + 10);
      const snapshot = processBirthFingerprintSnapshot(pids, {
        platform: "darwin",
        runDarwinBatch: batch => {
          calls.push([...batch]);
          return batch
            .map(pid => `${String(pid)} Mon Jan 01 00:00:00 2024`)
            .join("\n");
        },
      });

      expect(calls).toHaveLength(expectedCalls);
      expect(Math.max(...calls.map(call => call.length))).toBeLessThanOrEqual(
        256
      );
      expect(snapshot.size).toBe(ownerCount);
      expect(snapshot.get(10)).toBe("darwin:Mon Jan 01 00:00:00 2024");
      expect(snapshot.get(ownerCount + 9)).toBe(
        "darwin:Mon Jan 01 00:00:00 2024"
      );
    }
  );
});
