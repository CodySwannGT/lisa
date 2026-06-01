import {
  getExpoJestConfig,
  selectExpoJestResolver,
} from "../../../src/configs/jest/expo.js";
import { defaultThresholds } from "../../../src/configs/jest/base.js";

const SDK56_RESOLVER = "@react-native/jest-preset/jest/resolver.js";
const LEGACY_RESOLVER = "react-native/jest/resolver.js";

describe("jest.expo", () => {
  describe("getExpoJestConfig", () => {
    const config = getExpoJestConfig();

    it("does not use a preset", () => {
      expect(config).not.toHaveProperty("preset");
    });

    it("uses jsdom test environment", () => {
      expect(config.testEnvironment).toBe("jsdom");
    });

    it("configures haste for React Native platforms", () => {
      expect(config.haste).toEqual({
        defaultPlatform: "ios",
        platforms: ["android", "ios", "native"],
      });
    });

    it("uses a valid React Native resolver path for the installed SDK", () => {
      expect([SDK56_RESOLVER, LEGACY_RESOLVER]).toContain(config.resolver);
    });

    describe("selectExpoJestResolver (SDK-aware resolver selection)", () => {
      it("uses the SDK 56 resolver when @react-native/jest-preset is present", () => {
        const resolver = selectExpoJestResolver(
          specifier => specifier === SDK56_RESOLVER
        );
        expect(resolver).toBe(SDK56_RESOLVER);
      });

      it("falls back to the SDK 54 resolver when the preset is absent", () => {
        const resolver = selectExpoJestResolver(() => false);
        expect(resolver).toBe(LEGACY_RESOLVER);
      });

      it("only probes for the SDK 56 preset (not the legacy path)", () => {
        const probed: string[] = [];
        selectExpoJestResolver(specifier => {
          probed.push(specifier);
          return false;
        });
        expect(probed).toEqual([SDK56_RESOLVER]);
      });
    });

    it("registers base pre-setup file in setupFiles", () => {
      expect(config.setupFiles).toEqual(["<rootDir>/jest.setup.pre.js"]);
    });

    it("registers base setup file in setupFilesAfterEnv", () => {
      expect(config.setupFilesAfterEnv).toEqual(["<rootDir>/jest.setup.ts"]);
    });

    it("configures babel-jest transform for JS/TS files", () => {
      const transform = config.transform as Record<string, unknown>;

      expect(transform["\\.[jt]sx?$"]).toEqual([
        "babel-jest",
        {
          caller: {
            name: "metro",
            bundler: "metro",
            platform: "ios",
          },
        },
      ]);
    });

    it("configures asset file transformer for static assets", () => {
      const transform = config.transform as Record<string, unknown>;
      const assetPattern =
        "^.+\\.(bmp|gif|jpg|jpeg|mp4|png|psd|svg|webp|ttf|otf|woff|woff2)$";

      expect(transform[assetPattern]).toBe(
        "jest-expo/src/preset/assetFileTransformer.js"
      );
    });

    it("scopes collectCoverageFrom to Expo source directories", () => {
      const patterns = config.collectCoverageFrom as string[];
      const directoryPatterns = patterns.filter(p => !p.startsWith("!"));

      directoryPatterns.forEach(pattern => {
        expect(pattern).toMatch(
          /^(components|config|constants|features|hooks|lib|providers|shared|stores|types|utils)\//
        );
      });
    });

    it("does not include app directory in coverage inclusions", () => {
      const patterns = config.collectCoverageFrom as string[];
      const inclusionPatterns = patterns.filter(p => !p.startsWith("!"));

      expect(inclusionPatterns).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^app\//)])
      );
    });

    it("excludes View files from coverage", () => {
      const patterns = config.collectCoverageFrom as string[];

      expect(patterns).toContain("!**/*View.{ts,tsx}");
    });

    describe("sourceRoot option (Expo SDK 55+/56 /src convention)", () => {
      const srcPatterns = getExpoJestConfig({ sourceRoot: "src/" })
        .collectCoverageFrom as string[];

      it("prefixes positive coverage globs with the source root", () => {
        const inclusions = srcPatterns.filter(p => !p.startsWith("!"));
        expect(inclusions.length).toBeGreaterThan(0);
        inclusions.forEach(pattern => expect(pattern).toMatch(/^src\//));
      });

      it("keeps the View exclusion AFTER the positives (so they are not re-included)", () => {
        const lastPositive = srcPatterns.reduce(
          (acc, p, i) => (p.startsWith("!") ? acc : i),
          -1
        );
        expect(srcPatterns.indexOf("!**/*View.{ts,tsx}")).toBeGreaterThan(
          lastPositive
        );
      });

      it("defaults to root-anchored globs when sourceRoot is omitted", () => {
        const inclusions = (
          getExpoJestConfig().collectCoverageFrom as string[]
        ).filter(p => !p.startsWith("!"));
        expect(inclusions.some(p => p.startsWith("src/"))).toBe(false);
      });
    });

    it("does not include catch-all coverage glob", () => {
      const patterns = config.collectCoverageFrom as string[];

      expect(patterns).not.toContain("**/*.{ts,tsx}");
      expect(patterns).not.toContain("**/*.ts");
      expect(patterns).not.toContain("**/*.tsx");
    });

    it("excludes type definitions from coverage", () => {
      const patterns = config.collectCoverageFrom as string[];

      expect(patterns).toContain("!**/*.d.ts");
    });

    it("applies default thresholds when no overrides given", () => {
      expect(config.coverageThreshold).toEqual(defaultThresholds);
    });

    it("applies custom thresholds when overrides given", () => {
      const customThresholds = {
        global: {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90,
        },
      };
      const customConfig = getExpoJestConfig({
        thresholds: customThresholds,
      });

      expect(customConfig.coverageThreshold).toEqual(customThresholds);
    });
  });
});
