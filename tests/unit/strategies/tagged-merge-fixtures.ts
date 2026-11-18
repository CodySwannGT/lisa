import type { LisaConfig } from "../../../src/core/config.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";

/** The JSON file every tagged-merge case writes as both source and destination. */
export const PACKAGE_JSON = "package.json";

/**
 * Create a strategy context for testing
 * @param srcDir - The Lisa source directory
 * @param destDir - The destination project directory
 * @param overrides Config overrides to apply
 * @returns Strategy context for test execution
 */
export function buildTaggedMergeContext(
  srcDir: string,
  destDir: string,
  overrides: Partial<LisaConfig> = {}
): StrategyContext {
  const config: LisaConfig = {
    lisaDir: srcDir,
    destDir,
    dryRun: false,
    yesMode: true,
    validateOnly: false,
    skipGitCheck: false,
    harness: "claude",
    ...overrides,
  };

  return {
    config,
    backupFile: async () => {},
    promptOverwrite: async () => true,
  };
}
