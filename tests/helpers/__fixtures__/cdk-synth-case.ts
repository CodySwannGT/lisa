/** Real AWS CDK synth fixture; no outdir is supplied on purpose. */
import { writeFileSync } from "node:fs";

import { App, Stack } from "aws-cdk-lib";
import { describe, expect, it } from "vitest";

const arm = process.env["LISA_CDK_SYNTH_ARM"] ?? "pass";
const marker = process.env["LISA_CDK_SYNTH_MARKER"];
const wrapperPid = Number(process.env["LISA_CDK_SYNTH_WRAPPER_PID"]);
const fixtureTimeout =
  arm.startsWith("sig") || arm === "whole-sigkill"
    ? Number.POSITIVE_INFINITY
    : 500;

/**
 * Signal the exact foreground wrapper whose PID survived the gated shell exec.
 * @param signal - Lifecycle signal under test
 */
async function signalWrapper(signal: NodeJS.Signals): Promise<never> {
  if (!Number.isInteger(wrapperPid) || wrapperPid <= 0) {
    throw new Error("CDK lifecycle wrapper PID is unavailable");
  }
  process.kill(wrapperPid, signal);
  return await new Promise<never>(() => undefined);
}

describe("real CDK synth", () => {
  it(
    "uses the default assembly lifecycle",
    async () => {
      const app = new App();
      new Stack(app, "FixtureStack");
      const assembly = app.synth();
      if (marker !== undefined) {
        writeFileSync(marker, assembly.directory, "utf8");
      }
      expect(assembly.directory).toContain("cdk.out");
      if (arm === "fail") expect(arm).toBe("pass");
      if (arm === "timeout") {
        await new Promise(() => undefined);
      }
      if (arm === "sigterm") await signalWrapper("SIGTERM");
      if (arm === "sigint") await signalWrapper("SIGINT");
      if (arm === "sighup") await signalWrapper("SIGHUP");
      if (arm === "sigkill") await signalWrapper("SIGKILL");
      if (arm === "whole-sigkill") await new Promise(() => undefined);
    },
    fixtureTimeout
  );
});
