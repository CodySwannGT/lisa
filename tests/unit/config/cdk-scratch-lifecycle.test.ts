/** End-to-end proof for the real AWS CDK default cloud assembly lifecycle. */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SCRATCH_NAMESPACE } from "../../../src/configs/vitest/scratch.js";
import {
  readScratchOwnerRecord,
  scratchPathIdentity,
} from "../../../src/configs/vitest/scratch-owner.js";
import {
  captureLiveCdkRun,
  runCdk,
  startWaitingCdkRun,
  stopWaitingCdkRun,
  waitForCdkAssembly,
  waitForVitestPid,
  type CdkProcessOutcome,
} from "../../helpers/cdk-scratch-lifecycle.js";
import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { createPackageLisaApplyHarness } from "../../helpers/package-lisa-apply-harness.js";

useIoLatencyBudget();

const temporaryDirectories: string[] = [];
const INTEGRATION = "test:integration";
const INTEGRATION_LISA = "test:integration:lisa";
const LITERAL_PATH_VALUE = "vitest run tests/integration";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const CDK_ARMS = [
  ["pass", { code: 0, signal: null }],
  ["fail", { code: 1, signal: null }],
  ["timeout", { code: 1, signal: null }],
  ["sigterm", { code: null, signal: "SIGTERM" }],
  ["sigint", { code: null, signal: "SIGINT" }],
  ["sighup", { code: null, signal: "SIGHUP" }],
  ["sigkill", { code: null, signal: "SIGKILL" }],
] as const satisfies readonly (readonly [string, CdkProcessOutcome])[];

describe("AWS CDK default synth scratch lifecycle", () => {
  it.each(CDK_ARMS)("owns and removes cdk.out after %s", (arm, expected) => {
    const result = runCdk(arm);
    temporaryDirectories.push(result.scratchBase);
    expect(result.assembly).toBeDefined();
    expect(path.basename(result.assembly as string)).toMatch(/^cdk\.out/u);
    expect(result.assembly).toContain(`${SCRATCH_NAMESPACE}${path.sep}run-`);
    expect(result.assembly).toContain(`${path.sep}worker-`);
    expect(existsSync(result.assembly as string)).toBe(false);
    expect(result.run.status).toBe(expected.code);
    expect(result.run.signal).toBe(expected.signal);
    expect(result.run.error).toBeUndefined();
  });

  it("cleans one SIGKILLed run while preserving a second live worker and run", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "cdk-kill-"));
    temporaryDirectories.push(base);
    const killed = startWaitingCdkRun(base, "killed");
    const sibling = startWaitingCdkRun(base, "sibling");
    try {
      const [killedAssembly, siblingAssembly] = await Promise.all([
        waitForCdkAssembly(killed.marker),
        waitForCdkAssembly(sibling.marker),
      ]);
      const killedControl = captureLiveCdkRun(killedAssembly);
      const siblingControl = captureLiveCdkRun(siblingAssembly);
      expect(killedControl.runIdentity).not.toEqual(siblingControl.runIdentity);
      expect(killedControl.workerIdentity).not.toEqual(
        siblingControl.workerIdentity
      );
      expect(killedControl.runOwner.pid).not.toBe(siblingControl.runOwner.pid);
      expect(killedControl.workerOwner.pid).not.toBe(
        siblingControl.workerOwner.pid
      );
      expect(siblingControl.runOwner.root).toEqual(siblingControl.runIdentity);
      expect(siblingControl.workerOwner.root).toEqual(
        siblingControl.workerIdentity
      );
      expect(siblingControl.runOwner.token).not.toBe(
        killedControl.runOwner.token
      );

      const vitestPid = await waitForVitestPid(killed.child.pid as number);
      process.kill(vitestPid, "SIGKILL");
      expect(await killed.outcome).toEqual({
        code: null,
        signal: "SIGKILL",
      });
      expect(existsSync(killedControl.runIdentity.canonicalPath)).toBe(false);
      expect(
        scratchPathIdentity(siblingControl.runIdentity.canonicalPath)
      ).toEqual(siblingControl.runIdentity);
      expect(
        scratchPathIdentity(siblingControl.workerIdentity.canonicalPath)
      ).toEqual(siblingControl.workerIdentity);
      expect(
        readScratchOwnerRecord(siblingControl.runIdentity.canonicalPath)
      ).toEqual(siblingControl.runOwner);
      expect(
        readScratchOwnerRecord(siblingControl.workerIdentity.canonicalPath)
      ).toEqual(siblingControl.workerOwner);
      expect(readFileSync(siblingControl.sentinel, "utf8")).toBe(
        "live sibling before kill\n"
      );
      expect(readdirSync(path.join(base, SCRATCH_NAMESPACE))).toEqual([
        path.basename(siblingControl.runIdentity.canonicalPath),
      ]);
      writeFileSync(
        siblingControl.sentinel,
        "live sibling after kill\n",
        "utf8"
      );
      expect(readFileSync(siblingControl.sentinel, "utf8")).toBe(
        "live sibling after kill\n"
      );
      sibling.child.kill("SIGTERM");
      expect(await sibling.outcome).toEqual({
        code: null,
        signal: "SIGTERM",
      });
      expect(existsSync(siblingControl.runIdentity.canonicalPath)).toBe(false);
    } finally {
      await Promise.all([
        stopWaitingCdkRun(killed),
        stopWaitingCdkRun(sibling),
      ]);
    }
  });
});

describe("what a cdk apply leaves behind", () => {
  const host = createPackageLisaApplyHarness();

  /**
   * Stand up a cdk-stack host against the shipped templates.
   * @param scripts - Host scripts before apply
   */
  async function cdkHost(scripts: Record<string, string>): Promise<void> {
    await host.installShippedTemplates(["typescript", "cdk"]);
    await host.writeHostPackage(scripts);
    await host.writeHostMarker("cdk.json", {
      app: "node bin/infrastructure.js",
    });
  }

  it("keeps a host test:integration instead of replacing it", async () => {
    const hostValue = "vitest run '.integration.' --passWithNoTests";
    await cdkHost({ [INTEGRATION]: hostValue });
    await host.runApply();
    expect((await host.hostScripts())[INTEGRATION]).toBe(hostValue);
  });

  it("installs a usable test:integration when none exists", async () => {
    await cdkHost({ build: "tsc --noEmit" });
    await host.runApply();
    const scripts = await host.hostScripts();
    expect(scripts[INTEGRATION]).toContain(INTEGRATION_LISA);
    expect(scripts[INTEGRATION]).not.toBe(LITERAL_PATH_VALUE);
    expect(scripts[INTEGRATION_LISA]).toBeDefined();
  });

  it("reclaims a previously forced literal path", async () => {
    await cdkHost({ [INTEGRATION]: LITERAL_PATH_VALUE });
    await host.runApply();
    const scripts = await host.hostScripts();
    expect(scripts[INTEGRATION]).toContain(INTEGRATION_LISA);
    expect(scripts[INTEGRATION]).not.toBe(LITERAL_PATH_VALUE);
  });
});
