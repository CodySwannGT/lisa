/**
 * Vitest Configuration - Harper/Fabric Stack
 *
 * Harper/Fabric projects keep source under src/ and tests under tests/.
 * @module configs/vitest/harper-fabric
 */
import type { ViteUserConfig } from "vitest/config";
import {
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
} from "./base.js";
import type { PortableThresholds } from "./base.js";

export {
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
};

export type { PortableThresholds };

/**
 * Options for configuring the Harper/Fabric Vitest config factory.
 */
interface HarperFabricVitestOptions {
  /** Coverage thresholds in portable format */
  readonly thresholds?: PortableThresholds;
}

/**
 * Creates a Vitest configuration for Harper/Fabric projects.
 * @param options - Configuration options
 * @param options.thresholds - Coverage thresholds
 * @returns Vitest UserConfig object
 */
export const getHarperFabricVitestConfig = ({
  thresholds,
}: HarperFabricVitestOptions = {}): ViteUserConfig => ({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...defaultTestExclusions],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        ...defaultCoverageExclusions,
        "src/types/**",
        "src/web/**/*.ts",
      ],
      thresholds: mapThresholds(
        thresholds
          ? mergeThresholds(defaultThresholds, thresholds)
          : defaultThresholds
      ),
    },
  },
});
