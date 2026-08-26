/** Regression coverage for durable scratch-root ownership. */
import { describe, expect, it } from "vitest";

import {
  classifyScratchOwner,
  currentProcessBirthFingerprint,
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
});
