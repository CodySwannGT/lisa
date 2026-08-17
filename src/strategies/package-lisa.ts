/* eslint-disable max-lines -- Package merge strategy is intentionally comprehensive */
import { readFile } from "node:fs/promises";
import * as fse from "fs-extra";
import path from "node:path";
import semver from "semver";
import type { FileOperationResult, ProjectType } from "../core/config.js";
import { PROJECT_TYPE_HIERARCHY, PROJECT_TYPE_ORDER } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { ensureParentDir } from "../utils/file-operations.js";
import {
  readJson,
  writeJson,
  deepMerge,
  readJsonOrNull,
} from "../utils/json-utils.js";
import { JsonMergeError } from "../errors/index.js";
import { LISA_PACKAGE_NAME } from "../core/self-apply.js";
import type {
  PackageLisaTemplate,
  ResolvedPackageLisaTemplate,
} from "./package-lisa-types.js";

/** Planned package.json content plus messages the operator should see. */
interface PackageJsonPlan {
  readonly packageJson: Record<string, unknown>;
  readonly notes: readonly string[];
}

/** One override/resolution entry that will be rewritten to a `$name` reference. */
interface OverrideRewrite {
  readonly section: "overrides" | "resolutions";
  readonly name: string;
  readonly literalRange: string;
  readonly directRange: string;
}

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
  private readonly HARPER_APP_CONFIG = path.join("harper-app", "config.yaml");
  private readonly HARPER_APP_SCHEMA = path.join(
    "harper-app",
    "schema.graphql"
  );

  /**
   * Produce the exact package.json result from already-safe project inputs.
   * @param projectJson - Parsed host package.json
   * @param detectedTypes - Canonically detected project types
   * @param lisaDir - Lisa package root
   * @param securityPinsOnly - Restrict to postinstall-safe security pins
   * @returns Package document that apply would persist
   */
  async planPackageJson(
    projectJson: Record<string, unknown>,
    detectedTypes: readonly ProjectType[],
    lisaDir: string,
    securityPinsOnly = false
  ): Promise<Record<string, unknown>> {
    const merged = await this.loadAndMergeTemplates(lisaDir, detectedTypes);
    const effective =
      securityPinsOnly || projectJson.name === LISA_PACKAGE_NAME
        ? this.restrictToSecurityPins(merged)
        : merged;
    const result = planSelfReferencingOverrideNormalization(
      this.applyTemplate(projectJson, effective),
      this.PACKAGE_JSON
    );
    assertNoDanglingDollarRefs(result.packageJson, this.PACKAGE_JSON);
    return result.packageJson;
  }

  /**
   * Apply package-lisa strategy: Load templates from inheritance chain, apply to package.json
   * @remarks
   * This strategy is unique because:
   * 1. It loads multiple source files from type hierarchy, not just one
   * 2. It applies structured merge logic (force/defaults/merge) instead of simple JSON merge
   * 3. It never applies changes if source file doesn't exist in ANY type directory
   * 4. Source is package.lisa.json but destination is always package.json
   * @param sourcePath - Path to source package.lisa.json (triggers the strategy)
   * @param destPath - Passed as package.lisa.json path, but we target package.json instead
   * @param relativePath - Passed as package.lisa.json, but we record package.json
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

    // Translate package.lisa.json → package.json for the actual target
    // The source file is package.lisa.json but we apply to package.json
    const actualDestPath = path.join(path.dirname(destPath), this.PACKAGE_JSON);
    const actualRelativePath = this.PACKAGE_JSON;

    const destExists = await fse.pathExists(actualDestPath);

    // During a non-interactive / postinstall apply (`--skip-git-check`) we must
    // not clobber the host's package.json scripts, deps, or other customizations
    // (see commit "fix: preserve host config during postinstall apply"). But
    // governance-critical dependency pins — `force.resolutions` and
    // `force.overrides` — are SECURITY writes (e.g. transitive-CVE force-bumps
    // like ws/axios/esbuild). If we skip the whole strategy they never reach the
    // project and the pre-push audit hook blocks every update. So when
    // skip-git-check applies to an existing package.json, restrict the apply to
    // only those two force sections and leave everything else untouched.
    const securityPinsOnly = context.config.skipGitCheck && destExists;

    try {
      // Load templates and apply to package.json
      const plan = await this.mergePackageJson(
        actualDestPath,
        context,
        securityPinsOnly
      );

      if (!destExists) {
        return this.createDestination(
          actualDestPath,
          plan.packageJson,
          actualRelativePath,
          context,
          plan.notes
        );
      }

      return this.updateDestination(
        actualDestPath,
        plan.packageJson,
        actualRelativePath,
        context,
        plan.notes
      );
    } catch (error) {
      if (error instanceof JsonMergeError) {
        throw error;
      }
      throw new JsonMergeError(
        actualRelativePath,
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
   * @param notes - Operator-visible notes explaining non-obvious rewrites
   * @returns Result with action "copied"
   * @private
   */
  private async createDestination(
    destPath: string,
    merged: Record<string, unknown>,
    relativePath: string,
    context: StrategyContext,
    notes: readonly string[] = []
  ): Promise<FileOperationResult> {
    if (!context.config.dryRun) {
      await ensureParentDir(destPath);
      await writeJson(destPath, merged);
    }
    const result: FileOperationResult = {
      relativePath,
      strategy: this.name,
      action: "copied",
    };
    return notes.length > 0 ? { ...result, note: notes.join("; ") } : result;
  }

  /**
   * Update destination file when it exists
   * @param destPath - Path to destination package.json
   * @param merged - Merged package.json object
   * @param relativePath - Relative path for recording
   * @param context - Strategy context with config and callbacks
   * @param notes - Operator-visible notes explaining non-obvious rewrites
   * @returns Result with action "merged" or "skipped"
   * @private
   */
  private async updateDestination(
    destPath: string,
    merged: Record<string, unknown>,
    relativePath: string,
    context: StrategyContext,
    notes: readonly string[] = []
  ): Promise<FileOperationResult> {
    const originalJson = await readJson<Record<string, unknown>>(destPath);

    // Normalize for comparison
    const normalizedDest = JSON.stringify(originalJson, null, 2);
    const normalizedMerged = JSON.stringify(merged, null, 2);

    if (normalizedDest === normalizedMerged) {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    if (!context.config.dryRun) {
      await context.backupFile(destPath);
      await writeJson(destPath, merged);
    }

    const result: FileOperationResult = {
      relativePath,
      strategy: this.name,
      action: "merged",
    };
    return notes.length > 0 ? { ...result, note: notes.join("; ") } : result;
  }

  /**
   * Merge package.json using force/defaults/merge logic from package.lisa.json templates
   * @param packageJsonPath - Absolute path to destination package.json
   * @param context - Strategy context with Lisa config
   * @param securityPinsOnly - When true (skip-git-check on an existing package.json),
   *   apply only force.resolutions/force.overrides and preserve all other host config
   * @returns Planned package.json object plus operator-visible notes
   * @private
   */
  private async mergePackageJson(
    packageJsonPath: string,
    context: StrategyContext,
    securityPinsOnly = false
  ): Promise<PackageJsonPlan> {
    // Try to read existing package.json, or start with empty object
    const projectJson =
      (await readJsonOrNull<Record<string, unknown>>(packageJsonPath)) || {};

    // Extract the Lisa directory from config
    const lisaDir = context.config.lisaDir;
    const projectDir = path.dirname(packageJsonPath);

    // Get detected project types by analyzing the project structure
    const detectedTypes = await this.detectProjectTypes(projectDir);

    const merged = await this.loadAndMergeTemplates(lisaDir, detectedTypes);
    const effective =
      securityPinsOnly || projectJson.name === LISA_PACKAGE_NAME
        ? this.restrictToSecurityPins(merged)
        : merged;
    const plan = planSelfReferencingOverrideNormalization(
      this.applyTemplate(projectJson, effective),
      this.PACKAGE_JSON
    );
    assertNoDanglingDollarRefs(plan.packageJson, this.PACKAGE_JSON);
    return plan;
  }

  /**
   * Reduce a resolved template to only the security-critical force sections
   * (`resolutions` and `overrides`), dropping force.scripts, defaults, merge,
   * and remove. Used during skip-git-check (postinstall) applies so dependency
   * pins still apply without clobbering host config.
   *
   * The retained overrides/resolutions may contain `$name` self-references or
   * literal pins that normalize to `$name` later. Both resolve against a direct
   * dependency of that name. If the restricted template drops the backing direct
   * dep, postinstall can validate against the host's wider range and fail the
   * normalization guard. So we also pull the package's forced pin from
   * force.dependencies / force.devDependencies into the restricted set.
   * @param template - Fully merged template from the type hierarchy
   * @returns Template carrying force.resolutions/force.overrides plus the direct
   *   dependencies that back any direct-dependency override within them
   * @private
   */
  private restrictToSecurityPins(
    template: ResolvedPackageLisaTemplate
  ): ResolvedPackageLisaTemplate {
    const force: Record<string, unknown> = {};
    if (template.force.resolutions !== undefined) {
      force.resolutions = template.force.resolutions;
    }
    if (template.force.overrides !== undefined) {
      force.overrides = template.force.overrides;
    }
    this.includeBackingDirectDeps(template, force);
    return { force, defaults: {}, merge: {}, remove: {} };
  }

  /**
   * For every direct-dependency override in the restricted overrides/resolutions,
   * copy the forced pin for `name` from the full template's force.dependencies /
   * force.devDependencies into the restricted force section so the backing direct
   * dependency is materialized. A devDependencies pin wins over dependencies when
   * both exist.
   * @param template - Fully merged template (source of the forced dep pins)
   * @param force - Restricted force section being assembled (mutated in place)
   * @private
   */
  private includeBackingDirectDeps(
    template: ResolvedPackageLisaTemplate,
    force: Record<string, unknown>
  ): void {
    const referenced = new Set([
      ...collectDollarReferences([force.resolutions, force.overrides]),
      ...collectLiteralOverrideNames([force.resolutions, force.overrides]),
    ]);
    if (referenced.size === 0) {
      return;
    }
    const forceDeps = asRecord(template.force.dependencies);
    const forceDevDeps = asRecord(template.force.devDependencies);
    const backed = Array.from(referenced).filter(
      name => forceDevDeps[name] !== undefined || forceDeps[name] !== undefined
    );
    if (backed.length === 0) {
      return;
    }
    const deps: Record<string, unknown> = {};
    const devDeps: Record<string, unknown> = {};
    for (const name of backed) {
      if (forceDevDeps[name] !== undefined) {
        devDeps[name] = forceDevDeps[name];
      } else {
        deps[name] = forceDeps[name];
      }
    }
    if (Object.keys(devDeps).length > 0) {
      force.devDependencies = {
        ...asRecord(force.devDependencies),
        ...devDeps,
      };
    }
    if (Object.keys(deps).length > 0) {
      force.dependencies = { ...asRecord(force.dependencies), ...deps };
    }
  }
  /**
   * Detect which project types apply to this project
   * (TypeScript, Expo, NestJS, CDK, Harper/Fabric, npm-package)
   * @param projectDir - Root directory of the project
   * @returns Array of detected project types
   * @private
   */
  private async detectProjectTypes(projectDir: string): Promise<ProjectType[]> {
    const types: ProjectType[] = [];

    // TypeScript detection
    const hasTypeScript =
      (await fse.pathExists(path.join(projectDir, this.TSCONFIG_JSON))) ||
      (await this.packageJsonHasDependency(projectDir, "typescript"));
    if (hasTypeScript) types.push("typescript");

    // Expo detection
    const hasExpo =
      (await fse.pathExists(path.join(projectDir, this.APP_JSON))) ||
      (await fse.pathExists(path.join(projectDir, this.EAS_JSON))) ||
      (await this.packageJsonHasDependency(projectDir, "expo"));
    if (hasExpo) types.push("expo");

    // NestJS detection
    const hasNestJS =
      (await fse.pathExists(path.join(projectDir, this.NEST_CLI_JSON))) ||
      (await this.packageJsonHasDependencyPrefix(projectDir, "@nestjs"));
    if (hasNestJS) types.push("nestjs");

    // CDK detection
    const hasCDK =
      (await fse.pathExists(path.join(projectDir, this.CDK_JSON))) ||
      (await this.packageJsonHasDependencyPrefix(projectDir, "aws-cdk"));
    if (hasCDK) types.push("cdk");

    // Harper/Fabric detection
    const hasHarperFabric =
      (await fse.pathExists(path.join(projectDir, this.HARPER_APP_CONFIG))) &&
      (await fse.pathExists(path.join(projectDir, this.HARPER_APP_SCHEMA))) &&
      ((await this.harperConfigHasComponentSignals(projectDir)) ||
        (await this.packageJsonHasDependency(projectDir, "harperdb")));
    if (hasHarperFabric) types.push("harper-fabric");

    // Phaser detection
    const hasPhaser = await this.packageJsonHasDependency(projectDir, "phaser");
    if (hasPhaser) types.push("phaser");

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
   * Check whether harper-app/config.yaml declares the expected Harper component
   * resource keys.
   * @param projectDir - The project directory to check
   * @returns True if the config has Harper/Fabric component signals
   * @private
   */
  private async harperConfigHasComponentSignals(
    projectDir: string
  ): Promise<boolean> {
    try {
      const content = await readFile(
        path.join(projectDir, this.HARPER_APP_CONFIG),
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
   * Check if package.json dependencies/devDependencies contain a specific package
   * @param projectDir - The project directory to check
   * @param packageName - The exact package name to check for (e.g., "typescript", "expo")
   * @returns True if the package is in dependencies or devDependencies, false otherwise
   * @private
   */
  private async packageJsonHasDependency(
    projectDir: string,
    packageName: string
  ): Promise<boolean> {
    const packageJson = await readJsonOrNull<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(projectDir, this.PACKAGE_JSON));
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
   * @private
   */
  private async packageJsonHasDependencyPrefix(
    projectDir: string,
    prefix: string
  ): Promise<boolean> {
    const packageJson = await readJsonOrNull<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(path.join(projectDir, this.PACKAGE_JSON));
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
    detectedTypes: readonly ProjectType[]
  ): Promise<ResolvedPackageLisaTemplate> {
    const initial: ResolvedPackageLisaTemplate = {
      force: {},
      defaults: {},
      merge: {},
      remove: {},
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
   * Expand project types to include parent types, sorted by hierarchy order
   * @remarks
   * Type hierarchy: expo/nestjs/cdk/npm-package inherit from typescript
   * This expands a list to include parents and sorts by PROJECT_TYPE_ORDER
   * so parents are processed before children (enabling child overrides).
   * Example: [cdk] → [typescript, cdk]
   * @param types - Project types detected
   * @returns Expanded types including parents, sorted parents-first
   * @private
   */
  private expandTypeHierarchy(types: readonly ProjectType[]): ProjectType[] {
    const allTypes = new Set<ProjectType>(types);

    for (const type of types) {
      const parent = PROJECT_TYPE_HIERARCHY[type];
      if (parent) {
        allTypes.add(parent);
      }
    }

    // Sort by PROJECT_TYPE_ORDER to ensure parents are processed before children
    return Array.from(allTypes).sort(
      (a, b) => PROJECT_TYPE_ORDER.indexOf(a) - PROJECT_TYPE_ORDER.indexOf(b)
    );
  }

  /**
   * Merge two template objects
   * Child template (override) values win in force and defaults.
   * Merge and remove arrays are concatenated without deduplication at merge time.
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
      remove: this.mergeMergeSections(
        parent.remove,
        child.remove || {}
      ) as Record<string, string[]>,
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
   * Apply force/defaults/merge/remove logic to project's package.json
   * @remarks
   * Processing order:
   * 1. Apply force: Deep merge with Lisa values winning (entire section replaced)
   * 2. Apply defaults: Deep merge with project values winning (only set if missing)
   * 3. Apply merge: Concatenate arrays and deduplicate
   * 4. Apply remove: Delete retired keys from their sections (runs last so an
   *    earlier phase cannot reintroduce a removed key)
   * @param projectJson - Current project's package.json
   * @param template - Merged package.lisa.json template
   * @returns Modified package.json
   * @private
   */
  private applyTemplate(
    projectJson: Record<string, unknown>,
    template: ResolvedPackageLisaTemplate
  ): Record<string, unknown> {
    // Phase 1: Apply force (Lisa's values completely replace project's), then
    // restore any dependency pin the host had raised ABOVE Lisa's floor.
    const afterForce = preserveHigherHostPins(
      projectJson,
      deepMerge(projectJson, template.force as Record<string, unknown>)
    );

    // Phase 2: Apply defaults (project's values preserved, Lisa provides fallback)
    const afterDefaults = deepMerge(
      template.defaults as Record<string, unknown>,
      afterForce
    );

    // Phase 3: Apply merge (concatenate and deduplicate arrays)
    const afterMerge = this.applyMergeSections(afterDefaults, template.merge);

    // Phase 4: Apply remove (delete retired keys from their sections)
    return this.applyRemoveSections(afterMerge, template.remove);
  }

  /**
   * Delete retired keys from their package.json sections
   * @remarks
   * Used to clean up keys Lisa previously forced and has since renamed or
   * retired (e.g. the "knip" script renamed to "knip:check"). Runs after
   * force/defaults/merge so a removed key cannot be reintroduced within the
   * same apply. Sections that don't exist or aren't objects are left alone.
   * @param packageJson - Current package.json after force/defaults/merge applied
   * @param removeSections - Map of section name to keys to delete from it
   * @returns Package.json with retired keys removed
   * @private
   */
  private applyRemoveSections(
    packageJson: Record<string, unknown>,
    removeSections: Record<string, string[]>
  ): Record<string, unknown> {
    const result = { ...packageJson };

    for (const [sectionName, keysToRemove] of Object.entries(removeSections)) {
      const section = result[sectionName];
      if (!section || typeof section !== "object" || Array.isArray(section)) {
        // Section missing or not a plain object; nothing to remove
        continue;
      }

      const cleaned = Object.fromEntries(
        Object.entries(section as Record<string, unknown>).filter(
          ([key]) => !keysToRemove.includes(key)
        )
      );
      result[sectionName] = cleaned;
    }

    return result;
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

/** package.json sections whose keys are treated as direct dependencies. */
const DIRECT_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/** package.json sections that carry npm-style version overrides. */
const OVERRIDE_SECTIONS = ["overrides", "resolutions"] as const;

/**
 * Restore host `overrides`/`resolutions` pins that sit ABOVE Lisa's template.
 * @remarks
 * `force.overrides` / `force.resolutions` exist to push a project PAST a
 * transitive CVE, so they are a security FLOOR — not an assignment. Phase 1
 * applies them with `deepMerge`, where Lisa's value wins unconditionally, and
 * that is only correct while the template is the higher of the two. The moment
 * a host raises a pin beyond the template (or the template simply lags a fresh
 * advisory), the same "security write" silently walks the host BACKWARDS into
 * the vulnerable range it had already escaped.
 *
 * This is not hypothetical: a host pinned at `tar >=7.5.21` was reverted to
 * `>=7.5.11` on every `bun install` by a template carrying the older value, and
 * upgrading Lisa did not fix it — the shipped template was still `>=7.5.19`,
 * below the host. A floor can only be right by coincidence when it is written
 * as an overwrite.
 *
 * Comparison is on the minimum version each range admits (`>=7.5.21` → 7.5.21,
 * `^6.27.0` → 6.27.0), which is exactly the quantity a CVE floor cares about. A
 * value that cannot be parsed — npm's `"$name"` self-references, git URLs, `*`
 * — is left as Phase 1 produced it, so this can only ever RAISE a pin.
 * @param projectJson - The host package.json as it was before Phase 1.
 * @param afterForce - The result of Phase 1's force merge.
 * @returns `afterForce`, with host-side higher pins restored.
 */
function preserveHigherHostPins(
  projectJson: Record<string, unknown>,
  afterForce: Record<string, unknown>
): Record<string, unknown> {
  return OVERRIDE_SECTIONS.reduce<Record<string, unknown>>((acc, section) => {
    const forcedSection = asRecord(acc[section]);
    const restored = Object.entries(asRecord(projectJson[section])).reduce<
      Record<string, unknown>
    >(
      (pins, [name, hostValue]) =>
        hostPinIsHigher(hostValue, forcedSection[name])
          ? { ...pins, [name]: hostValue }
          : pins,
      forcedSection
    );

    return restored === forcedSection ? acc : { ...acc, [section]: restored };
  }, afterForce);
}

/**
 * Decide whether the host's pin admits a strictly higher minimum than Lisa's.
 * @param hostValue - The host's range for this dependency.
 * @param forcedValue - The range Phase 1 wrote for the same dependency.
 * @returns True only when both parse and the host's floor is strictly higher.
 */
function hostPinIsHigher(hostValue: unknown, forcedValue: unknown): boolean {
  if (typeof hostValue !== "string" || typeof forcedValue !== "string") {
    return false;
  }
  const hostFloor = rangeFloor(hostValue);
  const forcedFloor = rangeFloor(forcedValue);
  return (
    hostFloor !== null &&
    forcedFloor !== null &&
    semver.gt(hostFloor, forcedFloor)
  );
}

/**
 * Resolve the lowest version a range admits.
 * @param range - An npm version range.
 * @returns The minimum version, or null when the range is not comparable.
 */
function rangeFloor(range: string): string | null {
  try {
    return semver.minVersion(range)?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Rewrite literal `overrides`/`resolutions` entries into npm's `"$name"`
 * self-reference form when the overridden package is also a direct dependency.
 * @remarks
 * npm rejects a manifest with `EOVERRIDE` when an `overrides`/`resolutions` key
 * that is also a direct dependency carries a literal version instead of the
 * `"$name"` self-reference — e.g. a security remediation force-bumping
 * `prettier` in `overrides` while `prettier` stays a direct devDependency. npm
 * runs this validation before doing anything, so the broken manifest fails every
 * `npx`/`npm` invocation in the project directory (including plugin MCP servers
 * spawned via `npx`), not just installs. Normalizing to `$name` — the same form
 * Lisa's own templates use (e.g. `"vite": "$vite"`) — resolves the override
 * against the direct dependency and satisfies npm, healing a hand-injected or
 * agent-injected override on the next apply without touching the project by hand.
 *
 * Only top-level string entries are rewritten: those are what trigger EOVERRIDE.
 * Existing `$name` references and nested (parent-scoped) override objects are
 * left untouched. Overrides for packages that are NOT direct dependencies are
 * also left as literals — those are legitimate transitive pins.
 * @param pkg - Merged package.json about to be persisted
 * @param fileName - Basename used in error messages
 * @throws JsonMergeError when a rewrite would make the effective override wider
 *   than the literal constraint it replaced.
 * @returns Planned package.json plus operator-visible notes.
 */
function planSelfReferencingOverrideNormalization(
  pkg: Record<string, unknown>,
  fileName: string
): PackageJsonPlan {
  const directDeps = collectDirectDependencyNames(pkg);
  if (directDeps.size === 0) {
    return { packageJson: pkg, notes: [] };
  }
  const directRanges = collectDirectDependencyRanges(pkg);
  const rewritePlan = OVERRIDE_SECTIONS.reduce<{
    readonly sections: Record<string, unknown>;
    readonly rewrites: readonly OverrideRewrite[];
  }>(
    (acc, section) => {
      const entries = pkg[section];
      if (
        entries === null ||
        typeof entries !== "object" ||
        Array.isArray(entries)
      ) {
        return acc;
      }
      const pairs = Object.entries(entries);
      const sectionRewrites = pairs.flatMap(([name, value]) => {
        if (!needsSelfReferenceRewrite(directDeps, name, value)) {
          return [];
        }
        const directRange = directRanges.get(name);
        if (directRange === undefined) {
          return [];
        }
        const literalRange = value as string;
        assertSelfReferenceRewriteDoesNotWiden(
          fileName,
          section,
          name,
          literalRange,
          directRange
        );
        return [{ section, name, literalRange, directRange }];
      });
      if (sectionRewrites.length === 0) {
        return acc;
      }
      const normalized = Object.fromEntries(
        pairs.map(([name, value]) =>
          sectionRewrites.some(rewrite => rewrite.name === name)
            ? [name, `$${name}`]
            : [name, value]
        )
      );
      return {
        sections: { ...acc.sections, [section]: normalized },
        rewrites: [...acc.rewrites, ...sectionRewrites],
      };
    },
    { sections: {}, rewrites: [] }
  );
  const packageJson =
    Object.keys(rewritePlan.sections).length > 0
      ? { ...pkg, ...rewritePlan.sections }
      : pkg;
  return {
    packageJson,
    notes: rewritePlan.rewrites.map(formatSelfReferenceRewriteNote),
  };
}

/**
 * Decide whether an override/resolution entry needs npm `$name` normalization.
 * @param directDeps - Direct dependency names in the merged package
 * @param name - Override/resolution key
 * @param value - Override/resolution value
 * @returns True when the entry is a literal direct-dependency collision
 */
function needsSelfReferenceRewrite(
  directDeps: ReadonlySet<string>,
  name: string,
  value: unknown
): boolean {
  return (
    directDeps.has(name) &&
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("$")
  );
}

/**
 * Refuse a `$name` rewrite unless the direct dependency range is no wider.
 * @param fileName - Basename used in error messages
 * @param section - Override section carrying the entry
 * @param name - Package name being rewritten
 * @param literalRange - Literal override/resolution range to replace
 * @param directRange - Direct dependency range `$name` would resolve to
 * @throws JsonMergeError when the rewrite is unprovable or widening
 */
function assertSelfReferenceRewriteDoesNotWiden(
  fileName: string,
  section: OverrideRewrite["section"],
  name: string,
  literalRange: string,
  directRange: string
): void {
  if (!semver.validRange(literalRange) || !semver.validRange(directRange)) {
    throw new JsonMergeError(
      fileName,
      `${section}.${name} cannot be rewritten to "$${name}" because Lisa ` +
        `cannot prove the direct dependency range ${JSON.stringify(directRange)} ` +
        `is no wider than the literal override ${JSON.stringify(literalRange)}.`
    );
  }
  if (!semver.subset(directRange, literalRange)) {
    throw new JsonMergeError(
      fileName,
      `${section}.${name} would widen if rewritten to "$${name}": the literal ` +
        `override ${JSON.stringify(literalRange)} would resolve to direct ` +
        `dependency range ${JSON.stringify(directRange)}. Pin the direct ` +
        `dependency to ${JSON.stringify(literalRange)} or choose a direct range ` +
        `that is no wider than the override.`
    );
  }
}

/**
 * Format the operator-visible explanation for a safe `$name` rewrite.
 * @param rewrite - Rewrite metadata
 * @returns Human-readable note for apply output
 */
function formatSelfReferenceRewriteNote(rewrite: OverrideRewrite): string {
  return (
    `Normalized ${rewrite.section}.${rewrite.name}: replaced literal ` +
    `${JSON.stringify(rewrite.literalRange)} with "$${rewrite.name}" ` +
    `resolving to direct dependency range ` +
    `${JSON.stringify(rewrite.directRange)}.`
  );
}

/**
 * Narrow an unknown value to a plain object record, returning {} otherwise.
 * @param value - Candidate value
 * @returns The value as a record, or an empty record when it is not a plain object
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Recursively collect every `$name` reference found in a single JSON value. npm
 * overrides/resolutions use a `"$name"` string value to mean "resolve to the
 * version of the direct dependency `name`", and the reference may appear at any
 * nesting depth (npm allows nested override objects).
 * @param value - JSON value to scan
 * @returns Referenced package names (without the leading `$`), possibly with dups
 */
function collectRefsFromValue(value: unknown): readonly string[] {
  if (typeof value === "string") {
    const match = /^\$(.+)$/.exec(value);
    return match?.[1] !== undefined ? [match[1]] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectRefsFromValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(collectRefsFromValue);
  }
  return [];
}

/**
 * Collect the distinct `$name` references across the given sections (typically
 * overrides and resolutions).
 * @param sections - Values to scan
 * @returns Set of referenced package names (without the leading `$`)
 */
function collectDollarReferences(sections: readonly unknown[]): Set<string> {
  return new Set(sections.flatMap(collectRefsFromValue));
}

/**
 * Collect top-level literal override keys that may later normalize to `$name`.
 * @param sections - Override/resolution sections to inspect
 * @returns Set of package names with non-empty literal string entries
 */
function collectLiteralOverrideNames(
  sections: readonly unknown[]
): Set<string> {
  return new Set(
    sections.flatMap(section => {
      const entries = asRecord(section);
      return Object.entries(entries).flatMap(([name, value]) =>
        typeof value === "string" && value.length > 0 && !value.startsWith("$")
          ? [name]
          : []
      );
    })
  );
}

/**
 * Collect the names of every direct dependency declared across a package.json's
 * dependency sections.
 * @param pkg - Merged package.json object
 * @returns Set of direct dependency names
 */
function collectDirectDependencyNames(
  pkg: Record<string, unknown>
): Set<string> {
  return new Set(
    DIRECT_DEPENDENCY_SECTIONS.flatMap(section =>
      Object.keys(asRecord(pkg[section]))
    )
  );
}

/**
 * Collect direct dependency ranges by package name.
 * @param pkg - Merged package.json object
 * @returns Package name to string range map
 */
function collectDirectDependencyRanges(
  pkg: Record<string, unknown>
): ReadonlyMap<string, string> {
  return new Map(
    DIRECT_DEPENDENCY_SECTIONS.flatMap(section =>
      Object.entries(asRecord(pkg[section])).flatMap(([name, value]) =>
        typeof value === "string" ? [[name, value] as const] : []
      )
    )
  );
}

/**
 * Fail the apply when the merged package.json carries a `$name` self-reference
 * in overrides/resolutions without the backing direct dependency. Writing such
 * a file leaves a dangling $ref that passes local checks but breaks `npm ci` in
 * CI only. Throwing here surfaces the misconfiguration at apply time instead.
 * @param pkg - Merged package.json about to be written
 * @param fileName - Basename used in the error message
 * @throws JsonMergeError when any `$name` reference lacks a matching direct dep
 */
function assertNoDanglingDollarRefs(
  pkg: Record<string, unknown>,
  fileName: string
): void {
  const referenced = collectDollarReferences([pkg.overrides, pkg.resolutions]);
  if (referenced.size === 0) {
    return;
  }
  const directDeps = collectDirectDependencyNames(pkg);
  const missing = Array.from(referenced).filter(name => !directDeps.has(name));
  if (missing.length === 0) {
    return;
  }
  const refs = missing.map(name => `$${name}`).join(", ");
  const isPlural = missing.length > 1;
  throw new JsonMergeError(
    fileName,
    `Dangling ${refs} in overrides/resolutions: a "$name" self-reference ` +
      `requires "name" to be a direct dependency, but ${missing.join(", ")} ` +
      `${isPlural ? "are" : "is"} not present in ` +
      `dependencies/devDependencies. Add a force.devDependencies entry for ` +
      `${isPlural ? "each" : "it"} in package.lisa.json, or drop the reference.`
  );
}
/* eslint-enable max-lines -- Re-enable after comprehensive package merge strategy */
