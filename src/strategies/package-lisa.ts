import * as fse from "fs-extra";
import path from "node:path";
import type { FileOperationResult, ProjectType } from "../core/config.js";
import { PROJECT_TYPE_HIERARCHY } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { ensureParentDir } from "../utils/file-operations.js";
import {
  readJson,
  writeJson,
  deepMerge,
  readJsonOrNull,
} from "../utils/json-utils.js";
import { JsonMergeError } from "../errors/index.js";
import type {
  PackageLisaTemplate,
  ResolvedPackageLisaTemplate,
} from "./package-lisa-types.js";

/**
 * @file package-lisa.ts
 * @description Package.lisa.json strategy for governance-driven package.json management
 *
 * Implements a two-file approach to package.json governance:
 * - Source: package.lisa.json files in type directories (all/, typescript/, expo/, etc.)
 * - Destination: project's package.json
 *
 * Behavior is defined in package.lisa.json:
 * - force: Lisa's values completely replace project's values
 * - defaults: Project's values preserved; Lisa's used only if missing
 * - merge: Arrays concatenated and deduplicated
 *
 * Inheritance chain: all → typescript → specific types (expo, nestjs, cdk, npm-package)
 * Child types override parent values in each section.
 * @module strategies
 */

/**
 * Package.lisa.json strategy: Manage package.json via separate template files
 * - Loads templates from all applicable types in inheritance chain
 * - Merges templates (child overrides parent)
 * - Applies force/defaults/merge logic to project's package.json
 * - Keeps project's package.json 100% clean (no Lisa artifacts)
 */
export class PackageLisaStrategy implements ICopyStrategy {
  readonly name = "package-lisa" as const;

  private readonly PACKAGE_JSON = "package.json";
  private readonly TSCONFIG_JSON = "tsconfig.json";
  private readonly APP_JSON = "app.json";
  private readonly EAS_JSON = "eas.json";
  private readonly NEST_CLI_JSON = "nest-cli.json";
  private readonly CDK_JSON = "cdk.json";

  /**
   * Apply package-lisa strategy: Load templates from inheritance chain, apply to package.json
   * @remarks
   * This strategy is unique because:
   * 1. It loads multiple source files from type hierarchy, not just one
   * 2. It applies structured merge logic (force/defaults/merge) instead of simple JSON merge
   * 3. It never applies changes if source file doesn't exist in ANY type directory
   * @param sourcePath - Path to source package.lisa.json (only used for detecting when to apply)
   * @param destPath - Destination package.json path
   * @param relativePath - Relative path for recording ("package.json")
   * @param context - Strategy context with config and callbacks
   * @returns Result with action "copied", "merged", or "skipped"
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    // Check if any package.lisa.json exists in the Lisa directory
    const packageLisaExists = await fse.pathExists(sourcePath);
    if (!packageLisaExists) {
      // No package.lisa.json found; skip this strategy
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    const destExists = await fse.pathExists(destPath);

    try {
      // Load templates and apply regardless of whether destination exists
      const merged = await this.mergePackageJson(destPath, context);

      if (!destExists) {
        return this.createDestination(destPath, merged, relativePath, context);
      }

      return this.updateDestination(destPath, merged, relativePath, context);
    } catch (error) {
      if (error instanceof JsonMergeError) {
        throw error;
      }
      throw new JsonMergeError(
        relativePath,
        `Failed to apply package-lisa strategy: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Create destination file when it doesn't exist
   * @param destPath - Path to destination package.json
   * @param merged - Merged package.json object
   * @param relativePath - Relative path for recording
   * @param context - Strategy context with config and callbacks
   * @returns Result with action "copied"
   * @private
   */
  private async createDestination(
    destPath: string,
    merged: Record<string, unknown>,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    if (!context.config.dryRun) {
      await ensureParentDir(destPath);
      await writeJson(destPath, merged);
      context.recordFile(relativePath, this.name);
    }
    return { relativePath, strategy: this.name, action: "copied" };
  }

  /**
   * Update destination file when it exists
   * @param destPath - Path to destination package.json
   * @param merged - Merged package.json object
   * @param relativePath - Relative path for recording
   * @param context - Strategy context with config and callbacks
   * @returns Result with action "merged" or "skipped"
   * @private
   */
  private async updateDestination(
    destPath: string,
    merged: Record<string, unknown>,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const originalJson = await readJson<Record<string, unknown>>(destPath);

    // Normalize for comparison
    const normalizedDest = JSON.stringify(originalJson, null, 2);
    const normalizedMerged = JSON.stringify(merged, null, 2);

    if (normalizedDest === normalizedMerged) {
      if (!context.config.dryRun) {
        context.recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    if (!context.config.dryRun) {
      await context.backupFile(destPath);
      await writeJson(destPath, merged);
      context.recordFile(relativePath, this.name);
    }

    return { relativePath, strategy: this.name, action: "merged" };
  }

  /**
   * Merge package.json using force/defaults/merge logic from package.lisa.json templates
   * @param packageJsonPath - Absolute path to destination package.json
   * @param context - Strategy context with Lisa config
   * @returns Merged package.json object
   * @private
   */
  private async mergePackageJson(
    packageJsonPath: string,
    context: StrategyContext
  ): Promise<Record<string, unknown>> {
    // Try to read existing package.json, or start with empty object
    const projectJson =
      (await readJsonOrNull<Record<string, unknown>>(packageJsonPath)) || {};

    // Extract the Lisa directory from config
    const lisaDir = context.config.lisaDir;
    const projectDir = path.dirname(packageJsonPath);

    // Get detected project types by analyzing the project structure
    const detectedTypes = await this.detectProjectTypes(projectDir);

    // Load and merge all package.lisa.json templates from type hierarchy
    const merged = await this.loadAndMergeTemplates(lisaDir, detectedTypes);

    // Apply force/defaults/merge logic to project's package.json
    return this.applyTemplate(projectJson, merged);
  }

  /**
   * Detect which project types apply to this project
   * (TypeScript, Expo, NestJS, CDK, npm-package)
   * @param projectDir - Root directory of the project
   * @returns Array of detected project types
   * @private
   */
  private async detectProjectTypes(projectDir: string): Promise<ProjectType[]> {
    const types: ProjectType[] = [];

    // TypeScript detection
    const hasTypeScript =
      (await fse.pathExists(path.join(projectDir, this.TSCONFIG_JSON))) ||
      (await this.packageJsonHasKey(projectDir, "typescript"));
    if (hasTypeScript) types.push("typescript");

    // Expo detection
    const hasExpo =
      (await fse.pathExists(path.join(projectDir, this.APP_JSON))) ||
      (await fse.pathExists(path.join(projectDir, this.EAS_JSON))) ||
      (await this.packageJsonHasKey(projectDir, "expo"));
    if (hasExpo) types.push("expo");

    // NestJS detection
    const hasNestJS =
      (await fse.pathExists(path.join(projectDir, this.NEST_CLI_JSON))) ||
      (await this.packageJsonHasKeyPrefix(projectDir, "@nestjs"));
    if (hasNestJS) types.push("nestjs");

    // CDK detection
    const hasCDK =
      (await fse.pathExists(path.join(projectDir, this.CDK_JSON))) ||
      (await this.packageJsonHasKey(projectDir, "aws-cdk"));
    if (hasCDK) types.push("cdk");

    // npm-package detection
    const isPrivate = await this.packageJsonField<boolean>(
      projectDir,
      "private"
    );
    const hasPublishField =
      (await this.packageJsonField(projectDir, "main")) !== undefined ||
      (await this.packageJsonField(projectDir, "bin")) !== undefined ||
      (await this.packageJsonField(projectDir, "exports")) !== undefined ||
      (await this.packageJsonField(projectDir, "files")) !== undefined;

    if (!isPrivate && hasPublishField) {
      types.push("npm-package");
    }

    return types;
  }

  /**
   * Check if package.json contains a key
   * @param projectDir - The project directory to check
   * @param key - The key to check for in package.json
   * @returns True if the key exists in package.json, false otherwise
   * @private
   */
  private async packageJsonHasKey(
    projectDir: string,
    key: string
  ): Promise<boolean> {
    const packageJson = await readJsonOrNull<Record<string, unknown>>(
      path.join(projectDir, this.PACKAGE_JSON)
    );
    if (!packageJson) return false;
    return key in packageJson;
  }

  /**
   * Check if package.json contains a key that starts with a prefix (for scoped packages)
   * @param projectDir - The project directory to check
   * @param prefix - The prefix to check for (e.g., "@nestjs" or "@aws-sdk")
   * @returns True if any key in package.json starts with the given prefix, false otherwise
   * @private
   */
  private async packageJsonHasKeyPrefix(
    projectDir: string,
    prefix: string
  ): Promise<boolean> {
    const packageJson = await readJsonOrNull<Record<string, unknown>>(
      path.join(projectDir, this.PACKAGE_JSON)
    );
    if (!packageJson) return false;
    return Object.keys(packageJson).some(key => key.startsWith(prefix));
  }

  /**
   * Get a field value from package.json
   * @param projectDir - The project directory containing the package.json
   * @param fieldName - The field name to retrieve from package.json
   * @returns The field value if found, undefined if not found or if package.json doesn't exist
   * @private
   */
  private async packageJsonField<T = unknown>(
    projectDir: string,
    fieldName: string
  ): Promise<T | undefined> {
    const packageJson = await readJsonOrNull<Record<string, unknown>>(
      path.join(projectDir, this.PACKAGE_JSON)
    );
    if (!packageJson) return undefined;
    return packageJson[fieldName] as T | undefined;
  }

  /**
   * Load and merge all package.lisa.json templates from type hierarchy
   * @remarks
   * Inheritance chain: all → typescript → specific types (expo, nestjs, cdk, npm-package)
   * Child types override parent types in force, defaults, and merge sections.
   * @param lisaDir - Root Lisa directory path
   * @param detectedTypes - Project types to load templates for
   * @returns Merged template with force, defaults, merge sections
   * @private
   */
  private async loadAndMergeTemplates(
    lisaDir: string,
    detectedTypes: ProjectType[]
  ): Promise<ResolvedPackageLisaTemplate> {
    const initial: ResolvedPackageLisaTemplate = {
      force: {},
      defaults: {},
      merge: {},
    };

    // Expand types to include parents (e.g., expo includes typescript)
    const allTypes = this.expandTypeHierarchy(detectedTypes);

    // Process types in order: all, then typescript, then specific types
    const typesToProcess = ["all", ...allTypes] as const;

    // Load and merge all templates using reduce
    // eslint-disable-next-line functional/no-let -- Reassignment needed for async loop
    let accumulator = initial;
    for (const type of typesToProcess) {
      const templatePath = path.join(
        lisaDir,
        type,
        "package-lisa",
        "package.lisa.json"
      );

      const template = await readJsonOrNull<PackageLisaTemplate>(templatePath);
      if (!template) {
        // Template doesn't exist for this type; skip
        continue;
      }

      // Merge template into accumulated template (child overrides parent)
      accumulator = this.mergeTemplates(accumulator, template);
    }

    return accumulator;
  }

  /**
   * Expand project types to include parent types
   * @remarks
   * Type hierarchy: expo/nestjs/cdk/npm-package inherit from typescript
   * This expands a list to include parents.
   * Example: [expo] → [typescript, expo]
   * @param types - Project types detected
   * @returns Expanded types including parents
   * @private
   */
  private expandTypeHierarchy(types: ProjectType[]): ProjectType[] {
    const allTypes = new Set<ProjectType>(types);

    for (const type of types) {
      const parent = PROJECT_TYPE_HIERARCHY[type];
      if (parent) {
        allTypes.add(parent);
      }
    }

    return Array.from(allTypes);
  }

  /**
   * Merge two template objects
   * Child template (override) values win in force and defaults.
   * Merge arrays are concatenated without deduplication at merge time.
   * @param parent - Parent template (e.g., "all" or "typescript")
   * @param child - Child template (e.g., "expo") that overrides parent
   * @returns Merged template
   * @private
   */
  private mergeTemplates(
    parent: ResolvedPackageLisaTemplate,
    child: PackageLisaTemplate
  ): ResolvedPackageLisaTemplate {
    return {
      force: deepMerge(parent.force, child.force || {}),
      defaults: deepMerge(parent.defaults, child.defaults || {}),
      merge: this.mergeMergeSections(parent.merge, child.merge || {}),
    };
  }

  /**
   * Merge two merge-section objects
   * Arrays are concatenated (deduplication happens later when applied to package.json)
   * @param parent - Parent merge sections
   * @param child - Child merge sections
   * @returns Merged sections
   * @private
   */
  private mergeMergeSections(
    parent: Record<string, unknown[]>,
    child: Record<string, unknown[]>
  ): Record<string, unknown[]> {
    const result = { ...parent } as Record<string, unknown[]>;

    for (const [key, value] of Object.entries(child)) {
      if (key in result) {
        // Concatenate arrays
        const existing = result[key] as unknown[];
        result[key] = [...existing, ...value];
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Apply force/defaults/merge logic to project's package.json
   * @remarks
   * Processing order:
   * 1. Apply force: Deep merge with Lisa values winning (entire section replaced)
   * 2. Apply defaults: Deep merge with project values winning (only set if missing)
   * 3. Apply merge: Concatenate arrays and deduplicate
   * @param projectJson - Current project's package.json
   * @param template - Merged package.lisa.json template
   * @returns Modified package.json
   * @private
   */
  private applyTemplate(
    projectJson: Record<string, unknown>,
    template: ResolvedPackageLisaTemplate
  ): Record<string, unknown> {
    // Phase 1: Apply force (Lisa's values completely replace project's)
    const afterForce = deepMerge(
      projectJson,
      template.force as Record<string, unknown>
    );

    // Phase 2: Apply defaults (project's values preserved, Lisa provides fallback)
    const afterDefaults = deepMerge(
      template.defaults as Record<string, unknown>,
      afterForce
    );

    // Phase 3: Apply merge (concatenate and deduplicate arrays)
    return this.applyMergeSections(afterDefaults, template.merge);
  }

  /**
   * Apply merge-section arrays to package.json
   * Concatenates Lisa's items and project's items, deduplicated by JSON.stringify equality.
   * @param packageJson - Current package.json after force/defaults applied
   * @param mergeSections - Merge sections from template
   * @returns Package.json with merge sections applied
   * @private
   */
  private applyMergeSections(
    packageJson: Record<string, unknown>,
    mergeSections: Record<string, unknown[]>
  ): Record<string, unknown> {
    const result = { ...packageJson };

    for (const [key, lisaItems] of Object.entries(mergeSections)) {
      const projectItems = (result[key] as unknown[]) || [];

      if (!Array.isArray(projectItems)) {
        // If the field exists but isn't an array, replace it with Lisa's items
        result[key] = lisaItems;
        continue;
      }

      // Concatenate and deduplicate: Lisa items first, then project's unique items
      result[key] = this.deduplicateArrays(lisaItems, projectItems);
    }

    return result;
  }

  /**
   * Concatenate two arrays and remove duplicates
   * Uses JSON.stringify for value equality comparison.
   * Lisa items come first, then project's unique items.
   * @param lisaItems - Lisa's items (come first)
   * @param projectItems - Project's items (added if not already present)
   * @returns Deduplicated array
   * @private
   */
  private deduplicateArrays(
    lisaItems: unknown[],
    projectItems: unknown[]
  ): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];

    // Add Lisa items first
    for (const item of lisaItems) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    // Add project's unique items
    for (const item of projectItems) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }

    return result;
  }
}
