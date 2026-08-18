/**
 * Behavioral tests for `diagnose_eas_quota_exhaustion` — these EXECUTE the
 * workflow's own shell against a stubbed `eas` CLI that fails the way Expo
 * fails when a Free-plan account has spent its monthly iOS builds.
 *
 * A detector asserted only to fire has not been shown to discriminate. The
 * three cases that matter here are the ones where it must STAY QUIET: with the
 * input off, on an ordinary build failure, and on a build that succeeded. A
 * quota banner on a Gradle failure sends the operator to Expo's billing page
 * for a code bug, which is a worse outcome than the generic error this
 * replaces.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  buildStepScript,
  loadReusable,
  runBuildStep,
} from "./support/maestro-build-step-harness";
import type { BuildMode } from "./support/maestro-build-step-harness";

/** The annotation the diagnosis emits, and the only string worth matching. */
const QUOTA_BANNER = "::error title=EAS build quota exhausted::";

describe("maestro-native-e2e Free-plan quota diagnosis (executed)", () => {
  let script: string;

  beforeAll(async () => {
    script = buildStepScript(await loadReusable());
  });

  /**
   * Runs the build step through an `eas build` of the given flavour, with reuse
   * off so the fresh-build path is always the one exercised.
   * @param diagnose - Whether the caller opted into the diagnosis
   * @param build - Which outcome the stubbed `eas build` should produce
   * @returns The step's exit status and combined output
   */
  const buildWith = async (
    diagnose: boolean,
    build: BuildMode
  ): Promise<{ status: number; output: string }> => {
    const result = await runBuildStep(script, {
      platform: "ios",
      reuse: false,
      diagnose,
      build,
    });
    return { status: result.status, output: result.output };
  };

  it("ON: names the quota AND the remedy on a Free-plan refusal", async () => {
    const result = await buildWith(true, "quota");
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(QUOTA_BANNER);
    expect(result.output).toContain("reuse_build_by_fingerprint");
    // The raw EAS stderr is an ADDITION to the operator's evidence, never a
    // replacement for it — buffering it must not swallow it.
    expect(result.output).toContain("used its iOS builds from the Free plan");
  });

  it("OFF: the same refusal reds with NO diagnosis — the input is load-bearing", async () => {
    // The discrimination. Without this case an always-on annotation would pass
    // the test above and the input would be inert.
    const result = await buildWith(false, "quota");
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain(QUOTA_BANNER);
  });

  it("ON: an ORDINARY build failure gets no quota diagnosis", async () => {
    const result = await buildWith(true, "error");
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain(QUOTA_BANNER);
    expect(result.output).toContain("Gradle build failed");
  });

  it("ON: a SUCCEEDING build is untouched", async () => {
    const result = await buildWith(true, "ok");
    expect(result.status).toBe(0);
    expect(result.output).not.toContain(QUOTA_BANNER);
  });
});
