import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
  createNestJSProject,
} from "../../helpers/test-utils.js";
import { describe, expect, it } from "vitest";
import {
  APPLYING_VERSION,
  LISA_PIN,
  buildStrategyContext,
  writePackageLisaTemplate,
  PACKAGE_JSON,
  PACKAGE_LISA_DIR,
  PACKAGE_LISA_JSON,
  MY_PROJECT,
} from "./package-lisa-fixtures.js";

describe("PackageLisaStrategy", () => {
  let strategy: PackageLisaStrategy;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    strategy = new PackageLisaStrategy(() => APPLYING_VERSION);
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
    return buildStrategyContext(lisaDir, projectDir, overrides);
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
    await writePackageLisaTemplate(lisaDir, typeName, template);
  }

  describe("empty sections", () => {
    it("handles template with empty force section", async () => {
      await createPackageLisaTemplate("all", {
        force: {},
        defaults: { engines: { node: "22.x" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, { name: MY_PROJECT });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.name).toBe(MY_PROJECT);
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, { name: MY_PROJECT });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, {
        scripts: { build: "tsc", test: "mocha" },
      });

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      const originalContent = { name: "original" };
      await fs.writeJson(destPath, originalContent);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, {
        scripts: { test: "jest" },
        devDependencies: LISA_PIN,
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      // Don't create destPath; let strategy create it

      const context = createContext();
      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createNestJSProject(projectDir);
      // Also create tsconfig.json to make it a TypeScript project
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      expect(content.devDependencies.typescript).toBe("^5.0.0");
      expect(content.devDependencies["@nestjs/core"]).toBe("^10.0.0");
    });
  });
});
