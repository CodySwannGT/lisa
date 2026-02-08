import { describe, it, expect } from "@jest/globals";
import { getExpoJestConfig } from "../../../expo/copy-overwrite/jest.expo.js";
import { defaultThresholds } from "../../../jest.base.js";

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

    it("uses React Native resolver", () => {
      expect(config.resolver).toBe("react-native/jest/resolver.js");
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
          /^(app|components|config|constants|features|hooks|lib|providers|shared|stores|types|utils)\//
        );
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
