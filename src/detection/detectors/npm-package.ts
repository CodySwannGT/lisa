import * as path from "node:path";
import type { IProjectTypeDetector } from "../detector.interface.js";
import { readJsonOrNull } from "../../utils/index.js";

/**
 * Package.json structure for npm package detection
 */
interface PackageJson {
  private?: boolean;
  main?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  files?: string[];
}

/**
 * Detector for npm packages (publishable to npm registry)
 *
 * Detects by presence of package.json that:
 * - Is NOT marked as private
 * - Has at least one of: main, bin, exports, or files fields
 */
export class NpmPackageDetector implements IProjectTypeDetector {
  readonly type = "npm-package" as const;

  /**
   * Detect if the project is an npm package
   *
   * @param destDir - Project directory to check
   * @returns True if npm package is detected
   */
  async detect(destDir: string): Promise<boolean> {
    const packageJsonPath = path.join(destDir, "package.json");
    const packageJson = await readJsonOrNull<PackageJson>(packageJsonPath);

    if (!packageJson) {
      return false;
    }

    // Private packages are not meant to be published
    if (packageJson.private === true) {
      return false;
    }

    // Must have at least one field indicating it's a publishable package
    const hasMain = packageJson.main !== undefined;
    const hasBin = packageJson.bin !== undefined;
    const hasExports = packageJson.exports !== undefined;
    const hasFiles =
      packageJson.files !== undefined && packageJson.files.length > 0;

    return hasMain || hasBin || hasExports || hasFiles;
  }
}
