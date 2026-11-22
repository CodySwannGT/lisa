/**
 * The manager that launched an apply decides the forced package-manager floor
 * when the host has nothing else to say (CodySwannGT/lisa#4941).
 *
 * Drives the real strategy `apply` with the config `runApply` builds, so the
 * value travels the same way it does in production: from
 * `npm_config_user_agent`, through `LisaConfig.invokingPackageManager`, into
 * host detection.
 * @module tests/unit/strategies/package-lisa-invoking-manager
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";
const REPO_ROOT = process.cwd();
const SOURCE = path.join(REPO_ROOT, "cdk/package-lisa/package.lisa.json");
const NPM_FLOOR = { name: "npm", version: ">=11.6.0", onFail: "warn" };

describe("a fresh CDK host's floor follows the manager that adopted it", () => {
  let projectDir: string;
  let destination: string;

  /**
   * Apply the CDK package template the way `runApply` would.
   * @param invokingPackageManager - Manager named by the launcher, if any
   * @returns The host's package.json afterwards
   */
  async function adopt(
    invokingPackageManager: string | undefined
  ): Promise<Record<string, unknown>> {
    const config: LisaConfig = {
      lisaDir: REPO_ROOT,
      destDir: projectDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "codex",
      ...(invokingPackageManager === undefined
        ? {}
        : { invokingPackageManager }),
    };
    const context: StrategyContext = {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
    await new PackageLisaStrategy(() => "9.9.9").apply(
      SOURCE,
      destination,
      PACKAGE_JSON,
      context
    );
    return fs.readJson(destination);
  }

  beforeEach(async () => {
    projectDir = await createTempDir();
    destination = path.join(projectDir, PACKAGE_JSON);
    await fs.writeJson(path.join(projectDir, "cdk.json"), {
      app: "node app.js",
    });
    await fs.writeJson(destination, { name: "host" });
  });

  afterEach(async () => {
    await cleanupTempDir(projectDir);
  });

  it("gives a host launched with no manager the npm floor", async () => {
    expect((await adopt(undefined)).devEngines).toEqual({
      packageManager: NPM_FLOOR,
    });
  });

  it("keeps a bunx-adopted host free of the npm floor after bun.lock appears", async () => {
    const first = await adopt("bun");
    expect(first.devEngines).toBeUndefined();
    await fs.writeFile(path.join(projectDir, "bun.lock"), "");
    const second = await adopt(undefined);
    expect(second).toEqual(first);
  });
});
