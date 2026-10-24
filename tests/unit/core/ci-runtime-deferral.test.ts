/**
 * Contract for tests/support/ci-runtime.ts: a test that needs a runtime only
 * CI provisions is deferred (skipped, with the runtime named) on a developer
 * machine and still fails in CI, so a local push never requires a CI-identical
 * machine and CI never loses the check.
 * @module tests/unit/core/ci-runtime-deferral
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CiRuntimeUnavailable,
  deferToCi,
  deferralNote,
  isCiRun,
  probeSucceeds,
  suiteDeferral,
} from "../../support/ci-runtime.js";

const RUNTIME = "Node 99.0.0";
const REMEDY = "Run `mise install node@99.0.0`.";
const LOCAL: NodeJS.ProcessEnv = {};
const CI: NodeJS.ProcessEnv = { GITHUB_ACTIONS: "true" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isCiRun", () => {
  it.each([
    { CI: "true" },
    { GITHUB_ACTIONS: "true" },
    { CODEBUILD_BUILD_ID: "b" },
  ])("is true under %o", env => {
    expect(isCiRun(env)).toBe(true);
  });

  it("is false with no CI fingerprint", () => {
    expect(isCiRun(LOCAL)).toBe(false);
  });
});

describe("deferToCi", () => {
  it("fails in CI with the runtime and remedy named", () => {
    expect(() => deferToCi(RUNTIME, REMEDY, CI)).toThrow(CiRuntimeUnavailable);
    expect(() => deferToCi(RUNTIME, REMEDY, CI)).toThrow(
      `${RUNTIME} is required but unavailable. ${REMEDY}`
    );
  });

  it("locally announces the deferral and skips the running test", context => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const skip = vi.spyOn(context, "skip").mockImplementation(note => {
      throw new Error(`skipped: ${String(note)}`);
    });
    expect(() => deferToCi(RUNTIME, REMEDY, LOCAL)).toThrow(
      `skipped: ${deferralNote(RUNTIME, REMEDY)}`
    );
    expect(skip).toHaveBeenCalledWith(deferralNote(RUNTIME, REMEDY));
    expect(String(stderr.mock.calls[0]?.[0])).toContain(
      `DEFERRED TO CI: needs ${RUNTIME}. ${REMEDY}`
    );
  });
});

describe("suiteDeferral", () => {
  const present = (): boolean => true;
  const missing = (): boolean => false;

  it("does nothing when the runtime is available, in or out of CI", () => {
    expect(suiteDeferral(present, RUNTIME, REMEDY, LOCAL)).toBeUndefined();
    expect(suiteDeferral(present, RUNTIME, REMEDY, CI)).toBeUndefined();
  });

  it("returns the note locally when the runtime is missing", () => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(suiteDeferral(missing, RUNTIME, REMEDY, LOCAL)).toBe(
      deferralNote(RUNTIME, REMEDY)
    );
  });

  it("fails in CI when the runtime is missing", () => {
    expect(() => suiteDeferral(missing, RUNTIME, REMEDY, CI)).toThrow(
      CiRuntimeUnavailable
    );
  });
});

describe("probeSucceeds", () => {
  it("is false for a missing command rather than throwing", () => {
    expect(probeSucceeds("lisa-no-such-command-xyz", [])).toBe(false);
  });

  it("reflects the probe's exit status", () => {
    expect(probeSucceeds(process.execPath, ["-e", "process.exit(0)"])).toBe(
      true
    );
    expect(probeSucceeds(process.execPath, ["-e", "process.exit(3)"])).toBe(
      false
    );
  });
});
