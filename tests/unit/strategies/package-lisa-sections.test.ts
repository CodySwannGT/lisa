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
} from "./package-lisa-fixtures.js";

/** The postinstall command a Lisa template ships. */
const LISA_POSTINSTALL =
  "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true";

/** A trusted dependency Lisa contributes. */
const AST_GREP_CLI = "@ast-grep/cli";

/** A trusted dependency the host contributes. */
const CUSTOM_CLI = "custom-cli";

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
      expect(content.engines).toEqual({ node: "22.x" });
    });

    it("applies default postinstall when project has no postinstall", async () => {
      await createPackageLisaTemplate("typescript", {
        defaults: {
          scripts: {
            build: "tsc",
            postinstall: LISA_POSTINSTALL,
          },
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

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      expect(content.scripts.postinstall).toBe(LISA_POSTINSTALL);
    });

    it("does not override existing postinstall with default", async () => {
      await createPackageLisaTemplate("typescript", {
        defaults: {
          scripts: {
            build: "tsc",
            postinstall: LISA_POSTINSTALL,
          },
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
        name: MY_PROJECT,
        scripts: { postinstall: "patch-package" },
      });

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      expect(content.scripts.postinstall).toBe("patch-package");
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, {
        name: MY_PROJECT,
        engines: { node: "20.x", bun: "1.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
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
          trustedDependencies: [AST_GREP_CLI, "@sentry/cli"],
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
        trustedDependencies: [CUSTOM_CLI],
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual([
        AST_GREP_CLI,
        "@sentry/cli",
        CUSTOM_CLI,
      ]);
    });

    it("deduplicates identical values in merge arrays", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: [AST_GREP_CLI],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      // Project already has the Lisa item plus custom item
      await fs.writeJson(destPath, {
        trustedDependencies: [AST_GREP_CLI, CUSTOM_CLI],
        devDependencies: LISA_PIN,
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      // Result is identical to what's already there, so skipped
      expect(_result.action).toBe("skipped");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual([AST_GREP_CLI, CUSTOM_CLI]);
    });

    it("creates array if key missing from project", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: [AST_GREP_CLI],
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
      expect(content.trustedDependencies).toEqual([AST_GREP_CLI]);
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, {
        customField: "not-an-array",
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.customField).toEqual(["item1"]);
    });
  });
});
