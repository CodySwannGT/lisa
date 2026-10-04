/**
 * Real shipped CDK package policy must admit its supported OIDC major without
 * rewriting host-owned construct versions or bypassing forced peer guards.
 * @module tests/unit/strategies/package-lisa-cdk-oidc
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { minVersion, satisfies } from "semver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { LisaConfig } from "../../../src/core/config.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const OIDC = "aws-cdk-github-oidc";
const PACKAGE_JSON = "package.json";
const REPO_ROOT = process.cwd();
const SOURCE = path.join(REPO_ROOT, "cdk/package-lisa/package.lisa.json");
// Versioned public 5.2.0 metadata, not inferred from the template under test.
const OIDC_PEERS = { constructs: "^10.7.2", "aws-cdk-lib": "^2.260.0" };
const OIDC_NODE = ">=22 <=26";

describe("supported CDK OIDC template", () => {
  let projectDir: string;
  let destination: string;
  let strategy: PackageLisaStrategy;
  let context: StrategyContext;

  beforeEach(async () => {
    projectDir = await createTempDir();
    destination = path.join(projectDir, PACKAGE_JSON);
    await fs.writeJson(path.join(projectDir, "cdk.json"), {
      app: "node app.js",
    });
    strategy = new PackageLisaStrategy(() => "9.9.9");
    const config: LisaConfig = {
      lisaDir: REPO_ROOT,
      destDir: projectDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "codex",
    };
    context = {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  });

  afterEach(async () => {
    await cleanupTempDir(projectDir);
  });

  it("preserves an exact supported pin and newer compatible peer choices", async () => {
    await fs.writeJson(destination, {
      name: "host",
      dependencies: {
        [OIDC]: "5.2.0",
        constructs: "10.8.1",
        "aws-cdk-lib": "2.272.0",
        "@aws-cdk/aws-amplify-alpha": "2.272.0-alpha.0",
      },
    });
    const result = await strategy.apply(
      SOURCE,
      destination,
      PACKAGE_JSON,
      context
    );
    expect(result.action).not.toBe("skipped");
    const written = await fs.readJson(destination);
    expect(written.dependencies).toMatchObject({
      [OIDC]: "5.2.0",
      constructs: "10.8.1",
      "aws-cdk-lib": "2.272.0",
      "@aws-cdk/aws-amplify-alpha": "2.272.0-alpha.0",
    });
    expect(written.overrides["aws-cdk-lib"]).toBe("$aws-cdk-lib");
    expect(written.overrides.esbuild).toBe("$esbuild");
    expect(written.overrides.vite).toBe("$vite");
  });

  it("gives a fresh host the supported OIDC default", async () => {
    await fs.writeJson(destination, { name: "host" });
    await strategy.apply(SOURCE, destination, PACKAGE_JSON, context);
    const written = await fs.readJson(destination);
    expect(written.dependencies[OIDC]).toBe("^5.2.0");
  });

  it("gives a fresh host minimum versions that satisfy the declared peers", async () => {
    await fs.writeJson(destination, { name: "host" });
    await strategy.apply(SOURCE, destination, PACKAGE_JSON, context);
    const written = await fs.readJson(destination);
    expect(
      satisfies(
        minVersion(written.dependencies.constructs)!,
        OIDC_PEERS.constructs
      )
    ).toBe(true);
    expect(
      satisfies(
        minVersion(written.dependencies["aws-cdk-lib"])!,
        OIDC_PEERS["aws-cdk-lib"]
      )
    ).toBe(true);
    expect(satisfies(written.engines.node, OIDC_NODE)).toBe(true);
  });

  it("preserves an explicit legacy OIDC major for deliberate application migration", async () => {
    await fs.writeJson(destination, {
      name: "host",
      dependencies: { [OIDC]: "^2.4.1" },
    });
    await strategy.apply(SOURCE, destination, PACKAGE_JSON, context);
    const written = await fs.readJson(destination);
    expect(written.dependencies[OIDC]).toBe("^2.4.1");
  });

  it("still refuses a disjoint forced constructs major without rewriting the manifest", async () => {
    await fs.writeJson(destination, {
      name: "host",
      dependencies: { constructs: "^11.0.0" },
    });
    const original = await fs.readFile(destination, "utf8");
    await expect(
      strategy.apply(SOURCE, destination, PACKAGE_JSON, context)
    ).rejects.toThrow("dependencies.constructs cannot be merged");
    expect(await fs.readFile(destination, "utf8")).toBe(original);
  });

  it("adds no phantom executable to a source-only CDK application", async () => {
    await fs.writeJson(destination, { name: "host" });
    await strategy.apply(SOURCE, destination, PACKAGE_JSON, context);
    const written = await fs.readJson(destination);
    expect(written).not.toHaveProperty("bin");
    expect(
      await fs.pathExists(path.join(projectDir, "bin/infrastructure.js"))
    ).toBe(false);
  });

  it("preserves legitimate host bin mappings without adding a phantom entry", async () => {
    const hostBin = { "host-tool": "bin/host-tool.js" };
    await fs.outputFile(
      path.join(projectDir, "bin/host-tool.js"),
      "#!/usr/bin/env node\n"
    );
    await fs.writeJson(destination, { name: "host", bin: hostBin });
    await strategy.apply(SOURCE, destination, PACKAGE_JSON, context);
    const written = await fs.readJson(destination);
    expect(written.bin).toEqual(hostBin);
    expect(
      await fs.pathExists(path.join(projectDir, hostBin["host-tool"]))
    ).toBe(true);
  });
});
