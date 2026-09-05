/**
 * Vitest Configuration - Harper/Fabric Stack
 *
 * Harper/Fabric projects keep source under src/ and tests under tests/.
 * @module configs/vitest/harper-fabric
 */
import type { ViteUserConfig } from "vitest/config";
import {
  coverageGlobalSetup,
  coverageReportsDirectory,
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
  resolveMaxWorkers,
  scratchGlobalSetup,
  scratchSetupFiles,
} from "./base.js";
import type { PortableThresholds } from "./base.js";

export {
  coverageGlobalSetup,
  coverageReportsDirectory,
  defaultCoverageExclusions,
  defaultTestExclusions,
  defaultThresholds,
  mapThresholds,
  mergeThresholds,
  mergeVitestConfigs,
  resolveMaxWorkers,
  scratchGlobalSetup,
  scratchSetupFiles,
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
    setupFiles: [...scratchSetupFiles()],
    globalSetup: [...scratchGlobalSetup(), ...coverageGlobalSetup()],
    sequence: { setupFiles: "list", hooks: "stack" },
    // Bounded so k concurrent runs do not claim k x cores. See resolveMaxWorkers.
    maxWorkers: resolveMaxWorkers(),
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...defaultTestExclusions],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      // Per-run, so a sibling run in this checkout cannot delete this
      // run's live scratch. See configs/vitest/coverage-reports-directory.
      reportsDirectory: coverageReportsDirectory(),
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
