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
 * Detector for AWS CDK projects
 * Detects by presence of cdk.json or aws-cdk* dependencies
 */
export class CDKDetector implements IProjectTypeDetector {
  readonly type = "cdk" as const;

  /**
   * Detect if the project uses AWS CDK
   *
   * @param destDir - Project directory to check
   * @returns True if AWS CDK is detected
   */
  async detect(destDir: string): Promise<boolean> {
    // Check for cdk.json
    const cdkJsonPath = path.join(destDir, "cdk.json");
    if (await pathExists(cdkJsonPath)) {
      return true;
    }

    // Check for aws-cdk* in package.json
    const packageJsonPath = path.join(destDir, "package.json");
    const packageJson = await readJsonOrNull<PackageJson>(packageJsonPath);

    if (!packageJson) {
      return false;
    }

    return (
      hasKeyStartingWith(packageJson.dependencies, "aws-cdk") ||
      hasKeyStartingWith(packageJson.devDependencies, "aws-cdk")
    );
  }
}
