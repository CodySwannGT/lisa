/* eslint-disable max-lines -- comprehensive integration tests for all Lisa stack types require extensive test cases */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import {
  BackupService,
  DryRunBackupService,
} from "../../src/transaction/index.js";
import {
  cleanupTempDir,
  countFiles,
  createCDKProject,
  createExpoProject,
  createHarperFabricProject,
  createMockLisaDir,
  createNestJSProject,
  createRailsProject,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";
const SETTINGS_JSON = "settings.json";
const TEST_TXT = "test.txt";
const TSCONFIG_BASE = "tsconfig.base.json";
const LISAIGNORE = ".lisaignore";
const LEGACY_WORKFLOW = "legacy-workflow.yml";
const CREATE_ONLY = "create-only";
const COPY_OVERWRITE = "copy-overwrite";
const KNIP_JSON = "knip.json";
const LINT_STAGED_JSON = ".lintstagedrc.json";
const SAFETY_NET_JSON = ".safety-net.json";
const HARPER_FABRIC_TYPE = "harper-fabric";
const HARPER_FABRIC_TXT = "harper-fabric.txt";
const JEST_CONFIG_LOCAL = "jest.config.local.ts";

describe("Lisa Integration Tests", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a Lisa config for testing
   * @param overrides - Configuration overrides
   * @returns Lisa configuration with test defaults
   */
  function createConfig(overrides: Partial<LisaConfig> = {}): LisaConfig {
    return {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
      ...overrides,
    };
  }

  /**
   * Create Lisa dependencies for testing
   * @param config - Configuration to use for dependencies
   * @returns Lisa dependencies with test implementations
   */
  function createDeps(config: LisaConfig): LisaDependencies {
    const logger = new SilentLogger();
    return {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: config.dryRun
        ? new DryRunBackupService()
        : new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
  }

  /**
   * Create a Lisa instance with optional config overrides
   * @param overrides - Configuration overrides
   * @returns Lisa instance ready for apply/validate
   */
  function createLisa(overrides: Partial<LisaConfig> = {}): Lisa {
    const config = createConfig(overrides);
    return new Lisa(config, createDeps(config));
  }

  describe("apply", () => {
    it("applies configurations to TypeScript project", async () => {
      await createTypeScriptProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("typescript");

      // Check that files were copied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
      expect(await fs.pathExists(path.join(destDir, TSCONFIG_BASE))).toBe(true);
    });

    it("preserves host-owned config during postinstall-safe apply", async () => {
      await createTypeScriptProject(destDir);
      const guardedPostinstall =
        '[ -n "$CI" ] || LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true';
      const hostPackageJson = {
        name: "host-project",
        dependencies: { typescript: "^5.0.0" },
        scripts: { postinstall: guardedPostinstall, test: "host test" },
        devDependencies: { oxlint: "^0.1.0" },
      };
      const hostKnip = { ignoreDependencies: ["shell-quote"] };
      const hostLintStaged = { "*.ts": "host-lint" };
      const hostSafetyNet = { rules: [] };

      await fs.writeJson(path.join(destDir, PACKAGE_JSON), hostPackageJson);
      await fs.writeJson(path.join(destDir, KNIP_JSON), hostKnip);
      await fs.writeJson(path.join(destDir, LINT_STAGED_JSON), hostLintStaged);
      await fs.writeJson(path.join(destDir, SAFETY_NET_JSON), hostSafetyNet);

      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.writeJson(path.join(tsCopyOverwrite, KNIP_JSON), {
        ignoreDependencies: ["from-lisa"],
      });
      await fs.writeJson(path.join(tsCopyOverwrite, LINT_STAGED_JSON), {
        "*.ts": "lisa-lint",
      });
      await fs.writeJson(path.join(tsCopyOverwrite, SAFETY_NET_JSON), {
        rules: [{ match: "no-verify" }],
      });
      const packageLisaDir = path.join(lisaDir, "typescript", "package-lisa");
      await fs.ensureDir(packageLisaDir);
      await fs.writeJson(path.join(packageLisaDir, "package.lisa.json"), {
        force: {
          scripts: { test: "vitest run" },
          devDependencies: { oxlint: "^1.0.0" },
        },
      });

      const result = await createLisa({ skipGitCheck: true }).apply();

      expect(result.success).toBe(true);
      expect(await fs.readJson(path.join(destDir, PACKAGE_JSON))).toEqual(
        hostPackageJson
      );
      expect(await fs.readJson(path.join(destDir, KNIP_JSON))).toEqual(
        hostKnip
      );
      expect(await fs.readJson(path.join(destDir, LINT_STAGED_JSON))).toEqual(
        hostLintStaged
      );
      expect(await fs.readJson(path.join(destDir, SAFETY_NET_JSON))).toEqual(
        hostSafetyNet
      );
    });

    it("is a no-op on the second apply to an unchanged managed tree", async () => {
      await createTypeScriptProject(destDir);

      const auditConfig = "audit.ignore.config.json";
      const auditLocal = "audit.ignore.local.json";
      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.writeJson(path.join(tsCopyOverwrite, auditConfig), {
        exclusions: [{ id: "LISA-OWNED", package: "pkg", reason: "template" }],
      });
      await fs.writeJson(path.join(destDir, auditConfig), {
        exclusions: [
          { id: "LISA-OWNED", package: "pkg", reason: "template" },
          { id: "PROJECT-LOCAL", package: "dep", reason: "host" },
        ],
      });

      const first = await createLisa().apply();
      expect(first.success).toBe(true);
      expect(first.counters.migrationsApplied).toBeGreaterThan(0);

      const second = await createLisa().apply();

      expect(second.success).toBe(true);
      expect(second.counters.overwritten).toBe(0);
      expect(second.counters.merged).toBe(0);
      expect(second.counters.migrationsApplied).toBe(0);
      expect(await fs.readJson(path.join(destDir, auditLocal))).toEqual({
        exclusions: [{ id: "PROJECT-LOCAL", package: "dep", reason: "host" }],
      });
    });

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
      });

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(await fs.pathExists(path.join(destDir, JEST_CONFIG_LOCAL))).toBe(
        false
      );
      expect(result.counters.skipped).toBeGreaterThan(0);
      expect(result.counters.deleted).toBe(0);
    });

    it("child stack create-only overrides parent stack create-only for the same path", async () => {
      // Regression for the CDK ci.yml clobber bug:
      // typescript/create-only/.github/workflows/ci.yml ships a bun-mode CI
      // workflow. cdk/create-only/.github/workflows/ci.yml ships an npm-mode
      // CI workflow with CDK-specific determine_environment / cdk-checks
      // jobs. Without the create-only ownership gate, typescript runs first
      // and the CreateOnlyStrategy silently no-ops cdk's version because the
      // destination already exists, leaving CDK projects with the wrong
      // (bun-mode) workflow — which fails immediately in CI because CDK
      // projects pin bun to "please-use-npm" and only ship a
      // package-lock.json.
      const CI_YML = ".github/workflows/ci.yml";
      const TS_CI = "package_manager: 'bun'\n# typescript/create-only\n";
      const CDK_CI =
        "package_manager: 'npm'\n# cdk/create-only — determine_environment\n";

      await createCDKProject(destDir);

      const tsCreateOnly = path.join(
        lisaDir,
        "typescript",
        CREATE_ONLY,
        ".github",
        "workflows"
      );
      await fs.ensureDir(tsCreateOnly);
      await fs.writeFile(path.join(tsCreateOnly, "ci.yml"), TS_CI);

      const cdkCreateOnly = path.join(
        lisaDir,
        "cdk",
        CREATE_ONLY,
        ".github",
        "workflows"
      );
      await fs.ensureDir(cdkCreateOnly);
      await fs.writeFile(path.join(cdkCreateOnly, "ci.yml"), CDK_CI);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      const finalCi = await fs.readFile(path.join(destDir, CI_YML), "utf-8");
      // The CDK version (npm + determine_environment) must win, not the
      // typescript bun version. This is the load-bearing assertion — if it
      // flips, CI breaks for every CDK project on the next Lisa update.
      expect(finalCi).toBe(CDK_CI);
      expect(finalCi).not.toBe(TS_CI);
    });

    it("Harper/Fabric child stack overrides TypeScript parent templates", async () => {
      const SHARED_CONFIG = "shared-stack-config.txt";
      const TS_CONFIG = "typescript parent\n";
      const HARPER_CONFIG = "harper child\n";

      await createHarperFabricProject(destDir);

      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.ensureDir(tsCopyOverwrite);
      await fs.writeFile(path.join(tsCopyOverwrite, SHARED_CONFIG), TS_CONFIG);

      const harperCopyOverwrite = path.join(
        lisaDir,
        HARPER_FABRIC_TYPE,
        COPY_OVERWRITE
      );
      await fs.ensureDir(harperCopyOverwrite);
      await fs.writeFile(
        path.join(harperCopyOverwrite, SHARED_CONFIG),
        HARPER_CONFIG
      );

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      const finalConfig = await fs.readFile(
        path.join(destDir, SHARED_CONFIG),
        "utf-8"
      );
      expect(finalConfig).toBe(HARPER_CONFIG);
    });

    it("writes an overlapping copy-overwrite path exactly once (no parent-then-child clobber window)", async () => {
      // Crash-safety regression for the postinstall half-apply bug (#318):
      // when a parent (typescript) and child (harper-fabric) stack both ship
      // the same copy-overwrite path, the apply must NOT write the parent
      // version and then overwrite it with the child's — that intermediate
      // write is the window in which a killed lifecycle process left projects
      // with TypeScript configs clobbering the child stack's. The
      // copyOverwriteOwnership map makes the most-specific stack the sole
      // writer, so on a fresh destination the path is "copied" once and never
      // "overwritten". If ownership regresses, the parent writes first and the
      // child's write becomes an overwrite — exactly what this asserts against.
      const SHARED_CONFIG = "shared-stack-config.txt";
      const TS_CONFIG = "typescript parent\n";
      const HARPER_CONFIG = "harper child\n";

      await createHarperFabricProject(destDir);

      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.ensureDir(tsCopyOverwrite);
      await fs.writeFile(path.join(tsCopyOverwrite, SHARED_CONFIG), TS_CONFIG);

      const harperCopyOverwrite = path.join(
        lisaDir,
        HARPER_FABRIC_TYPE,
        COPY_OVERWRITE
      );
      await fs.ensureDir(harperCopyOverwrite);
      await fs.writeFile(
        path.join(harperCopyOverwrite, SHARED_CONFIG),
        HARPER_CONFIG
      );

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // The child version still wins (final-state correctness).
      const finalConfig = await fs.readFile(
        path.join(destDir, SHARED_CONFIG),
        "utf-8"
      );
      expect(finalConfig).toBe(HARPER_CONFIG);
      // Load-bearing crash-safety assertion: nothing was overwritten in place.
      // The mock lisaDir ships no cross-type copy-overwrite collisions, so on a
      // fresh destination the only candidate for an overwrite is SHARED_CONFIG.
      // Zero overwrites proves the typescript source was skipped, not written
      // first and clobbered.
      expect(result.counters.overwritten).toBe(0);
    });

    it("registers plugins at project scope when settings.json has enabledPlugins", async () => {
      await createTypeScriptProject(destDir);

      // Pre-create destination settings so merge path is exercised
      const destClaudeDir = path.join(destDir, ".claude");
      await fs.ensureDir(destClaudeDir);
      await fs.writeJson(path.join(destClaudeDir, SETTINGS_JSON), {
        env: { SOME_VAR: "1" },
      });

      // Create merge source with enabledPlugins
      const mergeDir = path.join(lisaDir, "all", "merge", ".claude");
      await fs.ensureDir(mergeDir);
      await fs.writeJson(path.join(mergeDir, SETTINGS_JSON), {
        enabledPlugins: {
          "test-plugin@test-marketplace": true,
        },
      });

      // Stub the `claude` CLI so plugin registration doesn't hit network/real
      // marketplace and the test stays fast under full-suite contention.
      const stubBin = path.join(tempDir, "stub-bin");
      await fs.ensureDir(stubBin);
      const stubClaude = path.join(stubBin, "claude");
      await fs.writeFile(stubClaude, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      const originalPath = process.env.PATH;
      process.env.PATH = `${stubBin}:${originalPath ?? ""}`;

      try {
        const result = await createLisa().apply();

        expect(result.success).toBe(true);
        const settings = await fs.readJson(
          path.join(destDir, ".claude", SETTINGS_JSON)
        );
        expect(settings.enabledPlugins["test-plugin@test-marketplace"]).toBe(
          true
        );
        // Existing project keys preserved
        expect(settings.env.SOME_VAR).toBe("1");
      } finally {
        process.env.PATH = originalPath;
      }
    }, 15_000);

    it("applies all/ configs to project with no detected types", async () => {
      await fs.ensureDir(destDir);
      await fs.writeJson(path.join(destDir, PACKAGE_JSON), {});

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toHaveLength(0);

      // all/ configs should still be applied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
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

  describe("Rails stack", () => {
    it("applies configurations to Rails project", async () => {
      await createRailsProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("rails");
    });

    it("does not apply typescript pack to Rails project", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      // TypeScript-specific files should NOT be present
      expect(
        await fs.pathExists(path.join(destDir, "tsconfig.base.json"))
      ).toBe(false);
    });

    it("overrides CLAUDE.md with Rails-specific version", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const claudeContent = await fs.readFile(
        path.join(destDir, "CLAUDE.md"),
        "utf-8"
      );
      expect(claudeContent).toContain("Rails governance rules");
    });

    it("appends eval_gemfile to Gemfile with markers", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const gemfileContent = await fs.readFile(
        path.join(destDir, "Gemfile"),
        "utf-8"
      );
      expect(gemfileContent).toContain("eval_gemfile");
      expect(gemfileContent).toContain("# BEGIN: AI GUARDRAILS");
      expect(gemfileContent).toContain("# END: AI GUARDRAILS");
    });

    it("deploys Gemfile.lisa via copy-overwrite", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      expect(await fs.pathExists(path.join(destDir, "Gemfile.lisa"))).toBe(
        true
      );
      const gemfileLisaContent = await fs.readFile(
        path.join(destDir, "Gemfile.lisa"),
        "utf-8"
      );
      expect(gemfileLisaContent).toContain("strong_migrations");
    });

    it("deletes .overcommit.yml via deletions.json", async () => {
      await createRailsProject(destDir);
      // Pre-create .overcommit.yml to simulate existing project
      await fs.writeFile(
        path.join(destDir, ".overcommit.yml"),
        "old overcommit config\n"
      );

      await createLisa().apply();

      expect(await fs.pathExists(path.join(destDir, ".overcommit.yml"))).toBe(
        false
      );
    });

    it("deploys .mise.toml via create-only", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      expect(await fs.pathExists(path.join(destDir, ".mise.toml"))).toBe(true);
      const content = await fs.readFile(
        path.join(destDir, ".mise.toml"),
        "utf-8"
      );
      expect(content).toContain("[tools]");
      expect(content).toContain("ruby");
    });

    it("deploys ci.yml wrapper via create-only", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const ciPath = path.join(destDir, ".github", "workflows", "ci.yml");
      expect(await fs.pathExists(ciPath)).toBe(true);
      const content = await fs.readFile(ciPath, "utf-8");
      expect(content).toContain(
        "types: [opened, synchronize, reopened, labeled, unlabeled]"
      );
      expect(content).toContain("uses: ./.github/workflows/quality.yml");
      expect(content).toContain("secrets: inherit");
    });

    it("deploys quality.yml with workflow_call trigger via create-only", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const qualityPath = path.join(
        destDir,
        ".github",
        "workflows",
        "quality.yml"
      );
      expect(await fs.pathExists(qualityPath)).toBe(true);
      const content = await fs.readFile(qualityPath, "utf-8");
      expect(content).toContain("workflow_call:");
    });

    it("preserves create-only files on re-run", async () => {
      await createRailsProject(destDir);

      // First run — creates .rubocop.local.yml
      await createLisa().apply();

      // Modify the create-only file
      const localRubocopPath = path.join(destDir, ".rubocop.local.yml");
      await fs.writeFile(localRubocopPath, "# Custom project overrides\n");

      // Second run — should NOT overwrite
      await createLisa().apply();

      const content = await fs.readFile(localRubocopPath, "utf-8");
      expect(content).toBe("# Custom project overrides\n");
    });

    it("handles Rails + TypeScript project correctly", async () => {
      await createRailsProject(destDir);
      // Also add TypeScript indicators
      await fs.writeJson(path.join(destDir, "package.json"), {
        dependencies: { typescript: "^5.0.0" },
      });
      await fs.writeJson(path.join(destDir, "tsconfig.json"), {});

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("rails");
      expect(result.detectedTypes).toContain("typescript");
    });
  });

  describe(".lisaignore", () => {
    it("skips files matching patterns in .lisaignore", async () => {
      await createTypeScriptProject(destDir);

      // Create .lisaignore to skip test.txt
      await fs.writeFile(path.join(destDir, LISAIGNORE), TEST_TXT);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // test.txt should NOT be copied because it's ignored
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(false);
      // Other files should still be copied
      expect(await fs.pathExists(path.join(destDir, TSCONFIG_BASE))).toBe(true);
      // Ignored count should be > 0
      expect(result.counters.ignored).toBeGreaterThan(0);
    });

    it("skips entire directories matching patterns", async () => {
      await createTypeScriptProject(destDir);

      // Create .lisaignore to skip typescript/ directory files
      // Since tsconfig.base.json comes from typescript/, ignoring it should work
      await fs.writeFile(path.join(destDir, LISAIGNORE), TSCONFIG_BASE);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // tsconfig.base.json should NOT be copied
      expect(await fs.pathExists(path.join(destDir, TSCONFIG_BASE))).toBe(
        false
      );
      // test.txt should still be copied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
    });

    it("works with dry run mode", async () => {
      await createTypeScriptProject(destDir);
      await fs.writeFile(path.join(destDir, LISAIGNORE), TEST_TXT);

      const result = await createLisa({ dryRun: true }).apply();

      expect(result.success).toBe(true);
      expect(result.counters.ignored).toBeGreaterThan(0);
    });

    it("prevents deletions for files matching .lisaignore", async () => {
      await createTypeScriptProject(destDir);

      // Pre-create a file that typescript/deletions.json would delete
      await fs.writeFile(
        path.join(destDir, LEGACY_WORKFLOW),
        "legacy content\n"
      );

      // Create .lisaignore to protect it
      await fs.writeFile(path.join(destDir, LISAIGNORE), LEGACY_WORKFLOW);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // File should still exist because .lisaignore protects it from deletion
      expect(await fs.pathExists(path.join(destDir, LEGACY_WORKFLOW))).toBe(
        true
      );
    });

    it("does nothing when .lisaignore is empty or missing", async () => {
      await createTypeScriptProject(destDir);
      // No .lisaignore file

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.counters.ignored).toBe(0);
      // All files should be copied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
    });
  });
});
/* eslint-enable max-lines -- re-enable after integration test suite */
