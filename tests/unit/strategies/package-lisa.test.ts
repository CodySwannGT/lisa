/* eslint-disable max-lines -- Test file requires extensive test cases for comprehensive coverage */
/* eslint-disable sonarjs/no-duplicate-string -- Test fixtures necessarily repeat values */
/* eslint-disable sonarjs/no-unused-collection -- Mock collections for test isolation */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
  createExpoProject,
  createNestJSProject,
  createCDKProject,
} from "../../helpers/test-utils.js";

describe("PackageLisaStrategy", () => {
  let strategy: PackageLisaStrategy;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    strategy = new PackageLisaStrategy();
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a strategy context for testing
   * @param overrides - Configuration overrides for this test case
   * @returns StrategyContext with mocked callbacks
   */
  function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
    const config: LisaConfig = {
      lisaDir,
      destDir: projectDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      ...overrides,
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Mock collection for test isolation
    const recordedFiles: Array<[string, string]> = [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Mock collection for test isolation
    const backedUpFiles: string[] = [];

    return {
      config,
      recordFile: (relativePath: string, strategy: string) => {
        recordedFiles.push([relativePath, strategy]);
      },
      backupFile: async (absolutePath: string) => {
        backedUpFiles.push(absolutePath);
      },
      promptOverwrite: async () => true,
    };
  }

  /**
   * Create package.lisa.json template in Lisa directory
   * @param typeName - The project type (e.g., "all", "typescript", "expo")
   * @param template - The package.lisa.json template object with force/defaults/merge sections
   * @returns Promise resolving when template is created
   */
  async function createPackageLisaTemplate(
    typeName: string,
    template: object
  ): Promise<void> {
    const dir = path.join(lisaDir, typeName, "package-lisa");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "package.lisa.json"), template);
  }

  describe("basic properties", () => {
    it("has correct name", () => {
      expect(strategy.name).toBe("package-lisa");
    });
  });

  describe("when source does not exist", () => {
    it("skips when package.lisa.json not found", async () => {
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {});

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("skipped");
      expect(_result.strategy).toBe("package-lisa");
    });
  });

  describe("when destination does not exist", () => {
    it("copies file when destination missing", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { test: "jest" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      // In production, Lisa passes package.lisa.json as destPath
      // The strategy should translate this to package.json
      const destPath = path.join(projectDir, "package.lisa.json");
      const actualPackageJson = path.join(projectDir, "package.json");

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.lisa.json",
        createContext()
      );

      expect(_result.action).toBe("copied");
      // Strategy should write to package.json, not package.lisa.json
      expect(_result.relativePath).toBe("package.json");
      const content = await fs.readJson(actualPackageJson);
      expect(content).toEqual({ scripts: { test: "jest" } });
    });
  });

  describe("force behavior", () => {
    it("overwrites existing values with force section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest", build: "tsc" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      // Lisa passes package.lisa.json as destPath, strategy translates to package.json
      const destPath = path.join(projectDir, "package.lisa.json");
      const actualPackageJson = path.join(projectDir, "package.json");
      await fs.writeJson(actualPackageJson, {
        name: "my-project",
        scripts: { build: "rollup", start: "node index.js" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.lisa.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      expect(_result.relativePath).toBe("package.json");
      const content = await fs.readJson(actualPackageJson);
      expect(content.scripts.test).toBe("jest");
      expect(content.scripts.build).toBe("tsc");
      expect(content.scripts.start).toBe("node index.js"); // Preserved
      expect(content.name).toBe("my-project"); // Preserved
    });

    it("adds new values when force key missing from project", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          devDependencies: { eslint: "^9.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.devDependencies).toEqual({ eslint: "^9.0.0" });
    });
  });

  describe("defaults behavior", () => {
    it("only sets defaults when key missing from project", async () => {
      await createPackageLisaTemplate("all", {
        defaults: {
          engines: { node: "22.x" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.engines).toEqual({ node: "22.x" });
    });

    it("preserves project values when defaults conflict", async () => {
      await createPackageLisaTemplate("all", {
        defaults: {
          engines: { node: "22.x" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        name: "my-project",
        engines: { node: "20.x", bun: "1.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.engines.node).toBe("20.x"); // Project value preserved
      expect(content.engines.bun).toBe("1.0.0"); // Project value preserved
    });
  });

  describe("merge behavior", () => {
    it("concatenates arrays without duplication", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: ["@ast-grep/cli", "@sentry/cli"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        trustedDependencies: ["custom-cli"],
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual([
        "@ast-grep/cli",
        "@sentry/cli",
        "custom-cli",
      ]);
    });

    it("deduplicates identical values in merge arrays", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: ["@ast-grep/cli"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      // Project already has the Lisa item plus custom item
      await fs.writeJson(destPath, {
        trustedDependencies: ["@ast-grep/cli", "custom-cli"],
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      // Result is identical to what's already there, so skipped
      expect(_result.action).toBe("skipped");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual([
        "@ast-grep/cli",
        "custom-cli",
      ]);
    });

    it("creates array if key missing from project", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: ["@ast-grep/cli"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual(["@ast-grep/cli"]);
    });

    it("handles merge when project value is not an array", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          customField: ["item1"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        customField: "not-an-array",
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.customField).toEqual(["item1"]);
    });
  });

  describe("inheritance and type hierarchy", () => {
    it("merges templates from all types in inheritance chain", async () => {
      // Setup all → typescript → expo hierarchy
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { lint: "eslint ." },
        },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { typecheck: "tsc --noEmit" },
          devDependencies: { typescript: "^5.0.0" },
        },
      });

      await createPackageLisaTemplate("expo", {
        force: {
          scripts: { start: "expo start" },
        },
      });

      // Create Expo + TypeScript project
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createExpoProject(projectDir);
      // Also create tsconfig.json to make it a TypeScript project
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.lint).toBe("eslint .");
      expect(content.scripts.typecheck).toBe("tsc --noEmit");
      expect(content.scripts.start).toBe("expo start");
      expect(content.devDependencies.typescript).toBe("^5.0.0");
    });

    it("child type overrides parent type in same section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { build: "all-build" },
        },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { build: "typescript-build" },
        },
      });

      // Create TypeScript project
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe("typescript-build");
    });

    it("CDK type overrides typescript type values", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { lint: "eslint ." },
        },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { build: "tsc" },
        },
      });

      await createPackageLisaTemplate("cdk", {
        force: {
          scripts: { build: "tsc --noEmit" },
        },
      });

      // Create CDK project (which inherits from typescript)
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createCDKProject(projectDir);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // CDK should override typescript's build script
      expect(content.scripts.build).toBe("tsc --noEmit");
      // All's lint script should still be applied
      expect(content.scripts.lint).toBe("eslint .");
    });
  });

  describe("empty sections", () => {
    it("handles template with empty force section", async () => {
      await createPackageLisaTemplate("all", {
        force: {},
        defaults: { engines: { node: "22.x" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.name).toBe("my-project");
      expect(content.engines).toEqual({ node: "22.x" });
    });

    it("handles template with missing sections", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.test).toBe("jest");
    });
  });

  describe("nested object merging", () => {
    it("deeply merges nested objects in force section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest", lint: "eslint ." },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        scripts: { build: "tsc", test: "mocha" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts).toEqual({
        test: "jest", // Force value wins
        lint: "eslint .",
        build: "tsc", // Project value preserved
      });
    });
  });

  describe("dry-run mode", () => {
    it("respects dry-run and doesn't modify files", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      const originalContent = { name: "original" };
      await fs.writeJson(destPath, originalContent);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext({ dryRun: true })
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content).toEqual(originalContent);
    });
  });

  describe("idempotency", () => {
    it("returns skipped when no changes needed", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        scripts: { test: "jest" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("skipped");
    });
  });

  describe("error handling", () => {
    it("applies template when project package.json doesn't exist", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { test: "jest" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      // Don't create destPath; let strategy create it

      const context = createContext();
      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        context
      );

      expect(_result.action).toBe("copied");
      const content = await fs.readJson(destPath);
      expect(content.scripts.test).toBe("jest");
    });
  });

  describe("project type detection", () => {
    it("detects TypeScript project and applies typescript template", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { lint: "eslint ." } },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          devDependencies: { typescript: "^5.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.devDependencies.typescript).toBe("^5.0.0");
    });

    it("detects NestJS project and applies all necessary templates", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { lint: "eslint ." } },
      });

      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { typescript: "^5.0.0" } },
      });

      await createPackageLisaTemplate("nestjs", {
        force: { devDependencies: { "@nestjs/core": "^10.0.0" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createNestJSProject(projectDir);
      // Also create tsconfig.json to make it a TypeScript project
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.devDependencies.typescript).toBe("^5.0.0");
      expect(content.devDependencies["@nestjs/core"]).toBe("^10.0.0");
    });
  });

  describe("manifest recording", () => {
    it("records file in manifest when applied", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { test: "jest" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {});

      const recordedFiles: Array<[string, string]> = [];
      const context: StrategyContext = {
        ...createContext(),
        recordFile: (relativePath: string, strategy: string) => {
          recordedFiles.push([relativePath, strategy]);
        },
      };

      await strategy.apply(sourcePath, destPath, "package.json", context);

      expect(recordedFiles).toContainEqual(["package.json", "package-lisa"]);
    });
  });
});
/* eslint-enable max-lines -- Re-enable after comprehensive test file */
/* eslint-enable sonarjs/no-duplicate-string -- Re-enable after test file */
/* eslint-enable sonarjs/no-unused-collection -- Re-enable after test file */
