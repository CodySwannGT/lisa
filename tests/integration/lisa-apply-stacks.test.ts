/**
 * Lisa integration tests: per-stack apply, manifests and deletions, plus dry-run, validate, idempotency, and error handling.
 * Sibling of lisa.test.ts, which owns the learnings-ledger apply cases.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { Lisa } from "../../src/core/lisa.js";
import {
  cleanupTempDir,
  countFiles,
  createCDKProject,
  createExpoProject,
  createHarperFabricProject,
  createMockLisaDir,
  createNestJSProject,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";
import {
  buildConfig,
  COPY_OVERWRITE,
  CREATE_ONLY,
  createDeps,
  HARPER_FABRIC_TXT,
  HARPER_FABRIC_TYPE,
  JEST_CONFIG_LOCAL,
} from "./lisa-fixtures.js";

// Marketplace installation is outside this suite's file-generation assertions.
// Never install into the operator's real agents while generating test projects.
vi.mock("../../src/agy/plugin-installer.js", () => ({
  installAgyPlugin: vi.fn().mockResolvedValue({
    attempted: false,
    installed: false,
  }),
}));
vi.mock("../../src/copilot/plugin-installer.js", () => ({
  installCopilotPlugin: vi.fn().mockResolvedValue({
    attempted: false,
    installed: false,
  }),
}));

describe("Lisa Integration Tests", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Full fleet apply also reconciles user-scoped Antigravity MCP settings.
    // Keep that real filesystem behavior inside this fixture's owned tree.
    const home = path.join(tempDir, "home");
    await fs.ensureDir(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a Lisa instance with optional config overrides
   * @param overrides - Configuration overrides
   * @returns Lisa instance ready for apply/validate
   */
  function createLisa(overrides: Partial<LisaConfig> = {}): Lisa {
    const config = buildConfig(lisaDir, destDir, overrides);
    return new Lisa(config, createDeps(config));
  }

  describe("apply", () => {
    it("applies configurations to Expo project", async () => {
      await createExpoProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("expo");
      expect(result.detectedTypes).toContain("typescript"); // Parent type
    });

    it("applies configurations to NestJS project", async () => {
      await createNestJSProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("nestjs");
      expect(result.detectedTypes).toContain("typescript");
    });

    it("applies configurations to CDK project", async () => {
      await createCDKProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("cdk");
      expect(result.detectedTypes).toContain("typescript");
    });

    it("applies configurations to Harper/Fabric project", async () => {
      await createHarperFabricProject(destDir);

      const harperDir = path.join(lisaDir, HARPER_FABRIC_TYPE, COPY_OVERWRITE);
      await fs.ensureDir(harperDir);
      await fs.writeFile(path.join(harperDir, HARPER_FABRIC_TXT), "ok\n");

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain(HARPER_FABRIC_TYPE);
      expect(result.detectedTypes).toContain("typescript");
      expect(await fs.pathExists(path.join(destDir, HARPER_FABRIC_TXT))).toBe(
        true
      );
    });

    it("ships Harper/Fabric deploy and ZAP workflow templates as create-only files", async () => {
      await createHarperFabricProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      const deployPath = path.join(
        destDir,
        ".github",
        "workflows",
        "deploy.yml"
      );
      const zapWorkflowPath = path.join(
        destDir,
        ".github",
        "workflows",
        "zap-baseline.yml"
      );
      const zapScriptPath = path.join(destDir, "scripts", "zap-baseline.sh");
      const zapConfigPath = path.join(destDir, ".zap", "baseline.conf");

      expect(await fs.pathExists(deployPath)).toBe(true);
      expect(await fs.pathExists(zapWorkflowPath)).toBe(true);
      expect(await fs.pathExists(zapScriptPath)).toBe(true);
      expect(await fs.pathExists(zapConfigPath)).toBe(true);

      const deployContent = await fs.readFile(deployPath, "utf-8");
      expect(deployContent).toContain("bun run build");
      expect(deployContent).toContain("harper deploy_component");
      expect(deployContent).toContain("bun run verify");

      const zapWorkflowContent = await fs.readFile(zapWorkflowPath, "utf-8");
      expect(zapWorkflowContent).toContain("scripts/zap-baseline.sh");
    });

    it("preserves existing Harper/Fabric deploy workflow customizations", async () => {
      await createHarperFabricProject(destDir);
      const deployPath = path.join(
        destDir,
        ".github",
        "workflows",
        "deploy.yml"
      );
      const customDeploy = "name: Custom Harper Deploy\n";
      await fs.ensureDir(path.dirname(deployPath));
      await fs.writeFile(deployPath, customDeploy);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      await createLisa().apply();
      const deployContent = await fs.readFile(deployPath, "utf-8");
      expect(deployContent).toBe(customDeploy);
    });

    it("removes an existing manifest file during apply", async () => {
      await createTypeScriptProject(destDir);
      const manifestPath = path.join(destDir, ".lisa-manifest");
      await fs.writeFile(manifestPath, "{}\n");

      await createLisa().apply();

      expect(await fs.pathExists(manifestPath)).toBe(false);
    });

    it("skips creating files a detected type's deletions.json will delete (CDK jest inheritance)", async () => {
      // Simulate the real-world CDK/typescript interaction: typescript ships a
      // jest config via create-only, CDK's deletions.json removes it. Without
      // the pending-deletion gate, Lisa creates-then-deletes, which races with
      // any concurrent file-watcher/linter.
      await createCDKProject(destDir);

      // Add a file to typescript/create-only that CDK's deletions.json removes
      const tsCreateOnly = path.join(lisaDir, "typescript", CREATE_ONLY);
      await fs.ensureDir(tsCreateOnly);
      await fs.writeFile(
        path.join(tsCreateOnly, JEST_CONFIG_LOCAL),
        "export default {};\n"
      );

      // Ensure CDK stack directory exists so detectedTypes picks it up
      const cdkDir = path.join(lisaDir, "cdk");
      await fs.ensureDir(cdkDir);
      await fs.writeJson(path.join(cdkDir, "deletions.json"), {
        paths: [JEST_CONFIG_LOCAL],
        basis: { [JEST_CONFIG_LOCAL]: "needs-review" },
      });

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // The file must NOT exist after apply (was never created, not
      // created-then-deleted).
      expect(await fs.pathExists(path.join(destDir, JEST_CONFIG_LOCAL))).toBe(
        false
      );
      // Verify the pending-deletion gate fired: the file must have been
      // *skipped* (never written to disk) rather than *deleted* (written then
      // removed).  If the gate were absent, deleted would be 1 and skipped
      // would be 0 for this file.
      expect(result.counters.skipped).toBeGreaterThan(0);
      expect(result.counters.deleted).toBe(0);
    });

    it("skips inherited Jest local config for Harper/Fabric projects", async () => {
      await createHarperFabricProject(destDir);

      const tsCreateOnly = path.join(lisaDir, "typescript", CREATE_ONLY);
      await fs.ensureDir(tsCreateOnly);
      await fs.writeFile(
        path.join(tsCreateOnly, JEST_CONFIG_LOCAL),
        "export default {};\n"
      );

      const harperDir = path.join(lisaDir, HARPER_FABRIC_TYPE);
      await fs.ensureDir(harperDir);
      await fs.writeJson(path.join(harperDir, "deletions.json"), {
        paths: [JEST_CONFIG_LOCAL],
        basis: { [JEST_CONFIG_LOCAL]: "needs-review" },
      });

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(await fs.pathExists(path.join(destDir, JEST_CONFIG_LOCAL))).toBe(
        false
      );
      expect(result.counters.skipped).toBeGreaterThan(0);
      expect(result.counters.deleted).toBe(0);
    });
  });

  describe("dry run", () => {
    it("does not modify files in dry run mode", async () => {
      await createTypeScriptProject(destDir);
      const beforeCount = await countFiles(destDir);

      const result = await createLisa({ dryRun: true }).apply();

      expect(result.success).toBe(true);
      const afterCount = await countFiles(destDir);
      expect(afterCount).toBe(beforeCount);
    });

    it("returns counters for what would be done", async () => {
      await createTypeScriptProject(destDir);

      const result = await createLisa({ dryRun: true }).apply();

      expect(result.counters.copied).toBeGreaterThan(0);
    });
  });

  describe("validate", () => {
    it("validates project compatibility", async () => {
      await createTypeScriptProject(destDir);

      const result = await createLisa({
        validateOnly: true,
        dryRun: true,
      }).validate();

      expect(result.success).toBe(true);
      expect(result.mode).toBe("validate");
    });

    it("does not modify files in validate mode", async () => {
      await createTypeScriptProject(destDir);
      const beforeCount = await countFiles(destDir);

      await createLisa({ validateOnly: true, dryRun: true }).validate();

      const afterCount = await countFiles(destDir);
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe("idempotency", () => {
    it("running twice produces same result", async () => {
      await createTypeScriptProject(destDir);

      // First run
      const result1 = await createLisa().apply();

      expect(result1.success).toBe(true);

      // Second run
      const result2 = await createLisa().apply();

      expect(result2.success).toBe(true);
      // Second run should skip files since first run already applied them
      expect(result2.counters.skipped).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("fails with non-existent destination", async () => {
      const result = await createLisa({
        destDir: "/nonexistent/path",
      }).apply();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
