/**
 * Live-status probe for the console Stacks section.
 *
 * Mirrors doctor's detection chain exactly so the console and `lisa doctor`
 * can never disagree. An empty match is the honest empty value (`[]`), never
 * unknown; the runner maps a thrown detector error to unknown.
 * @module cli/ui-detected-stacks
 */
import { realpath } from "node:fs/promises";
import {
  createDetectorRegistry,
  type DetectorRegistry,
} from "../detection/index.js";
import type { ProjectType } from "../core/config.js";
import { projectPathKind, readProjectText } from "../health/read-only-fs.js";
import { isJsonObject } from "../sync/json-path.js";
import type { StatusProbe } from "./ui-status.js";

/** Probe id for the detected-stacks live-status entry. */
export const DETECTED_STACKS_PROBE_ID = "detected-stacks";
const PACKAGE_JSON_RELATIVE = "package.json";
const HARPER_CONFIG_RELATIVE = "harper-app/config.yaml";
const MARKER_NAMES = [
  "tsconfig.json",
  "app.json",
  "eas.json",
  "nest-cli.json",
  "cdk.json",
  HARPER_CONFIG_RELATIVE,
  "harper-app/schema.graphql",
  "bin/rails",
  "config/application.rb",
] as const;

/** Bounded filesystem evidence consumed by setup stack classification. */
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
    hasMarker("cdk.json") || hasDependencyPrefix("aws-cdk")
      ? (["cdk"] as const)
      : [],
    hasMarker("bin/rails") || hasMarker("config/application.rb")
      ? (["rails"] as const)
      : [],
  ].flat();
}

/**
 * Detect setup-automation stacks using only bounded, no-follow project reads.
 * This mirrors the authoritative detector signals without invoking their
 * legacy unbounded readers on the setup-readiness request path.
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

/**
 * Create the probe that reports the project's detected stacks.
 * @param destDir - Project root scanned by the detector registry
 * @param registry - Injectable detector registry used by focused tests
 * @returns Probe emitting the expanded, ordered project types
 */
export function createDetectedStacksProbe(
  destDir: string,
  registry: DetectorRegistry = createDetectorRegistry()
): StatusProbe<string[]> {
  return {
    id: DETECTED_STACKS_PROBE_ID,
    timeoutMs: 5_000,
    run: async () => {
      const types = registry.expandAndOrderTypes(
        await registry.detectAll(destDir)
      );
      return { state: "value", value: [...types] };
    },
  };
}
