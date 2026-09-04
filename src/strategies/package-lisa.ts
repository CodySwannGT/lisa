/* eslint-disable max-lines -- Package merge strategy is intentionally comprehensive */
import { readFile } from "node:fs/promises";
import * as fse from "fs-extra";
import path from "node:path";
import semver from "semver";
import { isPostinstallSafeApply } from "../core/apply-mode.js";
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
import {
  asRecord,
  auditSelfReferenceRewrites,
  collectDirectDependencyNames,
  describeSelfReferenceRemedy,
  DIRECT_DEPENDENCY_SECTIONS,
  OVERRIDE_SECTIONS,
  type OverrideFloorAudit,
  type SelfReferenceCandidate,
  type SelfReferenceFloorConflict,
} from "../core/override-floors.js";
import { LISA_PACKAGE_NAME } from "../core/self-apply.js";
import { getPackageVersion } from "../cli/version.js";
import type {
  PackageLisaTemplate,
  ResolvedPackageLisaTemplate,
} from "./package-lisa-types.js";

/** Planned package.json content plus messages the operator should see. */
interface PackageJsonPlan {
  readonly packageJson: Record<string, unknown>;
  readonly notes: readonly string[];
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
 * - adopt: Lisa reclaims a key still holding a value Lisa itself wrote
 * - defaults: Project's values preserved; Lisa's used only if missing
 * - merge: Arrays concatenated and deduplicated
 * - remove: Retired keys deleted from their section
 *
 * A governed script CI invokes is shipped as a pair — `lint:lisa` forced, and
 * `lint` merely defaulted to invoke it — so the host owns the composition point
 * and anything chained onto it survives an apply. See the reserved-base section
 * of `wiki/documentation/specs/package-lisa-json.md`.
 *
 * Inheritance chain: all → typescript → specific types (expo, nestjs, cdk, npm-package)
 * Child types override parent values in each section.
 * @module strategies
 */

/** Which of the two apply paths an override-floor audit simulated. */
export type ApplyPathLabel = "postinstall" | "full apply";

/** One apply path's answer: an audit, or the reason there is none. */
export interface OverrideFloorPathAudit {
  /** Apply path simulated. */
  readonly applyPath: ApplyPathLabel;
  /** What the path inspected and found, or null when it could not run. */
  readonly audit: OverrideFloorAudit | null;
  /** Why the path could not run, or null when it did. */
  readonly error: string | null;
}

/** Everything one override-floor audit of a project looked at. */
export interface OverrideFloorAuditReport {
  /**
   * Literal (non-`$name`) entries across the resolved template's
   * `force.overrides` and `force.resolutions` — the floors Lisa would write.
   *
   * Zero is the inert case, not a clean one: it means template resolution
   * produced nothing to compare against, so the audit below cannot have
   * verified anything. Callers must not read an empty conflict list as a pass
   * without reading this first.
   */
  readonly lisaFloors: number;
  /** Project types the apply itself would detect here. */
  readonly detectedTypes: readonly ProjectType[];
  /** One entry per apply path. */
  readonly paths: readonly OverrideFloorPathAudit[];
}

/**
 * Package.lisa.json strategy: Manage package.json via separate template files
 * - Loads templates from all applicable types in inheritance chain
 * - Merges templates (child overrides parent)
 * - Applies force/defaults/merge logic to project's package.json
 * - Keeps project's package.json 100% clean (no Lisa artifacts)
 */
export class PackageLisaStrategy implements ICopyStrategy {
  readonly name = "package-lisa" as const;

  /**
   * Build a strategy, optionally stating the version performing the apply.
   * @param readApplyingVersion - Reports the Lisa version performing the apply.
   * Injected rather than read inline so a spec can state a version outright
   * instead of deriving its expectation from the code under test.
   */
  constructor(
    private readonly readApplyingVersion: () => string = getPackageVersion
  ) {}

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
    const restricted =
      securityPinsOnly || projectJson.name === LISA_PACKAGE_NAME;
    const effective = restricted ? this.restrictToSecurityPins(merged) : merged;
    const forced = this.applyTemplate(
      projectJson,
      effective,
      this.PACKAGE_JSON,
      restricted
    );
    const result = planSelfReferencingOverrideNormalization(
      forced.packageJson,
      this.PACKAGE_JSON
    );
    assertManifestIsInstallable(result.packageJson, this.PACKAGE_JSON);
    return result.packageJson;
  }

  /**
   * Report every `$name` override that would resolve BELOW a Lisa floor, before
   * an apply refuses over it.
   * @remarks
   * Deliberately re-runs the apply's own resolution — the same type detection,
   * the same template inheritance chain, the same force/preserve/adopt phases —
   * rather than re-deriving the answer from `package.lisa.json` and the host
   * manifest side by side. A second implementation of "what would the merged
   * manifest look like" is a second thing to keep in step with this file, and
   * the whole value of the report is that it agrees with the refusal.
   *
   * BOTH apply paths are simulated. The postinstall path applies a template
   * restricted to security pins and pulls in the direct dependencies backing
   * them, so it can accept a manifest the unrestricted path refuses and vice
   * versa. Reporting only one leaves an operator refused by the other with a
   * doctor line that said nothing.
   * @param projectDir - Host project directory containing package.json
   * @param lisaDir - Installed Lisa package root
   * @returns What was inspected on each path, and every conflict found
   */
  async auditOverrideFloors(
    projectDir: string,
    lisaDir: string
  ): Promise<OverrideFloorAuditReport> {
    const projectJson =
      (await readJsonOrNull<Record<string, unknown>>(
        path.join(projectDir, this.PACKAGE_JSON)
      )) ?? {};
    const detectedTypes = await this.detectProjectTypes(projectDir);
    const merged = await this.loadAndMergeTemplates(lisaDir, detectedTypes);
    return {
      lisaFloors: countTemplateFloors(merged),
      detectedTypes,
      paths: [
        this.auditOneApplyPath(projectJson, merged, "postinstall"),
        this.auditOneApplyPath(projectJson, merged, "full apply"),
      ],
    };
  }

  /**
   * Simulate one apply path and audit the manifest it would produce.
   * @param projectJson - Parsed host package.json
   * @param merged - Fully resolved template for the detected types
   * @param applyPath - Which path to simulate
   * @returns The path's audit, or the reason it could not be produced
   * @private
   */
  private auditOneApplyPath(
    projectJson: Record<string, unknown>,
    merged: ResolvedPackageLisaTemplate,
    applyPath: ApplyPathLabel
  ): OverrideFloorPathAudit {
    const restricted =
      applyPath === "postinstall" || projectJson.name === LISA_PACKAGE_NAME;
    const effective = restricted ? this.restrictToSecurityPins(merged) : merged;
    try {
      const forced = this.applyTemplate(
        projectJson,
        effective,
        this.PACKAGE_JSON,
        restricted
      );
      return {
        applyPath,
        audit: auditSelfReferenceRewrites(forced.packageJson),
        error: null,
      };
    } catch (error) {
      return {
        applyPath,
        audit: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
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
    const securityPinsOnly =
      isPostinstallSafeApply(context.config) && destExists;

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
      // No write, but the notes still have to reach the operator: "Lisa kept
      // your pin and did not lower it" is the case where nothing changes, and
      // it is exactly the case worth saying out loud.
      const skipped: FileOperationResult = {
        relativePath,
        strategy: this.name,
        action: "skipped",
      };
      return notes.length > 0
        ? { ...skipped, note: notes.join("; ") }
        : skipped;
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
    const restricted =
      securityPinsOnly || projectJson.name === LISA_PACKAGE_NAME;
    const effective = restricted ? this.restrictToSecurityPins(merged) : merged;
    const forced = this.applyTemplate(
      projectJson,
      effective,
      this.PACKAGE_JSON,
      restricted
    );
    const plan = planSelfReferencingOverrideNormalization(
      forced.packageJson,
      this.PACKAGE_JSON
    );
    assertManifestIsInstallable(plan.packageJson, this.PACKAGE_JSON);
    return { ...plan, notes: [...forced.notes, ...plan.notes] };
  }

  /**
   * Reduce a resolved template to only the security-critical sections —
   * `force.resolutions` and `force.overrides`, plus the retirements aimed at
   * those same two sections — dropping force.scripts, defaults, merge, and
   * every other retirement. Used during skip-git-check (postinstall) applies so
   * dependency pins still apply without clobbering host config.
   *
   * Retiring an override is as security-critical as writing one, so it travels
   * with them. Dropping it left a pin that turns out to be harmful with no way
   * to reach a host through postinstall: the template stops forcing the key,
   * but the copy already written into the host's package.json stays. That is
   * how `brace-expansion >=5.0.9` would have survived its own removal.
   * Retirements aimed at other sections stay behind, because deleting host
   * scripts or dependencies is exactly the config clobbering this path avoids.
   *
   * The retained overrides/resolutions may contain `$name` self-references or
   * literal pins that normalize to `$name` later. Both resolve against a direct
   * dependency of that name. If the restricted template drops the backing direct
   * dep, postinstall can validate against the host's wider range and fail the
   * normalization guard. So we also pull the package's forced pin from
   * force.dependencies / force.devDependencies into the restricted set.
   * @param template - Fully merged template from the type hierarchy
   * @returns Template carrying force.resolutions/force.overrides, the direct
   *   dependencies that back any direct-dependency override within them, and
   *   the retirements aimed at those same two sections
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
    const remove = Object.fromEntries(
      OVERRIDE_SECTIONS.filter(
        section => template.remove[section] !== undefined
      ).map(section => [section, template.remove[section] as string[]])
    );
    // `adopt` reclaims a key so `defaults` can rewrite it, and `defaults` is
    // dropped here — carrying it alone would delete a host script and put
    // nothing back.
    return { force, defaults: {}, merge: {}, remove, adopt: {} };
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

    // CDK detection. cdk.json only: an `aws-cdk*` dependency means the project
    // uses CDK constructs, not that it is a CDK app with the preset's layout.
    const hasCDK = await fse.pathExists(path.join(projectDir, this.CDK_JSON));
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
      adopt: {},
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
      adopt: mergeAdoptSections(parent.adopt, child.adopt || {}),
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
   * @param fileName - Basename used in error messages
   * @param restricted - True when the template was reduced to security pins,
   *   which is the postinstall path and Lisa's own repository
   * @returns Modified package.json plus operator-visible notes
   * @private
   */
  private applyTemplate(
    projectJson: Record<string, unknown>,
    template: ResolvedPackageLisaTemplate,
    fileName: string,
    restricted = false
  ): PackageJsonPlan {
    // Phase 1: Apply force (Lisa's values completely replace project's), then
    // restore any dependency pin the host had raised ABOVE Lisa's floor.
    const afterForce = preserveHigherHostPins(
      projectJson,
      deepMerge(projectJson, template.force as Record<string, unknown>),
      fileName
    );

    // Phase 1.5: Reclaim keys still carrying a value Lisa itself wrote, so the
    // defaults phase can install the current one. A host value Lisa does not
    // recognise as its own is left alone — that is the whole point.
    const afterAdopt = applyAdoptSections(afterForce.packageJson, template);

    // Phase 2: Apply defaults (project's values preserved, Lisa provides fallback)
    const afterDefaults = deepMerge(
      template.defaults as Record<string, unknown>,
      afterAdopt
    );

    // Phase 3: Apply merge (concatenate and deduplicate arrays)
    const afterMerge = this.applyMergeSections(afterDefaults, template.merge);

    // Phase 4: Apply remove (delete retired keys from their sections)
    const afterRemove = this.applyRemoveSections(afterMerge, template.remove);

    // Phase 5: Make the host's pin name the version that wrote these templates.
    // A restricted apply is the postinstall path, where the installed package
    // IS the applying version, so there is nothing to reconcile — and rewriting
    // the host's manifest from inside their `install` is not this phase's to do.
    const pinned = restricted
      ? { packageJson: afterRemove, notes: [] }
      : alignLisaPin(afterRemove, this.readApplyingVersion());

    // Phase 6: Say out loud what the host lost, and which gates nothing runs.
    return {
      packageJson: pinned.packageJson,
      notes: [
        ...afterForce.notes,
        ...pinned.notes,
        ...describeScriptChanges(projectJson, pinned.packageJson, template),
      ],
    };
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

/**
 * Dependency sections a host may declare `@codyswann/lisa` in, most-specific
 * first: a runtime dependency is the unusual choice, so finding one there means
 * the host meant it.
 */
const LISA_PIN_SECTIONS = ["dependencies", "devDependencies"] as const;

/** Where a pin goes on a host that does not have one yet. */
const DEFAULT_LISA_PIN_SECTION = "devDependencies";

/**
 * Specs that name a LOCATION rather than a registry version.
 * @remarks
 * `file:` / `link:` / `portal:` / `workspace:` and the git forms all mean
 * somebody is developing against a checkout instead of a release. Replacing one
 * with a version number breaks that setup, so the apply reports the skew rather
 * than resolving it — which is the branch the second acceptance scenario is
 * about.
 */
const NON_REGISTRY_SPEC =
  /^(?:file|link|portal|workspace|git|git\+[a-z]+|github|https?|npm):/i;

/**
 * Does this spec point at a location rather than name a registry version?
 * @param spec - The version spec the host declared
 * @returns True when the spec resolves outside the registry
 */
function isNonRegistrySpec(spec: string): boolean {
  return NON_REGISTRY_SPEC.test(spec);
}

/**
 * Where the host declares its Lisa pin, and what it currently says.
 * @param packageJson - The manifest as the merge phases left it
 * @returns The section to write into and the spec already there, if any
 */
function locateLisaPin(packageJson: Record<string, unknown>): {
  readonly section: string;
  readonly current: string | undefined;
} {
  const declared = LISA_PIN_SECTIONS.map(section => ({
    section,
    current: asRecord(packageJson[section])[LISA_PACKAGE_NAME],
  })).find(found => typeof found.current === "string");
  return declared === undefined
    ? { section: DEFAULT_LISA_PIN_SECTION, current: undefined }
    : { section: declared.section, current: declared.current as string };
}

/**
 * Make the host's `@codyswann/lisa` pin name the version doing the applying.
 * @remarks
 * An apply writes templates that call into the package's own API, so the
 * applied version and the INSTALLED version are two halves of one thing. When
 * they drift, a config file calls an export the installed package does not have
 * and every run of the tool that loads it dies at config load — while the apply
 * itself reports success, and `postinstall`'s `[ -d dist/configs ] || tsc ||
 * true` swallows the only local signal. The failure then surfaces at the next
 * lint run, detached from the apply that caused it (#2953).
 *
 * A range is rewritten as readily as an exact pin, and deliberately so: a caret
 * range ADMITS the applying version without requiring it, so a lockfile still
 * resolving an older build produces exactly the skew this closes.
 *
 * Lisa applying to its own repository never reaches here: that path is
 * restricted to security pins, and a package cannot depend on itself.
 * @param packageJson - The manifest as the merge phases left it
 * @param applyingVersion - Version of the Lisa performing this apply
 * @returns The manifest with the pin aligned, plus operator-visible notes
 */
function alignLisaPin(
  packageJson: Record<string, unknown>,
  applyingVersion: string
): PackageJsonPlan {
  const { section, current } = locateLisaPin(packageJson);
  if (current === applyingVersion) return { packageJson, notes: [] };

  if (current !== undefined && isNonRegistrySpec(current)) {
    return {
      packageJson,
      notes: [
        `Left ${LISA_PACKAGE_NAME} at "${current}", which points at a local copy rather than a release, but this apply is ${applyingVersion}. If that copy is older, the files just written may call something it does not have and every lint run will fail before it checks anything.`,
      ],
    };
  }

  const note =
    current === undefined
      ? `Added ${LISA_PACKAGE_NAME} ${applyingVersion} to ${section}. The files this apply just wrote come from ${applyingVersion} and call into it, so install it before your next lint run.`
      : `Pinned ${LISA_PACKAGE_NAME} to ${applyingVersion}; it was ${current}. The files this apply just wrote come from ${applyingVersion} and call into it, so the two have to be the same version — install it before your next lint run.`;

  return {
    packageJson: {
      ...packageJson,
      [section]: {
        ...asRecord(packageJson[section]),
        [LISA_PACKAGE_NAME]: applyingVersion,
      },
    },
    notes: [note],
  };
}

/** The package.json section whose overwrites are reported to the operator. */
const SCRIPTS_SECTION = "scripts";

/**
 * Suffix naming the Lisa-owned half of a split script.
 *
 * A governed gate is shipped as a PAIR: `lint:lisa` carries Lisa's own command
 * and stays in `force`, so a host can neither delete nor weaken it; `lint` is
 * only a `defaults` entry invoking it, so the host owns the composition point
 * and anything chained onto it survives every apply.
 */
const RESERVED_BASE_SUFFIX = ":lisa";

/** How much of a script value an operator note quotes before eliding. */
const NOTE_VALUE_BUDGET = 140;

/**
 * Merge two `adopt` sections, taking the UNION of the recognised values.
 * @remarks
 * Union, not child-overrides-parent as `force` and `defaults` use. Every entry
 * is a value Lisa is known to have written, and a host may have taken any of
 * them from any layer of the chain it has passed through. Dropping the parent's
 * list would stop recognising a value Lisa really did author, and the cost of
 * that is not cosmetic: the host gets warned that it customised something it
 * never touched, and stops tracking the template.
 * @param parent - Parent template's adopt section
 * @param child - Child template's adopt section
 * @returns Per-section, per-key union of the two, order-preserving and deduped
 */
function mergeAdoptSections(
  parent: Record<string, Record<string, string[]>>,
  child: Record<string, Record<string, string[]>>
): Record<string, Record<string, string[]>> {
  const sections = new Set([...Object.keys(parent), ...Object.keys(child)]);
  return Object.fromEntries(
    Array.from(sections).map(section => {
      const parentKeys = parent[section] ?? {};
      const childKeys = child[section] ?? {};
      const keys = new Set([
        ...Object.keys(parentKeys),
        ...Object.keys(childKeys),
      ]);
      return [
        section,
        Object.fromEntries(
          Array.from(keys).map(key => [
            key,
            Array.from(
              new Set([...(parentKeys[key] ?? []), ...(childKeys[key] ?? [])])
            ),
          ])
        ),
      ];
    })
  );
}

/**
 * Drop every key still carrying a value Lisa itself wrote.
 * @remarks
 * The deletion is what lets the `defaults` phase, which never overwrites, reach
 * a key Lisa used to force. Nothing else is touched: a value absent from the
 * adopt list is the host's own work by definition, and keeping it is the entire
 * behaviour this exists to provide.
 * @param packageJson - The document as the force phase left it
 * @param template - Resolved template carrying the adopt section
 * @returns The document with Lisa-authored values cleared
 */
function applyAdoptSections(
  packageJson: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate
): Record<string, unknown> {
  return Object.entries(template.adopt).reduce<Record<string, unknown>>(
    (document, [sectionName, recognised]) => {
      const section = document[sectionName];
      if (
        section === null ||
        typeof section !== "object" ||
        Array.isArray(section)
      ) {
        return document;
      }
      // A key the template also FORCES already holds Lisa's current value.
      // Clearing it would delete what force just wrote and leave the key to
      // whatever `defaults` happens to carry — so force wins, and adopt is a
      // no-op there. Adopt only has meaning for a key Lisa has handed back.
      const forcedHere = asRecord(asRecord(template.force)[sectionName]);
      const entries = Object.entries(section as Record<string, unknown>);
      const kept = entries.filter(
        ([key, value]) =>
          typeof value !== "string" ||
          key in forcedHere ||
          !(recognised[key] ?? []).includes(value)
      );
      if (kept.length === entries.length) {
        return document;
      }
      return { ...document, [sectionName]: Object.fromEntries(kept) };
    },
    packageJson
  );
}

/**
 * Quote a script value for an operator note without flooding the terminal.
 * @param value - The script value being quoted
 * @returns The value, elided past the note budget
 */
function quoteScript(value: string): string {
  return value.length <= NOTE_VALUE_BUDGET
    ? `"${value}"`
    : `"${value.slice(0, NOTE_VALUE_BUDGET)}…"`;
}

/**
 * Report what an apply did to the host's scripts, and what it left inert.
 * @remarks
 * The defect this answers was invisible rather than wrong-looking. One script
 * value changed inside a `package.json` diff dominated by key reordering, and
 * nothing said so, so five chained CI gates became dead code while the Lint
 * check kept reporting green.
 *
 * Every key of the host's `scripts` is walked. Deliberately not a curated list
 * of interesting names: the review that nearly shipped this defect compared a
 * GUESSED subset and concluded "ordering only". A subset is not a method.
 * @param projectJson - The host manifest as it was before the apply
 * @param packageJson - The manifest the apply is about to write
 * @param template - Resolved template, for the reserved-base pairing
 * @returns Operator-readable lines, empty when nothing was lost
 */
function describeScriptChanges(
  projectJson: Record<string, unknown>,
  packageJson: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate
): readonly string[] {
  const before = asRecord(projectJson[SCRIPTS_SECTION]);
  const after = asRecord(packageJson[SCRIPTS_SECTION]);
  const adopted = asRecord(template.adopt[SCRIPTS_SECTION]);
  return [
    ...describeOverwrittenScripts(before, after, adopted),
    ...describeUnrunGates(after, template),
  ];
}

/**
 * Was this host value one Lisa itself wrote into that key?
 * @param adopted - The resolved adopt list for the scripts section
 * @param name - Script name being reported on
 * @param hostValue - The value the host carried before the apply
 * @returns True when the value is Lisa's own rather than the host's work
 */
function isLisaAuthored(
  adopted: Record<string, unknown>,
  name: string,
  hostValue: string
): boolean {
  const recognised = adopted[name];
  return Array.isArray(recognised) && recognised.includes(hostValue);
}

/**
 * Name every host script value this apply replaced or deleted.
 * @remarks
 * A value on the `adopt` list is Lisa's own, so replacing it discards nothing
 * of the host's and must not be reported as a loss. That is not cosmetic: the
 * split hands six gate names back at once, so loss-shaped wording there puts
 * six false alarms in front of every operator on their first upgrade and a
 * REAL loss stops standing out — the precise failure this change exists to
 * end. Those keys get a handover line instead, because the operator does need
 * to learn that the composition point is now theirs to extend.
 * @param before - The host's scripts before the apply
 * @param after - The scripts the apply is about to write
 * @param adopted - Resolved adopt list, naming the values Lisa authored
 * @returns One line per script whose host value did not survive
 */
function describeOverwrittenScripts(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  adopted: Record<string, unknown>
): readonly string[] {
  return Object.entries(before).flatMap(([name, hostValue]) => {
    if (typeof hostValue !== "string") return [];
    const applied = after[name];
    if (applied === hostValue) return [];
    if (applied === undefined) {
      return [
        `Removed scripts.${name}; it ran ${quoteScript(hostValue)}. Nothing in your project runs that any more.`,
      ];
    }
    if (typeof applied !== "string") return [];
    const base = `${name}${RESERVED_BASE_SUFFIX}`;
    // The handover wording names the reserved base, so it is only truthful
    // when the value being written actually invokes one.
    if (isLisaAuthored(adopted, name, hostValue) && applied.includes(base)) {
      return [
        `Moved Lisa's ${name} checks into scripts.${base}; scripts.${name} now calls it, so anything you add there survives the next apply.`,
      ];
    }
    return [
      `Replaced scripts.${name}: it ran ${quoteScript(hostValue)} and now runs ${quoteScript(applied)}.`,
    ];
  });
}

/**
 * Name every Lisa gate the host's own composition point does not run.
 * @remarks
 * `lint:lisa` being force-installed proves the gate EXISTS; it proves nothing
 * about whether anything invokes it, and CI invokes `lint`. A host is free to
 * decline a gate, but declining it silently is the failure mode this whole
 * change is about, so the apply says which gate went unrun.
 *
 * A composition point that inlines Lisa's current base verbatim — the shape
 * every host was left in before the split existed — does run the gate, so it is
 * not warned about. It is nudged instead: an inlined copy stops tracking the
 * template the next time the base changes.
 * @param after - The scripts the apply is about to write
 * @param template - Resolved template carrying the forced reserved bases
 * @returns One line per gate nothing invokes, plus migration nudges
 */
function describeUnrunGates(
  after: Record<string, unknown>,
  template: ResolvedPackageLisaTemplate
): readonly string[] {
  const forcedScripts = asRecord(
    asRecord(template.force)[SCRIPTS_SECTION] as unknown
  );
  return Object.keys(forcedScripts).flatMap(base => {
    if (!base.endsWith(RESERVED_BASE_SUFFIX)) return [];
    const composed = base.slice(0, -RESERVED_BASE_SUFFIX.length);
    const hostValue = after[composed];
    if (typeof hostValue !== "string" || hostValue.includes(base)) return [];
    const baseValue = forcedScripts[base];
    if (typeof baseValue === "string" && hostValue.includes(baseValue)) {
      return [
        `Kept your scripts.${composed}. It spells out Lisa's ${composed} checks instead of calling ${base}, so it will not pick up changes to them; run ${base} from it to stay current.`,
      ];
    }
    return [
      `Kept your scripts.${composed}, but nothing invokes ${base}, so Lisa's ${composed} checks do not run. Add ${base} to scripts.${composed} to turn them back on.`,
    ];
  });
}

/**
 * Every section whose forced values are a version FLOOR rather than an
 * assignment, and which therefore may never be merged downwards.
 * @remarks
 * `overrides`/`resolutions` alone was the original list, and it left the hole
 * this exists to close: `overrides.tar` is `"$tar"`, npm's self-reference, so
 * its effective floor IS `dependencies.tar`. Guarding only the override
 * sections preserved a `$tar` that had quietly come to mean something weaker —
 * the protection intact and hollow at the same time, with a test asserting the
 * override survived passing either way.
 */
const FLOOR_SECTIONS = [
  ...DIRECT_DEPENDENCY_SECTIONS,
  ...OVERRIDE_SECTIONS,
] as const;

/** What Phase 1's value and the host's value mean for one dependency. */
type PinVerdict = "template" | "host" | "incomparable";

/** A host pin kept over Lisa's, with both ranges for the operator note. */
interface PreservedPin {
  readonly section: string;
  readonly name: string;
  readonly hostRange: string;
  readonly forcedRange: string;
}

/**
 * Restore host dependency pins that sit ABOVE Lisa's template.
 * @remarks
 * Every `force` pin exists to push a project PAST a CVE, so it is a security
 * FLOOR — not an assignment. Phase 1 applies it with `deepMerge`, where Lisa's
 * value wins unconditionally, and that is only correct while the template is the
 * higher of the two. The moment a host raises a pin beyond the template (or the
 * template simply lags a fresh advisory), the same "security write" silently
 * walks the host BACKWARDS into the vulnerable range it had already escaped.
 *
 * This is not hypothetical: a caller repo in the portfolio pinned at
 * `dependencies.tar >=7.5.21` was reverted to `>=7.5.19` on every `bun install`,
 * readmitting the two releases GHSA-r292-9mhp-454m covers. A floor can only be
 * right by coincidence when it is written as an overwrite.
 *
 * The decision is deliberately narrow, because Lisa must be able to PROVE the
 * host is ahead — the same standard `preserveIfHostAhead` holds the file lane
 * to, applied to the strictly easier case where a semver range makes "ahead"
 * decidable rather than merely suspected:
 *
 * - Host floor not above Lisa's: Lisa is raising, which is the whole point of
 *   the mechanism. Phase 1 stands.
 * - Host floor above Lisa's AND the host range is a subset of Lisa's: the host
 *   admits only versions Lisa allows, so it is provably the stricter of the
 *   two. Keep the host.
 * - Host floor above Lisa's and neither range contains the other: both sides
 *   carry a constraint the other drops. Lisa cannot decide it, so it REFUSES
 *   and names both rather than picking one — silently picking one is how a
 *   lowered floor shipped in the first place.
 *
 * A value that cannot be parsed — npm's `"$name"` self-references, git URLs,
 * `workspace:*` — is left as Phase 1 produced it, so this can only ever RAISE
 * a pin or stop.
 * @param projectJson - The host package.json as it was before Phase 1.
 * @param afterForce - The result of Phase 1's force merge.
 * @param fileName - Basename used in error messages.
 * @throws JsonMergeError when a host pin is higher but the two ranges are
 *   incomparable.
 * @returns `afterForce` with host-side higher pins restored, plus notes.
 */
function preserveHigherHostPins(
  projectJson: Record<string, unknown>,
  afterForce: Record<string, unknown>,
  fileName: string
): PackageJsonPlan {
  return FLOOR_SECTIONS.reduce<PackageJsonPlan>(
    (plan, section) => {
      const forcedSection = asRecord(plan.packageJson[section]);
      const preserved = collectPreservedPins(
        section,
        asRecord(projectJson[section]),
        forcedSection,
        fileName
      );
      if (preserved.length === 0) {
        return plan;
      }
      return {
        packageJson: {
          ...plan.packageJson,
          [section]: {
            ...forcedSection,
            ...Object.fromEntries(
              preserved.map(pin => [pin.name, pin.hostRange])
            ),
          },
        },
        notes: [...plan.notes, ...preserved.map(formatPreservedPinNote)],
      };
    },
    { packageJson: afterForce, notes: [] }
  );
}

/**
 * Find every host pin in one section that must survive Phase 1's force merge.
 * @param section - Section name, used in notes and error messages
 * @param hostSection - The host's entries for this section, pre-merge
 * @param forcedSection - The entries Phase 1 produced for this section
 * @param fileName - Basename used in error messages
 * @throws JsonMergeError on the first incomparable pin
 * @returns Pins whose host value must be restored
 */
function collectPreservedPins(
  section: string,
  hostSection: Record<string, unknown>,
  forcedSection: Record<string, unknown>,
  fileName: string
): readonly PreservedPin[] {
  return Object.entries(hostSection).flatMap(([name, hostValue]) => {
    const forcedValue = forcedSection[name];
    const verdict = classifyHostPin(hostValue, forcedValue);
    if (verdict === "template") {
      return [];
    }
    const pin: PreservedPin = {
      section,
      name,
      hostRange: hostValue as string,
      forcedRange: forcedValue as string,
    };
    if (verdict === "incomparable") {
      throw new JsonMergeError(fileName, formatIncomparablePinMessage(pin));
    }
    return [pin];
  });
}

/**
 * Decide what to do with one dependency where host and template disagree.
 * @param hostValue - The host's range for this dependency.
 * @param forcedValue - The range Phase 1 wrote for the same dependency.
 * @returns Which side wins, or `incomparable` when neither can be proven ahead.
 */
function classifyHostPin(hostValue: unknown, forcedValue: unknown): PinVerdict {
  if (typeof hostValue !== "string" || typeof forcedValue !== "string") {
    return "template";
  }
  const hostFloor = rangeFloor(hostValue);
  const forcedFloor = rangeFloor(forcedValue);
  if (
    hostFloor === null ||
    forcedFloor === null ||
    !semver.gt(hostFloor, forcedFloor)
  ) {
    return "template";
  }
  return rangeContains(forcedValue, hostValue) ? "host" : "incomparable";
}

/**
 * npm's exclusive-ceiling convention: the lowest possible prerelease of the
 * excluded version, so that no prerelease of it is admitted.
 */
const CEILING_PRERELEASE_SENTINEL = "-0";

/**
 * Rewrite a range's bare `<X.Y.Z` ceilings into npm's `<X.Y.Z-0` form.
 * @remarks
 * `semver` desugars `^5.0.1` to `>=5.0.1 <6.0.0-0` — the `-0` sentinel excludes
 * every prerelease of the ceiling. A hand-written `>=5.0.9 <6.0.0` carries no
 * sentinel, and since `6.0.0-0 < 6.0.0`, its interval is strictly the taller of
 * the two: it contains the points `6.0.0-0` and `6.0.0-alpha.1` that the caret
 * form excludes. `semver.subset` is pure interval algebra, so it answers `false`
 * for `subset(">=5.0.9 <6.0.0", "^5.0.1")` — correctly, for the intervals as
 * literally written. That is not a `semver` defect and there is nothing upstream
 * to wait for.
 *
 * It is still the wrong answer to the question this module is asking. Those
 * extra points are not versions any install can select: `satisfies` excludes
 * prereleases unless a comparator names the same `major.minor.patch` with its
 * own prerelease tag, so `6.0.0-alpha.1` satisfies NEITHER range. The two
 * spellings admit exactly the same installable versions, and the disagreement is
 * an artifact of which spelling the operator reached for — which is precisely
 * the symptom: `^5.0.9` was accepted while the identical interval written as
 * `>=5.0.9 <6.0.0` was refused, telling the operator the guard was broken rather
 * than the range wrong.
 *
 * `includePrerelease: true` does not fix it — it widens BOTH sides, so the
 * ceilings stay unequal and the subset test still fails. Putting both sides into
 * one convention is what makes them comparable.
 *
 * Only a bare `<` ceiling is rewritten. `<=X.Y.Z` is left alone because it
 * genuinely admits `X.Y.Z` itself, and a ceiling that already carries a
 * prerelease tag already says what it means. A range with no `<` comparator at
 * all — an unbounded `>=5.0.9`, or `*` — comes back untouched and stays
 * incomparable, which is the bite that protects a hardened floor.
 * @param range - An npm version range.
 * @returns The same range with bare exclusive ceilings carrying the sentinel.
 */
function normalizeRangeCeilings(range: string): string {
  return new semver.Range(range).set
    .map(comparators =>
      comparators.map(comparator => formatCeiling(comparator)).join(" ")
    )
    .join(" || ");
}

/**
 * Render one comparator, adding the prerelease sentinel to a bare `<` ceiling.
 * @param comparator - A single parsed comparator from a range's comparator set.
 * @returns The comparator's source text, or its sentinel-carrying equivalent.
 */
function formatCeiling(comparator: semver.Comparator): string {
  const version = comparator.semver;
  if (
    comparator.operator !== "<" ||
    version === undefined ||
    version === null ||
    version.prerelease.length > 0
  ) {
    return comparator.value;
  }
  return `<${version.major}.${version.minor}.${version.patch}${CEILING_PRERELEASE_SENTINEL}`;
}

/**
 * Decide whether every version one range admits is admitted by another.
 * @remarks
 * Both sides are put into one ceiling convention first — see
 * {@link normalizeRangeCeilings} — so that a caret and the compound range that
 * desugars to the same interval reach the same verdict. Normalizing can only
 * LOWER a bare ceiling, so it can only turn a `false` into a `true`; the
 * direction is safe here because this branch KEEPS a host pin whose floor is
 * already proven higher, and keeping a higher floor can never lower one.
 *
 * A value `semver` cannot parse at all — `"$name"` self-references, `npm:`
 * aliases, `workspace:`, `file:` and git specs — throws here and is reported as
 * "does not contain", exactly as before.
 * @param outer - The wider candidate range.
 * @param inner - The narrower candidate range.
 * @returns True when `inner` admits nothing `outer` forbids.
 */
function rangeContains(outer: string, inner: string): boolean {
  try {
    return semver.subset(
      normalizeRangeCeilings(inner),
      normalizeRangeCeilings(outer)
    );
  } catch {
    return false;
  }
}

/**
 * Format the operator-visible explanation for a preserved host pin.
 * @param pin - The pin that was kept, with both ranges
 * @returns Human-readable note for apply output
 */
function formatPreservedPinNote(pin: PreservedPin): string {
  return (
    `Kept host ${pin.section}.${pin.name} ${JSON.stringify(pin.hostRange)}: ` +
    `it admits only versions Lisa's ${JSON.stringify(pin.forcedRange)} allows ` +
    `and starts higher, so applying the template would lower the host's floor.`
  );
}

/**
 * Format the refusal for a host pin Lisa cannot prove itself ahead of.
 * @param pin - The pin that could not be decided, with both ranges
 * @returns Human-readable error message naming both ranges
 */
function formatIncomparablePinMessage(pin: PreservedPin): string {
  return (
    `${pin.section}.${pin.name} cannot be merged: the host range ` +
    `${JSON.stringify(pin.hostRange)} starts above Lisa's ` +
    `${JSON.stringify(pin.forcedRange)}, but neither range contains the other, ` +
    `so each admits versions the other forbids and Lisa cannot prove which is ` +
    `correct. Overwriting the host here is how a hardened floor gets silently ` +
    `lowered, so this apply stops instead. Reconcile the two by hand: pick one ` +
    `range in the host package.json that satisfies both constraints, or raise ` +
    `Lisa's template pin to cover the host's.`
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
  const audit = auditSelfReferenceRewrites(pkg);
  const refused = audit.conflicts[0];
  if (refused !== undefined) {
    throw new JsonMergeError(fileName, formatSelfReferenceRefusal(refused));
  }
  if (audit.rewritable.length === 0) {
    return { packageJson: pkg, notes: [] };
  }
  const sections = OVERRIDE_SECTIONS.flatMap(section => {
    const rewrites = audit.rewritable.filter(
      rewrite => rewrite.section === section
    );
    if (rewrites.length === 0) {
      return [];
    }
    const normalized = Object.fromEntries(
      Object.entries(asRecord(pkg[section])).map(([name, value]) =>
        rewrites.some(rewrite => rewrite.name === name)
          ? [name, `$${name}`]
          : [name, value]
      )
    );
    return [[section, normalized] as const];
  });
  return {
    packageJson: { ...pkg, ...Object.fromEntries(sections) },
    notes: audit.rewritable.map(formatSelfReferenceRewriteNote),
  };
}

/**
 * Explain a refused `$name` rewrite, ending with a remedy Lisa has TESTED.
 * @remarks
 * The old message ended "Pin the direct dependency to <the override> or choose
 * a direct range that is no wider" — advice naming no concrete range which, for
 * a bounded floor, is not satisfiable by the obvious reading of it. An operator
 * who follows a refusal's own instructions and is refused a second time
 * concludes the guard is broken rather than the range wrong
 * (CodySwannGT/lisa#3191), which is how a correct security control gets routed
 * around. The replacement names ONE range and has run it back through the same
 * predicate that produced the refusal.
 * @param conflict - The conflict that stopped the apply
 * @returns Human-readable refusal naming both ranges and the verified raise
 */
function formatSelfReferenceRefusal(
  conflict: SelfReferenceFloorConflict
): string {
  const remedy = describeSelfReferenceRemedy(conflict);
  if (conflict.verdict === "unprovable") {
    return (
      `${conflict.section}.${conflict.name} cannot be rewritten to ` +
      `"$${conflict.name}" because Lisa cannot prove the direct dependency ` +
      `range ${JSON.stringify(conflict.directRange)} is no wider than the ` +
      `literal override ${JSON.stringify(conflict.floorRange)}. ${remedy}`
    );
  }
  return (
    `${conflict.section}.${conflict.name} would widen if rewritten to ` +
    `"$${conflict.name}": the literal override ` +
    `${JSON.stringify(conflict.floorRange)} would resolve to direct ` +
    `dependency range ${JSON.stringify(conflict.directRange)}. ${remedy}`
  );
}

/**
 * Format the operator-visible explanation for a safe `$name` rewrite.
 * @param rewrite - Rewrite metadata
 * @returns Human-readable note for apply output
 */
function formatSelfReferenceRewriteNote(
  rewrite: SelfReferenceCandidate
): string {
  return (
    `Normalized ${rewrite.section}.${rewrite.name}: replaced literal ` +
    `${JSON.stringify(rewrite.floorRange)} with "$${rewrite.name}" ` +
    `resolving to direct dependency range ` +
    `${JSON.stringify(rewrite.directRange)}.`
  );
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

/**
 * Fail the apply when a dependency section carries an unsubstituted `$name`
 * placeholder instead of a version range.
 * @remarks
 * `$name` is real npm syntax, but only as an `overrides`/`resolutions` value,
 * where it means "resolve to the version of the direct dependency `name`".
 * A dependency section is not one of those places: npm reads the value as a
 * literal dist-tag and refuses the whole manifest before doing any work —
 * `EINVALIDTAGNAME: Invalid tag name "$tar" of package "tar@$tar"`. Every
 * `npm`/`npx` in the project directory fails from then on, including the
 * plugin MCP servers Lisa spawns via `npx`.
 *
 * So a `$name` here is never a self-reference npm will resolve; it is a
 * placeholder something failed to substitute. Throwing at apply time keeps the
 * failure attached to the thing that caused it, instead of leaving an
 * uninstallable manifest for whoever runs the next install to discover.
 *
 * This also catches the reference-to-a-reference case the dangling-$ref guard
 * cannot: that check is presence-only, so `dependencies.tar = "$tar"` reads as
 * a valid backing dependency for `overrides.tar = "$tar"` even though npm can
 * resolve neither. Only dependency sections are inspected — `scripts` values
 * like `$npm_execpath` are shell variables and are left alone.
 * @param pkg - Merged package.json about to be written
 * @param fileName - Basename used in the error message
 * @throws JsonMergeError when any dependency section value is a `$name` token
 */
function assertNoUnsubstitutedDollarTokens(
  pkg: Record<string, unknown>,
  fileName: string
): void {
  const offenders = DIRECT_DEPENDENCY_SECTIONS.flatMap(section =>
    Object.entries(asRecord(pkg[section])).flatMap(([name, value]) =>
      typeof value === "string" && value.startsWith("$")
        ? [`${section}.${name} = ${JSON.stringify(value)}`]
        : []
    )
  );
  if (offenders.length === 0) {
    return;
  }
  const isPlural = offenders.length > 1;
  throw new JsonMergeError(
    fileName,
    `Unsubstituted placeholder${isPlural ? "s" : ""} in dependency ` +
      `${isPlural ? "sections" : "section"}: ${offenders.join(", ")}. ` +
      `A "$name" value is only valid inside overrides/resolutions, where npm ` +
      `resolves it to the version of the direct dependency "name". In ` +
      `dependencies/devDependencies/optionalDependencies/peerDependencies npm ` +
      `reads it as a literal version tag and rejects the whole manifest with ` +
      `EINVALIDTAGNAME, so every npm and npx command in the project fails. ` +
      `Replace ${isPlural ? "each placeholder" : "the placeholder"} with a real ` +
      `version range.`
  );
}

/**
 * Refuse to persist a package.json npm could not install. Single choke point:
 * every path that writes a manifest runs this, so a new writer cannot pick up
 * one half of the validation and miss the other.
 * @param pkg - Merged package.json about to be written
 * @param fileName - Basename used in error messages
 * @throws JsonMergeError when the manifest carries an unresolvable `$name`
 */
function assertManifestIsInstallable(
  pkg: Record<string, unknown>,
  fileName: string
): void {
  assertNoUnsubstitutedDollarTokens(pkg, fileName);
  assertNoDanglingDollarRefs(pkg, fileName);
}
/* eslint-enable max-lines -- Re-enable after comprehensive package merge strategy */

/**
 * Count the literal version floors a resolved template would write.
 *
 * A `$name` entry is not counted: it carries no floor of its own, so it can
 * never be the thing a host range resolves below.
 * @param template - Fully resolved package.lisa.json template
 * @returns Number of literal entries across force.overrides and force.resolutions
 */
function countTemplateFloors(template: ResolvedPackageLisaTemplate): number {
  return OVERRIDE_SECTIONS.reduce(
    (total, section) =>
      total +
      Object.values(asRecord(template.force[section])).filter(
        value => typeof value === "string" && !value.startsWith("$")
      ).length,
    0
  );
}
