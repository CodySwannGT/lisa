import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { PROJECT_TYPE_HIERARCHY } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
  createExpoProject,
  createCDKProject,
  createHarperFabricProject,
} from "../../helpers/test-utils.js";
import { describe, expect, it } from "vitest";
import {
  APPLYING_VERSION,
  buildStrategyContext,
  writePackageLisaTemplate,
  PACKAGE_JSON,
  PACKAGE_LISA_DIR,
  PACKAGE_LISA_JSON,
} from "./package-lisa-fixtures.js";

/** A type-check command used as an inherited script value. */
const TSC_NO_EMIT = "tsc --noEmit";

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
          scripts: { typecheck: TSC_NO_EMIT },
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createExpoProject(projectDir);
      // Also create tsconfig.json to make it a TypeScript project
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.lint).toBe("eslint .");
      expect(content.scripts.typecheck).toBe(TSC_NO_EMIT);
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
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
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
          scripts: { build: TSC_NO_EMIT },
        },
      });

      // Create CDK project (which inherits from typescript)
      const sourcePath = path.join(
        lisaDir,
        "all",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createCDKProject(projectDir);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // CDK should override typescript's build script
      expect(content.scripts.build).toBe(TSC_NO_EMIT);
      // All's lint script should still be applied
      expect(content.scripts.lint).toBe("eslint .");
    });

    it("Harper/Fabric type overrides typescript type values", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { build: "tsc" },
        },
      });

      await createPackageLisaTemplate("harper-fabric", {
        force: {
          scripts: { build: "tsc && node dist/build/build.js" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createHarperFabricProject(projectDir);

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe("tsc && node dist/build/build.js");
    });
  });

  describe("TypeScript real template: security resolution floors", () => {
    // Governance: the typescript/package-lisa/package.lisa.json force blocks must
    // carry every security floor that package.json (root) carries. This test loads
    // the REAL template so drift can never silently creep back.
    const repoRoot = process.cwd();
    const tsSource = path.join(
      repoRoot,
      "typescript",
      PACKAGE_LISA_DIR,
      PACKAGE_LISA_JSON
    );

    /**
     * Read and parse the real shipped TypeScript package.lisa.json template.
     * @returns The parsed template with force section.
     */
    function readTsTemplate(): {
      force: {
        resolutions: Record<string, string>;
        overrides: Record<string, string>;
      };
    } {
      return fs.readJsonSync(tsSource);
    }

    it("includes lodash floor in force.resolutions to match root package.json governance", () => {
      const template = readTsTemplate();
      expect(template.force.resolutions["lodash"]).toBeDefined();
      expect(template.force.resolutions["lodash"]).toBe(">=4.18.1");
    });

    it("includes lodash floor in force.overrides to match root package.json governance", () => {
      const template = readTsTemplate();
      expect(template.force.overrides["lodash"]).toBeDefined();
      expect(template.force.overrides["lodash"]).toBe(">=4.18.1");
    });

    it("keeps vite npm override compatible with the root direct dependency", () => {
      const rootPackageJson = fs.readJsonSync(
        path.join(repoRoot, PACKAGE_JSON)
      );
      const template = readTsTemplate();

      expect(template.force.resolutions["vite"]).toBe("^8.3.3");
      expect(template.force.overrides["vite"]).toBe(
        rootPackageJson.devDependencies.vite
      );
    });
  });

  describe("TypeScript real template: SI9 generative-testing tooling", () => {
    // Lisa asserts a criterion (SI9) that requires property-based testing with a
    // declared inventory of invariants. A governed project cannot satisfy an
    // obligation it has no tooling for, so the tooling is forced rather than
    // offered — the same reasoning that puts the Stryker mutation runner in
    // `force` beside it. Both exist to make a test suite honest rather than to
    // add a feature, which is what makes them governance-critical.
    //
    // `fast-check` is deliberately runner-agnostic in effect: unlike
    // @stryker-mutator/vitest-runner (which Expo has to strip in `remove` because
    // it runs Jest), it works under both runners, so inheriting it into every
    // TypeScript-descendant stack is correct rather than bleed.
    const repoRoot = process.cwd();

    /**
     * Read the real shipped TypeScript template's forced devDependencies.
     * @returns The parsed force.devDependencies map.
     */
    function readTsForcedDevDeps(): Record<string, string> {
      return fs.readJsonSync(
        path.join(repoRoot, "typescript", PACKAGE_LISA_DIR, PACKAGE_LISA_JSON)
      ).force.devDependencies;
    }

    it("forces fast-check rather than merely offering it as a default", () => {
      const template = fs.readJsonSync(
        path.join(repoRoot, "typescript", PACKAGE_LISA_DIR, PACKAGE_LISA_JSON)
      );

      expect(template.force.devDependencies["fast-check"]).toBeDefined();
      // A default would let a project silently not have it, which is exactly the
      // state SI9 cannot be satisfied from.
      expect(template.defaults.devDependencies?.["fast-check"]).toBeUndefined();
    });

    it("pins fast-check to the version Lisa itself runs", () => {
      const rootPackageJson = fs.readJsonSync(
        path.join(repoRoot, PACKAGE_JSON)
      );

      // Lisa's own property suite is the reference implementation of SI9 here.
      // If Lisa upgrades fast-check without moving the template, governed
      // projects run generative tests against a different library than the one
      // the pattern was proven on.
      expect(readTsForcedDevDeps()["fast-check"]).toBe(
        rootPackageJson.devDependencies["fast-check"]
      );
    });

    it("is stripped by no TypeScript-descendant stack", () => {
      // Not vacuous: Expo's remove list is non-empty and does strip the Vitest
      // mutation runner, so this asserts the de-inheritance mechanism was used
      // there and deliberately not used for fast-check.
      // The set under test is DERIVED from the hierarchy rather than hardcoded, so
      // a stack added later is checked automatically the moment it declares
      // `typescript` as its parent.
      const descendants = Object.entries(PROJECT_TYPE_HIERARCHY)
        .filter(([, parent]) => parent === "typescript")
        .map(([stack]) => stack);

      // The literal list is a tripwire, not the subject: it fails loudly when the
      // hierarchy gains or loses a TypeScript child, so that arrival is a decision
      // someone makes rather than something that happens quietly. `rails` is
      // deliberately absent — it has no `typescript` parent and no npm template.
      expect(new Set(descendants)).toEqual(
        new Set([
          "expo",
          "cdk",
          "nestjs",
          "phaser",
          "npm-package",
          "harper-fabric",
        ])
      );

      const removals = descendants.map(stack => ({
        stack,
        removed: (fs.readJsonSync(
          path.join(repoRoot, stack, PACKAGE_LISA_DIR, PACKAGE_LISA_JSON)
        ).remove?.devDependencies ?? []) as string[],
      }));

      expect(removals.some(entry => entry.removed.length > 0)).toBe(true);
      for (const entry of removals) {
        expect(entry.removed).not.toContain("fast-check");
      }
    });
  });
});
