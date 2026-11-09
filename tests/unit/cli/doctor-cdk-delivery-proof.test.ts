/**
 * Doctor coverage for a CDK host that cannot prove delivery.
 *
 * A CDK app delivers through CodePipeline, not through a GitHub Actions run,
 * so with no `verification.completion.delivery` its lifecycle completion stops
 * at pending-proof with nothing telling the operator what to declare
 * (CodySwannGT/lisa#4646). These tests pin the check that names the setting.
 * @module tests/unit/cli/doctor-cdk-delivery-proof
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CDK_DELIVERY_PROOF_CHECK_NAME,
  checkCdkDeliveryProof,
} from "../../../src/cli/doctor-cdk-delivery-proof.js";
import { runDoctor } from "../../../src/cli/doctor.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const CONFIG = ".lisa.config.json";
const LOCAL_CONFIG = ".lisa.config.local.json";
const CODEPIPELINE = "aws-codepipeline";
const SETTING = "verification.completion.delivery.<env>";

describe("doctor CDK delivery-proof check", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Make the temp directory a CDK app.
   * @returns Nothing
   */
  async function markCdk(): Promise<void> {
    await fse.writeJson(path.join(tempDir, "cdk.json"), {
      app: "npx tsx bin/app.ts",
    });
  }

  it("passes a repository that is not a CDK app", async () => {
    const check = await checkCdkDeliveryProof(tempDir);

    expect(check).toEqual({
      name: CDK_DELIVERY_PROOF_CHECK_NAME,
      status: "ok",
      detail: "Not a CDK project",
    });
  });

  it("reports a CDK host with no delivery setting, naming the setting and the CodePipeline mechanism", async () => {
    await markCdk();
    await fse.writeJson(path.join(tempDir, CONFIG), { tracker: "github" });

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(SETTING);
    expect(check.detail).toContain(CODEPIPELINE);
    expect(check.detail).toContain("pipeline_name");
    expect(check.detail).toContain("region");
  });

  it("reports a CDK host with no config file at all", async () => {
    await markCdk();

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(SETTING);
  });

  it("passes a CDK host whose local config declares the CodePipeline delivery", async () => {
    await markCdk();
    await fse.writeJson(path.join(tempDir, LOCAL_CONFIG), {
      verification: {
        completion: {
          delivery: {
            production: {
              mechanism: CODEPIPELINE,
              pipeline_name: "host-delivery",
              region: "us-east-1",
            },
          },
        },
      },
    });

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("production");
  });

  it("reports a CodePipeline delivery declared without its pipeline name or region", async () => {
    await markCdk();
    await fse.writeJson(path.join(tempDir, CONFIG), {
      verification: {
        completion: {
          delivery: { production: { mechanism: CODEPIPELINE } },
        },
      },
    });

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      "verification.completion.delivery.production.pipeline_name"
    );
    expect(check.detail).toContain(
      "verification.completion.delivery.production.region"
    );
  });

  it("says it could not inspect a malformed config rather than passing it", async () => {
    await markCdk();
    await fse.outputFile(path.join(tempDir, CONFIG), "{ not json");

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(`Could not inspect ${CONFIG}`);
  });

  it("is part of the doctor report", async () => {
    await markCdk();
    await fse.writeJson(path.join(tempDir, CONFIG), { tracker: "github" });

    const result = await runDoctor(
      tempDir,
      { offline: true },
      { runUpdateCheck: vi.fn(), setExitCode: vi.fn(), write: vi.fn() }
    );
    const check = result.checks.find(
      row => row.name === CDK_DELIVERY_PROOF_CHECK_NAME
    );

    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain(SETTING);
  });
});
