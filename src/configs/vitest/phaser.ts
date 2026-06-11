/**
 * Vitest Configuration - Phaser Stack
 *
 * Phaser projects keep pure game logic under src/ (tested without a browser)
 * and tests under tests/. The Vite/Phaser bootstrap and scene wiring are
 * excluded from coverage — they are verified by the Playwright smoke layer,
 * not unit tests (see the phaser-testing skill).
 * @module configs/vitest/phaser
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
 * Options for configuring the Phaser Vitest config factory.
 */
interface PhaserVitestOptions {
  /** Coverage thresholds in portable format */
  readonly thresholds?: PortableThresholds;
}

/**
 * Creates a Vitest configuration for Phaser projects.
 * @param options - Configuration options
 * @param options.thresholds - Coverage thresholds
 * @returns Vitest UserConfig object
 */
export const getPhaserVitestConfig = ({
  thresholds,
}: PhaserVitestOptions = {}): ViteUserConfig => ({
  test: {
    globals: true,
    environment: "node",
    // Repos with no test files must not fail the pre-push/CI gate; vitest exits 1
    // on "No test files found" otherwise. See typescript.ts for rationale.
    passWithNoTests: true,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    exclude: [...defaultTestExclusions, "tests/e2e/**"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        ...defaultCoverageExclusions,
        "src/types/**",
        "src/main.ts",
        "src/scenes/**",
        "src/entities/**",
        "src/vite-env.d.ts",
      ],
      thresholds: mapThresholds(
        thresholds
          ? mergeThresholds(defaultThresholds, thresholds)
          : defaultThresholds
      ),
    },
  },
});
