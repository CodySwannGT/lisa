/**
 * Behavioral tests for `reuse_build_by_fingerprint` — these EXECUTE the
 * workflow's own shell, pulled verbatim out of the YAML, against a stubbed
 * `eas` CLI.
 *
 * Asserting that the input appears in the file would prove only that somebody
 * typed it. What has to be true is narrower and is the whole reason the input
 * exists: with it ON and a fingerprint hit, `eas build` must NEVER be invoked.
 * On Expo's Free plan that invocation is what exhausts the monthly quota, and
 * an exhausted quota does not slow the suite down — it stops it running at all.
 * Every case below therefore reads the stub's invocation LOG, so a pass and a
 * fail differ in behaviour rather than in wording.
 *
 * The negative cases carry the same weight as the positive ones. Reuse OFF must
 * not fingerprint anything; reuse ON with both lookups missing must still
 * build; a fingerprint the account cannot compute must degrade to a build
 * rather than fail the job. A reuse path that can delete the suite from the
 * night would be worse than the quota problem it solves.
 */

import { beforeAll, describe, expect, it } from "vitest";

import {
  ANDROID_ARTIFACT,
  BUILD_SUBCOMMAND,
  DOWNLOAD_SUBCOMMAND,
  FINGERPRINT_SUBCOMMAND,
  IOS_ARTIFACT,
  LIST_SUBCOMMAND,
  buildStepScript,
  loadReusable,
  ran,
  runBuildStep,
} from "./support/maestro-build-step-harness";

describe("maestro-native-e2e EAS build reuse (executed)", () => {
  let script: string;

  beforeAll(async () => {
    script = buildStepScript(await loadReusable());
  });

  it("OFF by default: builds fresh and never computes a fingerprint", async () => {
    // The compatibility case. Four repositories consume this reusable; a
    // default that started reusing binaries would change what every one of
    // them tests, silently, on the night this lands.
    const result = await runBuildStep(script, { reuse: false });
    expect(result.status).toBe(0);
    expect(ran(result.invocations, FINGERPRINT_SUBCOMMAND)).toBe(false);
    expect(ran(result.invocations, DOWNLOAD_SUBCOMMAND)).toBe(false);
    expect(ran(result.invocations, LIST_SUBCOMMAND)).toBe(false);
    expect(ran(result.invocations, BUILD_SUBCOMMAND)).toBe(true);
    expect(result.staged).toContain(ANDROID_ARTIFACT);
  });

  it("ON with a fingerprint hit: SKIPS the build entirely — the quota this saves", async () => {
    // The bite. `eas build` absent from the log IS the feature.
    const result = await runBuildStep(script, {
      reuse: true,
      fingerprint: "hit",
      download: "hit",
    });
    expect(result.status).toBe(0);
    expect(ran(result.invocations, FINGERPRINT_SUBCOMMAND)).toBe(true);
    expect(ran(result.invocations, BUILD_SUBCOMMAND)).toBe(false);
    expect(result.output).toContain("Reusing the finished EAS build");
    expect(result.staged).toContain(ANDROID_ARTIFACT);
  });

  it("ON with a fingerprint MISS: falls back to the latest finished build, still no fresh build", async () => {
    const result = await runBuildStep(script, {
      reuse: true,
      fingerprint: "hit",
      download: "miss",
      list: "hit",
      buildIdDownload: "hit",
    });
    expect(result.status).toBe(0);
    expect(ran(result.invocations, LIST_SUBCOMMAND)).toBe(true);
    expect(
      result.invocations.some(line => line.includes("--build-id build-id-777"))
    ).toBe(true);
    expect(ran(result.invocations, BUILD_SUBCOMMAND)).toBe(false);
    expect(result.output).toContain("after a fingerprint miss");
    expect(result.staged).toContain(ANDROID_ARTIFACT);
  });

  it("ON with BOTH lookups missing: builds fresh rather than failing the job", async () => {
    // Reuse must never be able to delete the suite from the night. A run with
    // nothing to reuse is exactly today's run.
    const result = await runBuildStep(script, {
      reuse: true,
      fingerprint: "hit",
      download: "miss",
      list: "miss",
    });
    expect(result.status).toBe(0);
    expect(ran(result.invocations, BUILD_SUBCOMMAND)).toBe(true);
    expect(result.staged).toContain(ANDROID_ARTIFACT);
  });

  it("ON with the fingerprint UNCOMPUTABLE: warns and degrades to a fresh build", async () => {
    const result = await runBuildStep(script, {
      reuse: true,
      fingerprint: "fail",
      list: "miss",
    });
    expect(result.status).toBe(0);
    expect(result.output).toContain(
      "::warning title=EAS fingerprint unavailable::"
    );
    expect(ran(result.invocations, BUILD_SUBCOMMAND)).toBe(true);
  });

  it("ON with an EMPTY fingerprint hash: treated as unavailable, not as a hit", async () => {
    const result = await runBuildStep(script, {
      reuse: true,
      fingerprint: "empty",
      list: "miss",
    });
    expect(result.status).toBe(0);
    expect(ran(result.invocations, DOWNLOAD_SUBCOMMAND)).toBe(false);
    expect(ran(result.invocations, BUILD_SUBCOMMAND)).toBe(true);
  });

  it("iOS reuse of an extracted .app DIRECTORY produces the tarball the suite installs", async () => {
    // `eas build:download` hands back a directory for a simulator build; the
    // iOS job downstream expects a tarball and nothing else.
    const result = await runBuildStep(script, {
      platform: "ios",
      reuse: true,
      fingerprint: "hit",
      download: "hit",
      artifactIsDir: true,
    });
    expect(result.status).toBe(0);
    expect(result.staged).toEqual([IOS_ARTIFACT]);
    expect(ran(result.invocations, BUILD_SUBCOMMAND)).toBe(false);
  });

  it("iOS build:list asks for a SIMULATOR build — a device archive installs nowhere", async () => {
    const result = await runBuildStep(script, {
      platform: "ios",
      reuse: true,
      fingerprint: "hit",
      download: "miss",
      list: "hit",
      buildIdDownload: "hit",
    });
    const listCall = result.invocations.find(line =>
      line.startsWith(LIST_SUBCOMMAND)
    );
    expect(listCall).toContain("--simulator");
  });
});
