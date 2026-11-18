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

    it("removes the inherited TypeScript Vitest mutation runner for Expo", () => {
      const template = readExpoTemplate() as ReturnType<
        typeof readExpoTemplate
      > & {
        remove: { devDependencies: string[] };
      };

      expect(
        template.force.devDependencies["@stryker-mutator/jest-runner"]
      ).toBeDefined();
      expect(
        template.force.devDependencies["@stryker-mutator/vitest-runner"]
      ).toBeUndefined();
      expect(template.remove.devDependencies).toContain(
        "@stryker-mutator/vitest-runner"
      );
    });

    it("keeps non-SDK-coupled tooling/governance in force", () => {
      const template = readExpoTemplate();
      // Pure JS tooling stays forced (governance-critical).
      expect(template.force.dependencies["@apollo/client"]).toBeDefined();
      // apollo-link-sentry must be pinned to EXACTLY 4.4.0 — it is the only
      // release that satisfies BOTH forced majors simultaneously:
      //   - @apollo/client v3 (forced): 4.5.0 bumped its peer to
      //     `@apollo/client@^4.0.10`, so any >=4.5.0 (incl. a `^4.0.0` range)
      //     makes SentryLink fail to typecheck against v3 (blocked expostarter).
      //   - @sentry/react-native ~7.x (Sentry v8 SDK): the 3.x line imports and
      //     calls `Sentry.configureScope`, which Sentry v8 REMOVED — so 3.3.0
      //     throws `(0, t.configureScope) is not a function` on EVERY GraphQL
      //     request at runtime (broke acmeorgb/frontend-v2 in dev and the
      //     prod path of expostarter/acmeorgd where the Sentry DSN is set).
      // 4.4.0 (Apollo v3 peer + Sentry v8 API) is the only compatible version,
      // so it is pinned exactly — a range re-opens one failure mode or the other.
      expect(template.force.dependencies["@apollo/client"]).toMatch(/^\^?3\./);
      expect(template.force.dependencies["apollo-link-sentry"]).toBe("4.4.0");
      expect(template.force.dependencies["zod"]).toBeDefined();
      // tailwindcss must stay in defaults, NEVER force: the tailwind major is
      // coupled to the project's gluestack-ui generation (v3/v4 → tailwind ^3 +
      // nativewind 4; v5 → tailwind ^4.2 + nativewind 5 per
      // https://gluestack.io/ui/docs/guides/more/upgrade-to-v5), and the fleet
      // runs both generations. A forced pin silently downgraded a tailwind-4
      // project (AcmeOrgD/frontend) on every apply and broke its frozen
      // lockfile in CI.
      expect(template.force.dependencies["tailwindcss"]).toBeUndefined();
      expect(template.defaults.dependencies["tailwindcss"]).toBeDefined();
      // @graphql-codegen/* must stay in defaults, NEVER force: the fleet is
      // split across codegen generations (backend-v2 on cli 6/typescript 4,
      // acmeorgd/acmeorgc/nestjsstarter on cli 7/typescript 6), and a forced
      // pin downgrades whichever side the template doesn't match. Frontends
      // can drift the same way, so the expo template gets the same treatment
      // as the nestjs one.
      for (const pkg of [
        "@graphql-codegen/cli",
        "@graphql-codegen/typescript",
        "@graphql-codegen/typescript-operations",
        "@graphql-codegen/typescript-react-apollo",
      ]) {
        expect(template.force.devDependencies[pkg]).toBeUndefined();
        expect(template.defaults.devDependencies[pkg]).toBeDefined();
      }
      expect(template.force.devDependencies["jest"]).toBeDefined();
      expect(template.force.devDependencies["oxlint"]).toBeDefined();
      expect(template.force.devDependencies["@playwright/test"]).toBeDefined();
      // Lint/test config deps must never leak into defaults.
      expect(template.defaults.dependencies["zod"]).toBeUndefined();
      expect(template.defaults.devDependencies["oxlint"]).toBeUndefined();
    });

    it("preserves an existing SDK 54 project's installed Expo/RN versions on update", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, PACKAGE_JSON);
      // An app already on Expo SDK 54 / RN 0.81.
      await fs.writeJson(destPath, {
        dependencies: {
          expo: "~54.0.0",
          react: "19.1.0",
          "react-native": "0.81.4",
          "expo-router": "~54.0.0",
          "react-native-reanimated": "~3.16.0",
        },
        devDependencies: {
          "jest-expo": "~54.0.0",
        },
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      // The project stays on SDK 54 — Lisa must NOT force-bump it to 56.
      expect(content.dependencies.expo).toBe("~54.0.0");
      expect(content.dependencies.react).toBe("19.1.0");
      expect(content.dependencies["react-native"]).toBe("0.81.4");
      expect(content.dependencies["expo-router"]).toBe("~54.0.0");
      expect(content.dependencies["react-native-reanimated"]).toBe("~3.16.0");
      expect(content.devDependencies["jest-expo"]).toBe("~54.0.0");
    });

    it("gives a fresh project the default SDK 57 versions", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, PACKAGE_JSON);
      // A fresh project that does not yet pin the SDK-coupled packages.
      await fs.writeJson(destPath, {
        dependencies: {},
        devDependencies: {},
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      // Fresh projects get the sensible SDK 57 default.
      expect(content.dependencies.expo).toBe("~57.0.0");
      expect(content.dependencies.react).toBe("19.2.3");
      expect(content.dependencies["react-native"]).toBe("0.86.0");
      expect(content.devDependencies["jest-expo"]).toBe("~57.0.1");
    });

    it("still force-applies tooling versions even when the project pins older ones", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, PACKAGE_JSON);
      // Project tries to pin an older governance-critical tooling version.
      await fs.writeJson(destPath, {
        dependencies: { zod: "^3.0.0" },
        devDependencies: { oxlint: "^1.0.0" },
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      // Forced tooling wins over the project's pin.
      expect(content.dependencies.zod).toBe("^4.6.6");
      expect(content.devDependencies.oxlint).toBe(">=1.62.0 <1.86.0");
    });

    it("removes the inherited Vitest mutation runner from Expo projects", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, {
        dependencies: { expo: "~56.0.0" },
        devDependencies: {
          "@stryker-mutator/vitest-runner": "^9.0.0",
        },
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        PACKAGE_JSON,
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(
        content.devDependencies["@stryker-mutator/vitest-runner"]
      ).toBeUndefined();
      expect(content.devDependencies["@stryker-mutator/jest-runner"]).toBe(
        "^9.0.0"
      );
      // jest-runner 9.x peers core 9.x exactly; the TypeScript parent forces
      // core ^10.1.1 for Vitest 5, so Expo's override must keep the pair matched.
      expect(content.devDependencies["@stryker-mutator/core"]).toBe("^9.0.0");
    });
  });
});
