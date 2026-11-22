import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
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
  HOST_PROJECT,
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

  describe("basic properties", () => {
    it("has correct name", () => {
      expect(strategy.name).toBe(PACKAGE_LISA_DIR);
    });
  });

  describe("root package template verifier scripts", () => {
    it("preserves the learner frontmatter built verifier", () => {
      const repoRoot = process.cwd();
      const packageJson = fs.readJsonSync(path.join(repoRoot, PACKAGE_JSON));
      const packageTemplate = fs.readJsonSync(
        path.join(repoRoot, PACKAGE_LISA_JSON)
      );
      const scriptName = "verify:learner-frontmatter-built";

      expect(packageTemplate.force.scripts[scriptName]).toBe(
        packageJson.scripts[scriptName]
      );
      expect(packageTemplate.force.scripts[scriptName]).toBe(
        "bun run build:dist && node scripts/verify-learner-frontmatter-built.mjs"
      );
    });
  });

  describe("when source does not exist", () => {
    it("skips when package.lisa.json not found", async () => {
      const sourcePath = path.join(
        lisaDir,
        "all",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, {});

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("skipped");
      expect(_result.strategy).toBe(PACKAGE_LISA_DIR);
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      // In production, Lisa passes package.lisa.json as destPath
      // The strategy should translate this to package.json
      const destPath = path.join(projectDir, PACKAGE_LISA_JSON);
      const actualPackageJson = path.join(projectDir, PACKAGE_JSON);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_LISA_JSON,
        createContext()
      );

      expect(_result.action).toBe("copied");
      // Strategy should write to package.json, not package.lisa.json
      expect(_result.relativePath).toBe(PACKAGE_JSON);
      const content = await fs.readJson(actualPackageJson);
      expect(content).toEqual({
        scripts: { test: "jest" },
        devDependencies: LISA_PIN,
      });
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      // Lisa passes package.lisa.json as destPath, strategy translates to package.json
      const destPath = path.join(projectDir, PACKAGE_LISA_JSON);
      const actualPackageJson = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(actualPackageJson, {
        name: MY_PROJECT,
        scripts: { build: "rollup", start: "node index.js" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_LISA_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      expect(_result.relativePath).toBe(PACKAGE_JSON);
      const content = await fs.readJson(actualPackageJson);
      expect(content.scripts.test).toBe("jest");
      expect(content.scripts.build).toBe("tsc");
      expect(content.scripts.start).toBe("node index.js"); // Preserved
      expect(content.name).toBe(MY_PROJECT); // Preserved
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
      expect(content.devDependencies).toEqual({
        eslint: "^9.0.0",
        ...LISA_PIN,
      });
    });

    it("preserves existing package.json during postinstall-safe applies", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "vitest run" },
          devDependencies: { oxlint: "^1.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_LISA_JSON);
      const actualPackageJson = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(actualPackageJson, {
        name: HOST_PROJECT,
        scripts: { test: "host test" },
        devDependencies: { oxlint: "^0.1.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_LISA_JSON,
        createContext({ skipGitCheck: true, postinstall: true })
      );

      expect(_result.action).toBe("skipped");
      expect(await fs.readJson(actualPackageJson)).toEqual({
        name: HOST_PROJECT,
        scripts: { test: "host test" },
        devDependencies: { oxlint: "^0.1.0" },
      });
    });

    // Regression: under skip-git-check (the postinstall / lisa-update-projects
    // path), host scripts/devDependencies stay preserved BUT the security-
    // critical force.resolutions/force.overrides pins must still apply. Skipping
    // them entirely let transitive-CVE force-bumps (e.g. ws) never reach the
    // project, blocking the pre-push audit hook fleet-wide.
    it("applies force.resolutions/overrides but preserves host scripts/deps under postinstall-safe", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          resolutions: { ws: ">=8.21.0" },
          overrides: { ws: ">=8.21.0" },
          scripts: { test: "lisa test" },
          devDependencies: { oxlint: "^1.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: HOST_PROJECT,
        scripts: { test: "host test" },
        devDependencies: { oxlint: "^0.1.0" },
        resolutions: { ws: "^8.0.0", "other-pkg": "^1.0.0" },
        overrides: { ws: "^8.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext({ skipGitCheck: true, postinstall: true })
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // Security pins ARE forced even under skip-git-check
      expect(content.resolutions.ws).toBe(">=8.21.0");
      expect(content.overrides.ws).toBe(">=8.21.0");
      // Sibling entries in the same nested object are preserved
      expect(content.resolutions["other-pkg"]).toBe("^1.0.0");
      // Host scripts/devDependencies are NOT clobbered (preserve-host intent)
      expect(content.scripts.test).toBe("host test");
      expect(content.devDependencies.oxlint).toBe("^0.1.0");
    });

    it("keeps forced direct deps that back literal override normalization under postinstall-safe", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          overrides: { prettier: "3.8.3" },
          scripts: { test: "lisa test" },
          devDependencies: { prettier: "3.8.3", oxlint: "^1.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: HOST_PROJECT,
        scripts: { test: "host test" },
        devDependencies: { prettier: "^3.3.3", oxlint: "^0.1.0" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext({ skipGitCheck: true, postinstall: true })
      );

      expect(result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.overrides.prettier).toBe("$prettier");
      expect(content.devDependencies.prettier).toBe("3.8.3");
      expect(content.devDependencies.oxlint).toBe("^0.1.0");
      expect(content.scripts.test).toBe("host test");
    });
  });
});
