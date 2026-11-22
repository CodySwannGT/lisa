import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
  createCDKProject,
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

  // Regression (CDK fleet break, 4/4 repos): a force.overrides/resolutions
  // `$name` self-reference must be accompanied by the backing direct dependency,
  // otherwise the postinstall (skip-git-check) apply writes a dangling `$esbuild`
  // that passes local checks but fails `npm ci` in CI only. See the fleet ledger:
  // acmeorgc-infra #177, gemini infra-v2 #335, cdkstarter #13.
  describe("$name self-reference backing dependency", () => {
    it("materializes the forced devDependency backing a $ref under skip-git-check", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          overrides: { esbuild: "$esbuild" },
          resolutions: { esbuild: "$esbuild" },
          devDependencies: { esbuild: "^0.28.1" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      // A CDK project that has NO esbuild direct devDependency yet.
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext({ skipGitCheck: true })
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // BOTH the override AND the backing direct devDependency must be present.
      expect(content.overrides.esbuild).toBe("$esbuild");
      expect(content.resolutions.esbuild).toBe("$esbuild");
      expect(content.devDependencies.esbuild).toBe("^0.28.1");
      // Host devDependency untouched.
      expect(content.devDependencies.typescript).toBe("^5.0.0");
    });

    it("materializes the backing devDependency on a full (non-skip-git-check) apply", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          overrides: { esbuild: "$esbuild" },
          devDependencies: { esbuild: "^0.28.1" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides.esbuild).toBe("$esbuild");
      expect(content.devDependencies.esbuild).toBe("^0.28.1");
    });

    it("fails the apply when a $ref has no backing direct dependency", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          // $esbuild referenced but NO force.devDependencies.esbuild, and the
          // host has no esbuild direct dep either — a dangling $ref.
          overrides: { esbuild: "$esbuild" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext())
      ).rejects.toThrow(/Dangling \$esbuild/);
    });

    it("passes when the host already provides the $ref-backing direct dep", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          overrides: { esbuild: "$esbuild" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
        // Host already declares esbuild directly, so $esbuild resolves.
        devDependencies: { esbuild: "^0.25.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides.esbuild).toBe("$esbuild");
      expect(content.devDependencies.esbuild).toBe("^0.25.0");
    });
  });

  // Regression (acmeorgd frontend, fleet-wide): npm rejects a manifest with
  // EOVERRIDE when an overrides/resolutions key that is ALSO a direct dependency
  // carries a literal version instead of the "$name" self-reference. npm runs
  // that validation before anything else, so the broken manifest breaks every
  // `npx`/`npm` in the project dir — surfacing as e.g. a plugin MCP server dying
  // with "Failed to reconnect ... -32000". A security remediation that
  // force-bumped `prettier` in overrides while `prettier` stayed a direct
  // devDependency is the canonical trigger. Lisa's apply must normalize these to
  // the npm-valid "$name" form so the manifest self-heals on the next apply.
  describe("EOVERRIDE self-referencing override normalization", () => {
    it("rewrites a literal override to $name when the direct dep preserves the constraint", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      // Host: prettier is a direct devDep AND has a literal override (the
      // EOVERRIDE-invalid state a security fix left behind).
      await fs.writeJson(destPath, {
        name: "ts-host",
        devDependencies: { prettier: "3.8.3", typescript: "^5.0.0" },
        overrides: { prettier: "3.8.3", axios: ">=1.15.2" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      const content = await fs.readJson(destPath);
      // The colliding override is normalized to the self-reference...
      expect(content.overrides.prettier).toBe("$prettier");
      // ...the backing direct dep is preserved so the $ref resolves...
      expect(content.devDependencies.prettier).toBe("3.8.3");
      // ...and a transitive-only override (not a direct dep) is left literal.
      expect(content.overrides.axios).toBe(">=1.15.2");
      expect(result.note).toContain(
        'Normalized overrides.prettier: replaced literal "3.8.3" with "$prettier" resolving to direct dependency range "3.8.3".'
      );
    });

    it("normalizes a colliding resolutions entry as well", async () => {
      await createPackageLisaTemplate("typescript", {});

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { lodash: "4.17.21" },
        resolutions: { lodash: "4.17.21" },
      });

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      expect(content.resolutions.lodash).toBe("$lodash");
    });

    it("refuses to rewrite when $name would widen an exact override", async () => {
      await createPackageLisaTemplate("typescript", {});

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tailwindcss: "^3.4.7" },
        overrides: { tailwindcss: "3.4.19" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext())
      ).rejects.toThrow(
        'overrides.tailwindcss would widen if rewritten to "$tailwindcss"'
      );
    });

    it("leaves an existing $name reference and non-direct overrides untouched", async () => {
      await createPackageLisaTemplate("typescript", {});

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        devDependencies: { vite: "^8.0.0" },
        // vite already self-references (valid); ws is transitive-only (valid).
        overrides: { vite: "$vite", ws: ">=8.21.0" },
      });

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      expect(content.overrides.vite).toBe("$vite");
      expect(content.overrides.ws).toBe(">=8.21.0");
    });
  });
});
