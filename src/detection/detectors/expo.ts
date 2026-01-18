import * as path from "node:path";
import type { IProjectTypeDetector } from "../detector.interface.js";
import { pathExists, readJsonOrNull } from "../../utils/index.js";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Detector for Expo (React Native) projects
 * Detects by presence of app.json, eas.json, or expo dependency
 */
export class ExpoDetector implements IProjectTypeDetector {
  readonly type = "expo" as const;

  async detect(destDir: string): Promise<boolean> {
    // Check for app.json
    const appJsonPath = path.join(destDir, "app.json");
    if (await pathExists(appJsonPath)) {
      return true;
    }

    // Check for eas.json
    const easJsonPath = path.join(destDir, "eas.json");
    if (await pathExists(easJsonPath)) {
      return true;
    }

    // Check for expo in package.json
    const packageJsonPath = path.join(destDir, "package.json");
    const packageJson = await readJsonOrNull<PackageJson>(packageJsonPath);

    if (!packageJson) {
      return false;
    }

    return (
      packageJson.dependencies?.["expo"] !== undefined ||
      packageJson.devDependencies?.["expo"] !== undefined
    );
  }
}
