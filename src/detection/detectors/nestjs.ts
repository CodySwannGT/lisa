import * as path from "node:path";
import type { IProjectTypeDetector } from "../detector.interface.js";
import { pathExists, readJsonOrNull } from "../../utils/index.js";

/**
 * Package.json structure for dependency checking
 */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Check if any key in an object starts with a prefix
 * @param obj Object to check
 * @param prefix Prefix to search for
 * @returns True if any key starts with prefix
 */
function hasKeyStartingWith(
  obj: Record<string, unknown> | undefined,
  prefix: string
): boolean {
  if (!obj) {
    return false;
  }
  return Object.keys(obj).some(key => key.startsWith(prefix));
}

/**
 * Detector for NestJS projects
 * Detects by presence of nest-cli.json or \@nestjs/* dependencies
 */
export class NestJSDetector implements IProjectTypeDetector {
  readonly type = "nestjs" as const;

  /**
   * Detect if the project uses NestJS
   * @param destDir - Project directory to check
   * @returns True if NestJS is detected
   */
  async detect(destDir: string): Promise<boolean> {
    // Check for nest-cli.json
    const nestCliPath = path.join(destDir, "nest-cli.json");
    if (await pathExists(nestCliPath)) {
      return true;
    }

    // Check for @nestjs/* in package.json
    const packageJsonPath = path.join(destDir, "package.json");
    const packageJson = await readJsonOrNull<PackageJson>(packageJsonPath);

    if (!packageJson) {
      return false;
    }

    return (
      hasKeyStartingWith(packageJson.dependencies, "@nestjs") ||
      hasKeyStartingWith(packageJson.devDependencies, "@nestjs")
    );
  }
}
