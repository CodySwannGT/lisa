import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createExpoProject,
  createHarperFabricProject,
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

  describe("remove behavior", () => {
    it("deletes retired keys from the named section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { "knip:check": "knip" },
        },
        remove: {
          scripts: ["knip"],
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
        scripts: { knip: "knip", start: "node index.js" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.knip).toBeUndefined(); // Retired key removed
      expect(content.scripts["knip:check"]).toBe("knip"); // Replacement forced
      expect(content.scripts.start).toBe("node index.js"); // Preserved
    });

    it("runs after force so a removed key cannot be reintroduced", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { retired: "should-not-survive" },
        },
        remove: {
          scripts: ["retired"],
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
      expect(content.scripts.retired).toBeUndefined();
    });

    it("leaves missing or non-object sections alone", async () => {
      await createPackageLisaTemplate("all", {
        remove: {
          scripts: ["knip"],
          missingSection: ["whatever"],
          arraySection: ["item"],
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
        arraySection: ["item", "other"],
        devDependencies: LISA_PIN,
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      // Nothing to remove → output equals input → strategy reports skipped
      expect(_result.action).toBe("skipped");
      const content = await fs.readJson(destPath);
      expect(content.name).toBe(MY_PROJECT);
      expect(content.scripts).toBeUndefined(); // Still absent, not created
      expect(content.missingSection).toBeUndefined();
      expect(content.arraySection).toEqual(["item", "other"]); // Untouched
    });

    it("concatenates remove lists across the inheritance chain", async () => {
      await createPackageLisaTemplate("typescript", {
        remove: {
          scripts: ["knip"],
        },
      });

      await createPackageLisaTemplate("expo", {
        remove: {
          scripts: ["legacy-expo-script"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createExpoProject(projectDir);
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});
      await fs.writeJson(destPath, {
        name: MY_PROJECT,
        scripts: {
          knip: "knip",
          "legacy-expo-script": "expo legacy",
          start: "expo start",
        },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.knip).toBeUndefined(); // Parent removal applied
      expect(content.scripts["legacy-expo-script"]).toBeUndefined(); // Child removal applied
      expect(content.scripts.start).toBe("expo start"); // Preserved
    });
  });

  describe("Harper/Fabric real template script paths", () => {
    // Regression for the advisory-rankings build break: Harper/Fabric projects
    // follow the TypeScript-family convention (tsconfig rootDir "src"), so tsc
    // strips the leading "src/" and emits to dist/<subdir>/*.js (e.g.
    // src/build/build.ts -> dist/build/build.js). The shipped package.lisa.json
    // "defaults" must match that emitted layout, NOT a "src"-prefixed dist/src/*
    // path, or a fresh project's `bun run build` fails with
    // "Cannot find module .../dist/src/build/build.js". These tests load the
    // REAL templates (lisaDir = repo root) so the defaults can never drift back.
    const repoRoot = process.cwd();
    const harperSource = path.join(
      repoRoot,
      "harper-fabric",
      PACKAGE_LISA_DIR,
      PACKAGE_LISA_JSON
    );

    it("fills a fresh project with dist/<subdir> build scripts, never dist/src/*", async () => {
      await createHarperFabricProject(projectDir);
      // A fresh Harper/Fabric project has no build-output-dependent scripts yet.
      await fs.writeJson(path.join(projectDir, PACKAGE_JSON), {
        private: true,
        dependencies: { harperdb: "^4.7.29" },
        devDependencies: { typescript: "^6.0.0" },
        scripts: {},
      });
      const destPath = path.join(projectDir, PACKAGE_JSON);

      await strategy.apply(
        harperSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe(
        "node scripts/lib/worktree-dependencies.mjs && tsc && node dist/build/build.js"
      );
      expect(content.scripts.seed).toBe(
        "bun run build && node dist/scripts/seed.js"
      );
      const srcPrefixed = Object.entries(
        content.scripts as Record<string, string>
      ).filter(([, value]) => value.includes("dist/src/"));
      expect(srcPrefixed).toEqual([]);
    });

    it("never clobbers a project's own build-output-dependent scripts (defaults semantics)", async () => {
      await createHarperFabricProject(projectDir);
      const destPath = path.join(projectDir, PACKAGE_JSON);
      // Project pins its own emit paths (e.g. a custom outDir layout).
      await fs.writeJson(destPath, {
        private: true,
        dependencies: { harperdb: "^4.7.29" },
        devDependencies: { typescript: "^6.0.0" },
        scripts: {
          build: "tsc && node dist/custom/build.js",
          seed: "bun run build && node dist/custom/seed.js",
        },
      });

      await strategy.apply(
        harperSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe("tsc && node dist/custom/build.js");
      expect(content.scripts.seed).toBe(
        "bun run build && node dist/custom/seed.js"
      );
    });
  });
});
