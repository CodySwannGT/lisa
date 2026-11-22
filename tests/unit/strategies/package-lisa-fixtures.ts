import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../../src/core/config.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";

/**
 * The version these cases apply AS. Stated outright rather than read from the
 * repository, so an expectation never derives itself from the code under test.
 * Since #2953 every unrestricted apply pins `@codyswann/lisa` to the version
 * doing the applying, because the templates it writes call into that package.
 */
export const APPLYING_VERSION = "9.9.9";

/** The pin an unrestricted apply leaves behind. */
export const LISA_PIN = { "@codyswann/lisa": APPLYING_VERSION } as const;

/**
 * Create a strategy context for testing
 * @param lisaDir - The Lisa source directory holding the templates
 * @param projectDir - The destination project directory
 * @param overrides - Configuration overrides for this test case
 * @returns StrategyContext with mocked callbacks
 */
export function buildStrategyContext(
  lisaDir: string,
  projectDir: string,
  overrides: Partial<LisaConfig> = {}
): StrategyContext {
  const config: LisaConfig = {
    lisaDir,
    destDir: projectDir,
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

/**
 * Create package.lisa.json template in Lisa directory
 * @param lisaDir - The Lisa source directory holding the templates
 * @param typeName - The project type (e.g., "all", "typescript", "expo")
 * @param template - The package.lisa.json template object with force/defaults/merge sections
 * @returns Promise resolving when template is created
 */
export async function writePackageLisaTemplate(
  lisaDir: string,
  typeName: string,
  template: object
): Promise<void> {
  const dir = path.join(lisaDir, typeName, "package-lisa");
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "package.lisa.json"), template);
}

/** The host manifest every case writes and reads back. */
export const PACKAGE_JSON = "package.json";

/** The per-stack template directory holding `package.lisa.json`. */
export const PACKAGE_LISA_DIR = "package-lisa";

/** The governance template file Lisa reads from each stack directory. */
export const PACKAGE_LISA_JSON = "package.lisa.json";

/** A host project name used where the name itself is not under test. */
export const MY_PROJECT = "my-project";

/** A host project name used by the dependency-floor cases. */
export const HOST_PROJECT = "host-project";
