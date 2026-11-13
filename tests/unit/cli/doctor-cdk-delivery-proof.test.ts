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
const PIPELINE = "host-delivery";
const ACCOUNT = "111111111111";
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
              pipeline_name: PIPELINE,
              region: "us-east-1",
              account_id: ACCOUNT,
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

  /**
   * Write one config file.
   * @param fileName - Shared or local config
   * @param value - JSON-compatible config
   * @returns Nothing
   */
  async function write(fileName: string, value: unknown): Promise<void> {
    await fse.writeJson(path.join(tempDir, fileName), value);
  }

  /**
   * A config holding only the production delivery declaration.
   * @param production - The declaration
   * @returns Config object
   */
  function delivery(production: unknown): unknown {
    return { verification: { completion: { delivery: { production } } } };
  }

  it.each([
    ["shared names the mechanism, local the pipeline", CONFIG, LOCAL_CONFIG],
    ["local names the mechanism, shared the pipeline", LOCAL_CONFIG, CONFIG],
  ])(
    "merges a declaration split across both files: %s",
    async (_, first, second) => {
      await markCdk();
      await write(first, delivery({ mechanism: CODEPIPELINE }));
      await write(
        second,
        delivery({
          pipeline_name: PIPELINE,
          region: "us-east-1",
          account_id: ACCOUNT,
        })
      );

      const check = await checkCdkDeliveryProof(tempDir);

      expect(check.status).toBe("ok");
      expect(check.detail).toContain("production");
    }
  );

  it("warns about a mechanism completion does not accept", async () => {
    await markCdk();
    await write(CONFIG, delivery({ mechanism: "aws-code-pipeline" }));

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(SETTING);
  });

  it("warns about an empty delivery declaration", async () => {
    await markCdk();
    await write(CONFIG, delivery({}));

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(SETTING);
  });

  it("warns about a region the verifier would reject", async () => {
    await markCdk();
    await write(
      CONFIG,
      delivery({
        mechanism: CODEPIPELINE,
        pipeline_name: PIPELINE,
        region: "US East",
      })
    );

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      "verification.completion.delivery.production.region"
    );
    expect(check.detail).not.toContain(".pipeline_name");
  });

  it("warns about a CodePipeline delivery with no account, naming the cross-account risk", async () => {
    await markCdk();
    await write(
      CONFIG,
      delivery({
        mechanism: CODEPIPELINE,
        pipeline_name: PIPELINE,
        region: "us-east-1",
      })
    );

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      "verification.completion.delivery.production.account_id"
    );
    expect(check.detail).toContain("another stage's AWS account");
  });

  it("warns about a malformed account id", async () => {
    await markCdk();
    await write(
      CONFIG,
      delivery({
        mechanism: CODEPIPELINE,
        pipeline_name: PIPELINE,
        region: "us-east-1",
        account_id: "12345",
      })
    );

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("is not a 12-digit AWS account id");
  });

  it("warns when only a non-production environment is declared", async () => {
    await markCdk();
    await write(CONFIG, {
      verification: {
        completion: {
          delivery: {
            staging: {
              mechanism: CODEPIPELINE,
              pipeline_name: PIPELINE,
              region: "us-east-1",
              account_id: ACCOUNT,
            },
          },
        },
      },
    });

    const check = await checkCdkDeliveryProof(tempDir);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      "verification.completion.delivery.production declares no accepted mechanism"
    );
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
