/**
 * @file package-lisa-detect.ts
 * @description Detects which project types a host is, so the package-lisa
 * strategy can resolve the matching template inheritance chain.
 * @module strategies
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as fse from "fs-extra";

import { CDK_APP_MARKER } from "../core/cdk-preset-adoption.js";
import type { ProjectType } from "../core/config.js";
import { readJsonOrNull } from "../utils/json-utils.js";

const PACKAGE_JSON = "package.json";
const TSCONFIG_JSON = "tsconfig.json";
const APP_JSON = "app.json";
const EAS_JSON = "eas.json";
const NEST_CLI_JSON = "nest-cli.json";
const HARPER_APP_CONFIG = path.join("harper-app", "config.yaml");
const HARPER_APP_SCHEMA = path.join("harper-app", "schema.graphql");

/** The dependency sections type detection reads from package.json. */
interface DependencySections {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Decides whether the project in a directory is one project type. */
type TypeProbe = (projectDir: string) => Promise<boolean>;

/**
 * Report whether a file exists relative to the project root.
 * @param projectDir - The project directory
 * @param relativePath - Path inside the project
 * @returns True when the path exists
 */
async function exists(
  projectDir: string,
  relativePath: string
): Promise<boolean> {
  return fse.pathExists(path.join(projectDir, relativePath));
}

/**
 * Check if package.json dependencies/devDependencies contain a specific package
 * @param projectDir - The project directory to check
 * @param packageName - The exact package name to check for (e.g., "typescript", "expo")
 * @returns True if the package is in dependencies or devDependencies, false otherwise
 */
async function packageJsonHasDependency(
  projectDir: string,
  packageName: string
): Promise<boolean> {
  const packageJson = await readJsonOrNull<DependencySections>(
    path.join(projectDir, PACKAGE_JSON)
  );
  if (!packageJson) return false;
  return (
    packageJson.dependencies?.[packageName] !== undefined ||
    packageJson.devDependencies?.[packageName] !== undefined
  );
}

/**
 * Check if package.json dependencies/devDependencies contain a package starting with prefix
 * @param projectDir - The project directory to check
 * @param prefix - The prefix to check for (e.g., "@nestjs", "aws-cdk")
 * @returns True if any dependency starts with the given prefix, false otherwise
 */
async function packageJsonHasDependencyPrefix(
  projectDir: string,
  prefix: string
): Promise<boolean> {
  const packageJson = await readJsonOrNull<DependencySections>(
    path.join(projectDir, PACKAGE_JSON)
  );
  if (!packageJson) return false;
  const deps = packageJson.dependencies ?? {};
  const devDeps = packageJson.devDependencies ?? {};
  return (
    Object.keys(deps).some(key => key.startsWith(prefix)) ||
    Object.keys(devDeps).some(key => key.startsWith(prefix))
  );
}

/**
 * Get a field value from package.json
 * @param projectDir - The project directory containing the package.json
 * @param fieldName - The field name to retrieve from package.json
 * @returns The field value if found, undefined if not found or if package.json doesn't exist
 */
async function packageJsonField(
  projectDir: string,
  fieldName: string
): Promise<unknown> {
  const packageJson = await readJsonOrNull<Record<string, unknown>>(
    path.join(projectDir, PACKAGE_JSON)
  );
  if (!packageJson) return undefined;
  return packageJson[fieldName];
}

/**
 * Check whether harper-app/config.yaml declares the expected Harper component
 * resource keys.
 * @param projectDir - The project directory to check
 * @returns True if the config has Harper/Fabric component signals
 */
async function harperConfigHasComponentSignals(
  projectDir: string
): Promise<boolean> {
  try {
    const content = await readFile(
      path.join(projectDir, HARPER_APP_CONFIG),
      "utf8"
    );
    return (
      content.includes("graphqlSchema:") &&
      content.includes("jsResource:") &&
      content.includes("static:")
    );
  } catch {
    return false;
  }
}

/**
 * TypeScript: a tsconfig.json or a `typescript` dependency.
 * @param projectDir - The project directory
 * @returns True for a TypeScript project
 */
async function isTypeScript(projectDir: string): Promise<boolean> {
  return (
    (await exists(projectDir, TSCONFIG_JSON)) ||
    (await packageJsonHasDependency(projectDir, "typescript"))
  );
}

/**
 * Expo: an app.json, an eas.json, or an `expo` dependency.
 * @param projectDir - The project directory
 * @returns True for an Expo project
 */
async function isExpo(projectDir: string): Promise<boolean> {
  return (
    (await exists(projectDir, APP_JSON)) ||
    (await exists(projectDir, EAS_JSON)) ||
    (await packageJsonHasDependency(projectDir, "expo"))
  );
}

/**
 * NestJS: a nest-cli.json or any `@nestjs` dependency.
 * @param projectDir - The project directory
 * @returns True for a NestJS project
 */
async function isNestJs(projectDir: string): Promise<boolean> {
  return (
    (await exists(projectDir, NEST_CLI_JSON)) ||
    (await packageJsonHasDependencyPrefix(projectDir, "@nestjs"))
  );
}

/**
 * CDK: cdk.json only. An `aws-cdk*` dependency means the project uses CDK
 * constructs, not that it is a CDK app with the preset's layout.
 * @param projectDir - The project directory
 * @returns True for a CDK app
 */
async function isCdk(projectDir: string): Promise<boolean> {
  return exists(projectDir, CDK_APP_MARKER);
}

/**
 * Harper/Fabric: the harper-app config and schema, plus either component
 * signals in the config or a `harperdb` dependency.
 * @param projectDir - The project directory
 * @returns True for a Harper/Fabric project
 */
async function isHarperFabric(projectDir: string): Promise<boolean> {
  return (
    (await exists(projectDir, HARPER_APP_CONFIG)) &&
    (await exists(projectDir, HARPER_APP_SCHEMA)) &&
    ((await harperConfigHasComponentSignals(projectDir)) ||
      (await packageJsonHasDependency(projectDir, "harperdb")))
  );
}

/**
 * Phaser: a `phaser` dependency.
 * @param projectDir - The project directory
 * @returns True for a Phaser project
 */
async function isPhaser(projectDir: string): Promise<boolean> {
  return packageJsonHasDependency(projectDir, "phaser");
}

/**
 * npm package: not private, and declares any field a published package uses.
 * @param projectDir - The project directory
 * @returns True for a publishable npm package
 */
async function isNpmPackage(projectDir: string): Promise<boolean> {
  const isPrivate = await packageJsonField(projectDir, "private");
  const hasPublishField =
    (await packageJsonField(projectDir, "main")) !== undefined ||
    (await packageJsonField(projectDir, "bin")) !== undefined ||
    (await packageJsonField(projectDir, "exports")) !== undefined ||
    (await packageJsonField(projectDir, "files")) !== undefined;
  return !isPrivate && hasPublishField;
}

/** Every probe, in the order detected types are reported. */
const TYPE_PROBES: readonly (readonly [ProjectType, TypeProbe])[] = [
  ["typescript", isTypeScript],
  ["expo", isExpo],
  ["nestjs", isNestJs],
  ["cdk", isCdk],
  ["harper-fabric", isHarperFabric],
  ["phaser", isPhaser],
  ["npm-package", isNpmPackage],
];

/**
 * Detect which project types apply to this project
 * (TypeScript, Expo, NestJS, CDK, Harper/Fabric, Phaser, npm-package).
 * Probes run one after another, in report order.
 * @param projectDir - Root directory of the project
 * @returns Array of detected project types
 */
export async function detectProjectTypes(
  projectDir: string
): Promise<ProjectType[]> {
  return TYPE_PROBES.reduce<Promise<ProjectType[]>>(
    async (pending, [type, probe]) => {
      const found = await pending;
      return (await probe(projectDir)) ? [...found, type] : found;
    },
    Promise.resolve([])
  );
}
