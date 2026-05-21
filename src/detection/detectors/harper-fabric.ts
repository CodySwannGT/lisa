import * as path from "node:path";
import type { IProjectTypeDetector } from "../detector.interface.js";
import {
  pathExists,
  readFileOrNull,
  readJsonOrNull,
} from "../../utils/index.js";

/**
 * Package.json structure for Harper/Fabric dependency checking.
 */
interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Return true when package.json declares a Harper runtime dependency.
 * @param packageJson Parsed package.json content
 * @returns Whether package.json includes a Harper signal
 */
function hasHarperDependency(packageJson: PackageJson | null): boolean {
  if (!packageJson) {
    return false;
  }

  return (
    packageJson.dependencies?.harperdb !== undefined ||
    packageJson.devDependencies?.harperdb !== undefined
  );
}

/**
 * Return true when config.yaml contains component keys Lisa expects for
 * Harper/Fabric deployable apps.
 * @param configYaml Harper component config content
 * @returns Whether config contains Harper/Fabric component signals
 */
function hasHarperComponentConfig(configYaml: string | null): boolean {
  if (!configYaml) {
    return false;
  }

  return (
    configYaml.includes("graphqlSchema:") &&
    configYaml.includes("jsResource:") &&
    configYaml.includes("static:")
  );
}

/**
 * Detector for Harper/Fabric projects.
 *
 * A project must have the Harper deploy surface (`harper-app/config.yaml`
 * and `harper-app/schema.graphql`) plus either config keys or package deps
 * that distinguish it from an arbitrary directory with similarly named files.
 */
export class HarperFabricDetector implements IProjectTypeDetector {
  readonly type = "harper-fabric" as const;

  /**
   * Detect if the project is a Harper/Fabric component app.
   * @param destDir - Project directory to check
   * @returns True if Harper/Fabric is detected
   */
  async detect(destDir: string): Promise<boolean> {
    const configPath = path.join(destDir, "harper-app", "config.yaml");
    const schemaPath = path.join(destDir, "harper-app", "schema.graphql");

    if (!(await pathExists(configPath)) || !(await pathExists(schemaPath))) {
      return false;
    }

    const [configYaml, packageJson] = await Promise.all([
      readFileOrNull(configPath),
      readJsonOrNull<PackageJson>(path.join(destDir, "package.json")),
    ]);

    return (
      hasHarperComponentConfig(configYaml) || hasHarperDependency(packageJson)
    );
  }
}
