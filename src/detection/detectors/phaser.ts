import * as path from "node:path";
import type { IProjectTypeDetector } from "../detector.interface.js";
import { readJsonOrNull } from "../../utils/index.js";

/**
 * Package.json structure for dependency checking
 */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Detector for Phaser game projects
 * Detects by presence of the phaser dependency in package.json
 */
export class PhaserDetector implements IProjectTypeDetector {
  readonly type = "phaser" as const;

  /**
   * Detect if the project uses Phaser
   * @param destDir - Project directory to check
   * @returns True if Phaser is detected
   */
  async detect(destDir: string): Promise<boolean> {
    const packageJsonPath = path.join(destDir, "package.json");
    const packageJson = await readJsonOrNull<PackageJson>(packageJsonPath);

    if (!packageJson) {
      return false;
    }

    return (
      packageJson.dependencies?.["phaser"] !== undefined ||
      packageJson.devDependencies?.["phaser"] !== undefined
    );
  }
}
