import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createExpoProject,
} from "../../helpers/test-utils.js";
import { describe, expect, it } from "vitest";
import {
  APPLYING_VERSION,
  buildStrategyContext,
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

  describe("Expo real template: dual SDK 54/57 support", () => {
    // Regression: the Expo package.lisa.json used to hard-pin the entire
    // SDK-coupled dependency set (expo, react, react-native, every expo-*,
    // jest-expo, the react-native-* runtime libs, @sentry/react-native, etc.)
    // in `force`. Because force REPLACES project values, updating Lisa on an
    // Expo SDK 54 app force-bundled a full SDK 54->56 + RN 0.81->0.85 major
    // upgrade (blocked acmeorga/frontend, acmeorgd/frontend, expostarter).
    // The fix moves the SDK-version-coupled packages to `defaults` (project
    // value wins; Lisa is only a fallback for fresh projects), while pure
    // tooling stays in `force`. These tests load the REAL template
    // (lisaDir = repo root) so the placement can never drift back.
    const repoRoot = process.cwd();
    const expoSource = path.join(
      repoRoot,
      "expo",
      PACKAGE_LISA_DIR,
      PACKAGE_LISA_JSON
    );
    const maestroSupervision =
      "node scripts/lib/worktree-dependencies.mjs && lisa-test-run --profile expo --adapter direct -- ";
    const expectedMaestroScripts = {
      "maestro:test": `${maestroSupervision}maestro test .maestro/flows`,
      "maestro:test:ios": `${maestroSupervision}maestro test -p ios .maestro/flows`,
      "maestro:test:android": `${maestroSupervision}maestro test -p android .maestro/flows`,
      "maestro:test:smoke": `${maestroSupervision}maestro test -p ios --include-tags=smoke .maestro/flows`,
    } as const;

    /**
     * Read and parse the real shipped Expo package.lisa.json template.
     * @returns The parsed template with force/defaults sections.
     */
    function readExpoTemplate(): {
      force: {
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        resolutions: Record<string, string>;
        overrides: Record<string, string>;
      };
      defaults: {
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
    } {
      return fs.readJsonSync(expoSource);
    }

    it("defaults each platform-specific Maestro command to its intended device type", () => {
      const template = readExpoTemplate();

      expect(template.defaults.scripts).toMatchObject(expectedMaestroScripts);
    });

    it("repairs the fast-xml-parser advisory floor during full and postinstall applies", async () => {
      const vulnerableFloor = "^5.3.6";
      const patchedFloor = "^5.10.1";
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createExpoProject(projectDir);
      await fs.writeJson(destPath, {
        name: "expo-security-fixture",
        dependencies: { expo: "~57.0.0" },
        resolutions: { "fast-xml-parser": vulnerableFloor },
        overrides: { "fast-xml-parser": vulnerableFloor },
      });

      await strategy.apply(
        expoSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      let content = await fs.readJson(destPath);
      expect(content.resolutions["fast-xml-parser"]).toBe(patchedFloor);
      expect(content.overrides["fast-xml-parser"]).toBe(patchedFloor);

      await fs.writeJson(destPath, {
        ...content,
        resolutions: { "fast-xml-parser": vulnerableFloor },
        overrides: { "fast-xml-parser": vulnerableFloor },
      });
      await strategy.apply(
        expoSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot, skipGitCheck: true })
      );

      content = await fs.readJson(destPath);
      expect(content.resolutions["fast-xml-parser"]).toBe(patchedFloor);
      expect(content.overrides["fast-xml-parser"]).toBe(patchedFloor);
    });

    it("preserves host-customized Maestro commands when applying the Expo template", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, PACKAGE_JSON);
      const hostMaestroScripts = {
        "maestro:test": "maestro test custom-flows",
        "maestro:test:ios": "maestro test .maestro/flows",
        "maestro:test:android": "maestro test .maestro/flows",
        "maestro:test:smoke":
          "maestro test --include-tags=smoke .maestro/flows",
      };
      await fs.writeJson(destPath, {
        dependencies: {},
        devDependencies: {},
        scripts: hostMaestroScripts,
      });

      await strategy.apply(
        expoSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts).toMatchObject(hostMaestroScripts);
    });

    it("keeps SDK-version-coupled packages in defaults, not force", () => {
      const template = readExpoTemplate();
      const sdkCoupled = [
        "expo",
        "react",
        "react-dom",
        "react-native",
        "expo-router",
        "expo-updates",
        "react-native-reanimated",
        "react-native-screens",
      ];
      for (const pkg of sdkCoupled) {
        expect(template.defaults.dependencies[pkg]).toBeDefined();
        expect(template.force.dependencies[pkg]).toBeUndefined();
      }
      // Every expo-* runtime package must be a default, never forced.
      for (const pkg of Object.keys(template.defaults.dependencies)) {
        if (pkg.startsWith("expo")) {
          expect(template.force.dependencies[pkg]).toBeUndefined();
        }
      }
      // SDK-coupled jest-expo stays a default (never forced).
      expect(template.defaults.devDependencies["jest-expo"]).toBeDefined();
      expect(template.force.devDependencies["jest-expo"]).toBeUndefined();
      // react-test-renderer must NOT be pinned by Lisa at all. @testing-library/
      // react-native v13 requires react-test-renderer to match the project's
      // installed React exactly, and jest-expo already brings the matched version
      // transitively (54 → 19.1.0, 56 → 19.2.3). A hardcoded default (e.g. 19.2.3)
      // would override jest-expo's 19.1.0 on an SDK-54 project and break its test
      // suite with "Expected 19.1.0, but found 19.2.3".
      expect(
        template.defaults.devDependencies["react-test-renderer"]
      ).toBeUndefined();
      expect(
        template.force.devDependencies["react-test-renderer"]
      ).toBeUndefined();
    });
  });
});
