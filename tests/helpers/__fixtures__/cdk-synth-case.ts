/** Real AWS CDK synth fixture; no outdir is supplied on purpose. */
import { writeFileSync } from "node:fs";

import { App, Stack } from "aws-cdk-lib";
import { describe, expect, it } from "vitest";

const arm = process.env["LISA_CDK_SYNTH_ARM"] ?? "pass";
const marker = process.env["LISA_CDK_SYNTH_MARKER"];

describe("real CDK synth", () => {
  it("uses the default assembly lifecycle", async () => {
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
    if (arm === "sigterm") process.kill(process.pid, "SIGTERM");
    if (arm === "sigkill") process.kill(process.pid, "SIGKILL");
  }, 500);
});
