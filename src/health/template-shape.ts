/**
 * Detect a host project's stack types using only confined, bounded reads.
 * @module health/template-shape
 */
import path from "node:path";

import { CDK_APP_MARKER } from "../core/cdk-preset-adoption.js";
import {
  PROJECT_TYPE_HIERARCHY,
  PROJECT_TYPE_ORDER,
  type ProjectType,
} from "../core/config.js";
import {
  projectPathKind,
  readProjectJsonObject,
  readProjectText,
} from "./read-only-fs.js";

const HARPER_APP = "harper-app";

/** Safely-detected project shape reused by health probes. */
export interface HealthProjectShape {
  readonly types: readonly ProjectType[];
  readonly packageJson: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Read a safe file signal, rejecting unsafe path types.
 * @param root - Canonical host project root
 * @param relativePath - Project-relative path
 * @returns Whether the signal file exists
 */
async function fileSignal(
  root: string,
  relativePath: string
): Promise<boolean> {
  const kind = await projectPathKind(root, relativePath);
  if (kind === "directory") throw new Error("Project signal is not a file");
  return kind === "file";
}

/**
 * Return dependency maps from a safe package document.
 * @param packageJson - Safely captured package document
 * @returns Dependency and devDependency names
 */
function dependencyNames(
  packageJson: Readonly<Record<string, unknown>> | undefined
): readonly string[] {
  if (packageJson === undefined) return [];
  return ["dependencies", "devDependencies"].flatMap(field => {
    const value = packageJson[field];
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
      : [];
  });
}

/**
 * Expand detected types using Lisa's canonical hierarchy and ordering.
 * @param types - Detected project stack types
 * @returns The types with their parents, in canonical order
 */
function expandTypes(types: ReadonlySet<ProjectType>): readonly ProjectType[] {
  const expanded = new Set([
    ...types,
    ...[...types].flatMap(type => {
      const parent = PROJECT_TYPE_HIERARCHY[type];
      return parent === undefined ? [] : [parent];
    }),
  ]);
  return PROJECT_TYPE_ORDER.filter(type => expanded.has(type));
}

/**
 * Decide whether the project is a Harper Fabric app.
 * @param projectRoot - Canonical host project root
 * @param hasConfig - Whether `harper-app/config.yaml` exists
 * @param hasSchema - Whether `harper-app/schema.graphql` exists
 * @param hasHarperDependency - Whether `harperdb` is a dependency
 * @returns True when both files exist and the config or dependencies say Harper
 */
async function isHarperApp(
  projectRoot: string,
  hasConfig: boolean,
  hasSchema: boolean,
  hasHarperDependency: () => boolean
): Promise<boolean> {
  const harperText = hasConfig
    ? await readProjectText(projectRoot, path.join(HARPER_APP, "config.yaml"))
    : undefined;
  const harperSignals =
    harperText?.includes("graphqlSchema:") === true &&
    harperText.includes("jsResource:") &&
    harperText.includes("static:");
  return hasConfig && hasSchema && (harperSignals || hasHarperDependency());
}

/**
 * Decide whether package.json describes a publishable package.
 * @param packageJson - Safely captured package document
 * @returns True for a non-private package that declares an entry or files
 */
function isPublishable(
  packageJson: Readonly<Record<string, unknown>> | undefined
): boolean {
  return (
    packageJson !== undefined &&
    packageJson.private !== true &&
    ["main", "bin", "exports", "files"].some(field =>
      Object.hasOwn(packageJson, field)
    )
  );
}

/**
 * Detect project types using only confined, bounded project reads.
 * @param projectRoot - Canonical host project root
 * @returns Safe project shape
 */
export async function detectHealthProjectShape(
  projectRoot: string
): Promise<HealthProjectShape> {
  const packageJson = await readProjectJsonObject(projectRoot, "package.json");
  const dependencies = dependencyNames(packageJson);
  const hasDependency = (name: string): boolean => dependencies.includes(name);
  const hasPrefix = (prefix: string): boolean =>
    dependencies.some(name => name.startsWith(prefix));
  const [
    tsconfig,
    app,
    eas,
    nest,
    cdk,
    railsBin,
    railsApp,
    harperConfig,
    harperSchema,
  ] = await Promise.all([
    fileSignal(projectRoot, "tsconfig.json"),
    fileSignal(projectRoot, "app.json"),
    fileSignal(projectRoot, "eas.json"),
    fileSignal(projectRoot, "nest-cli.json"),
    fileSignal(projectRoot, CDK_APP_MARKER),
    fileSignal(projectRoot, path.join("bin", "rails")),
    fileSignal(projectRoot, path.join("config", "application.rb")),
    fileSignal(projectRoot, path.join(HARPER_APP, "config.yaml")),
    fileSignal(projectRoot, path.join(HARPER_APP, "schema.graphql")),
  ]);
  const harper = await isHarperApp(
    projectRoot,
    harperConfig,
    harperSchema,
    () => hasDependency("harperdb")
  );
  const publishable = isPublishable(packageJson);
  const detected = new Set<ProjectType>([
    ...(tsconfig || hasDependency("typescript") ? ["typescript" as const] : []),
    ...(app || eas || hasDependency("expo") ? ["expo" as const] : []),
    ...(nest || hasPrefix("@nestjs") ? ["nestjs" as const] : []),
    ...(cdk ? ["cdk" as const] : []),
    ...(harper ? ["harper-fabric" as const] : []),
    ...(hasDependency("phaser") ? ["phaser" as const] : []),
    ...(publishable ? ["npm-package" as const] : []),
    ...(railsBin || railsApp ? ["rails" as const] : []),
  ]);
  return { types: expandTypes(detected), packageJson };
}

/**
 * Backward-compatible type-only detector surface.
 * @param projectRoot - Canonical host project root
 * @returns Detected project types
 */
export async function detectHealthProjectTypes(
  projectRoot: string
): Promise<readonly ProjectType[]> {
  return (await detectHealthProjectShape(projectRoot)).types;
}
