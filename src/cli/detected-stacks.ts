/**
 * Bounded, no-follow stack detection for standards proof.
 *
 * Mirrors the detector registry's signals without invoking its unbounded
 * readers, so a project root cannot steer reads outside itself.
 * @module cli/detected-stacks
 */
import { realpath } from "node:fs/promises";
import { createDetectorRegistry } from "../detection/index.js";
import { CDK_APP_MARKER } from "../core/cdk-preset-adoption.js";
import type { ProjectType } from "../core/config.js";
import { projectPathKind, readProjectText } from "../health/read-only-fs.js";
import { isJsonObject } from "../sync/json-path.js";

const PACKAGE_JSON_RELATIVE = "package.json";
const HARPER_CONFIG_RELATIVE = "harper-app/config.yaml";
const MARKER_NAMES = [
  "tsconfig.json",
  "app.json",
  "eas.json",
  "nest-cli.json",
  CDK_APP_MARKER,
  HARPER_CONFIG_RELATIVE,
  "harper-app/schema.graphql",
  "bin/rails",
  "config/application.rb",
] as const;

/** Bounded filesystem evidence consumed by stack classification. */
type ConfinedDetectionSignals = {
  readonly packageJson: unknown;
  readonly dependencies: readonly string[];
  readonly markers: ReadonlySet<string>;
  readonly harperConfig: string | undefined;
};

/**
 * Return whether a confined regular marker file exists.
 * @param root - Canonical project root
 * @param relativePath - Project-relative marker path
 * @returns Whether the marker is a regular no-follow file
 */
async function confinedMarkerExists(
  root: string,
  relativePath: string
): Promise<boolean> {
  return (await projectPathKind(root, relativePath)) === "file";
}

/**
 * Return package dependency names from a validated object.
 * @param packageJson - Parsed package manifest
 * @returns Production and development dependency names
 */
function dependencyNames(packageJson: unknown): readonly string[] {
  if (!isJsonObject(packageJson)) return [];
  return [packageJson.dependencies, packageJson.devDependencies].flatMap(
    dependencies =>
      isJsonObject(dependencies) ? Object.keys(dependencies) : []
  );
}

/**
 * Return whether a parsed package manifest describes a publishable package.
 * @param packageJson - Parsed package manifest
 * @returns Whether the npm-package detector signal is present
 */
function isPublishablePackage(packageJson: unknown): boolean {
  return (
    isJsonObject(packageJson) &&
    packageJson.private !== true &&
    (packageJson.main !== undefined ||
      packageJson.bin !== undefined ||
      packageJson.exports !== undefined ||
      (Array.isArray(packageJson.files) && packageJson.files.length > 0))
  );
}

/**
 * Return detector results from confined filesystem signals.
 * @param signals - Bounded package, marker, and Harper evidence
 * @returns Direct detector matches before parent expansion
 */
function classifyDetectedTypes(
  signals: ConfinedDetectionSignals
): readonly ProjectType[] {
  const hasMarker = (name: string): boolean => signals.markers.has(name);
  const hasDependency = (name: string): boolean =>
    signals.dependencies.includes(name);
  const hasDependencyPrefix = (prefix: string): boolean =>
    signals.dependencies.some(name => name.startsWith(prefix));
  const harperConfigMatches =
    signals.harperConfig?.includes("graphqlSchema:") === true &&
    signals.harperConfig.includes("jsResource:") &&
    signals.harperConfig.includes("static:");
  return [
    hasMarker("tsconfig.json") || hasDependency("typescript")
      ? (["typescript"] as const)
      : [],
    isPublishablePackage(signals.packageJson) ? (["npm-package"] as const) : [],
    hasMarker(HARPER_CONFIG_RELATIVE) &&
    hasMarker("harper-app/schema.graphql") &&
    (harperConfigMatches || hasDependency("harperdb"))
      ? (["harper-fabric"] as const)
      : [],
    hasDependency("phaser") ? (["phaser"] as const) : [],
    hasMarker("app.json") || hasMarker("eas.json") || hasDependency("expo")
      ? (["expo"] as const)
      : [],
    hasMarker("nest-cli.json") || hasDependencyPrefix("@nestjs")
      ? (["nestjs"] as const)
      : [],
    hasMarker(CDK_APP_MARKER) ? (["cdk"] as const) : [],
    hasMarker("bin/rails") || hasMarker("config/application.rb")
      ? (["rails"] as const)
      : [],
  ].flat();
}

/**
 * Detect project stacks using only bounded, no-follow project reads.
 * This mirrors the authoritative detector signals without invoking their
 * legacy unbounded readers.
 * @param destDir - Project root
 * @returns Expanded types in canonical detector-registry order
 */
export async function readConfinedDetectedStacks(
  destDir: string
): Promise<readonly ProjectType[]> {
  const root = await realpath(destDir);
  const packageText = await readProjectText(root, PACKAGE_JSON_RELATIVE);
  const packageJson =
    packageText === undefined
      ? undefined
      : (JSON.parse(packageText) as unknown);
  const markerValues = await Promise.all(
    MARKER_NAMES.map(name => confinedMarkerExists(root, name))
  );
  const markers = new Set(
    MARKER_NAMES.filter((_name, index) => markerValues[index])
  );
  const harperConfig = markers.has(HARPER_CONFIG_RELATIVE)
    ? await readProjectText(root, HARPER_CONFIG_RELATIVE)
    : undefined;
  const detected = classifyDetectedTypes({
    packageJson,
    dependencies: dependencyNames(packageJson),
    markers,
    harperConfig,
  });
  return createDetectorRegistry().expandAndOrderTypes([...detected]);
}
