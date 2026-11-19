import path from "node:path";

import * as fse from "fs-extra";

import { isPostinstallSafeApply } from "../core/apply-mode.js";
import type { FileOperationResult, ProjectType } from "../core/config.js";
import {
  auditSelfReferenceRewrites,
  type OverrideFloorAudit,
} from "../core/override-floors.js";
import { LISA_PACKAGE_NAME } from "../core/self-apply.js";
import { getPackageVersion } from "../cli/version.js";
import { JsonMergeError } from "../errors/index.js";
import { ensureParentDir } from "../utils/file-operations.js";
import { readJson, readJsonOrNull, writeJson } from "../utils/json-utils.js";
import { detectProjectTypes } from "./package-lisa-detect.js";
import {
  assertManifestIsInstallable,
  countTemplateFloors,
  planSelfReferencingOverrideNormalization,
} from "./package-lisa-manifest-guards.js";
import {
  adoptableDependencies,
  applyHostFittedTemplate,
  applyTemplate,
  declaredDependencies,
} from "./package-lisa-template-apply.js";
import {
  loadAndMergeTemplates,
  restrictToSecurityPins,
} from "./package-lisa-template-merge.js";
import type {
  PackageJsonPlan,
  ResolvedPackageLisaTemplate,
} from "./package-lisa-types.js";
import { fitDirectRangesToLisaFloors } from "./package-lisa-direct-floors.js";
import { findMentionedPackages } from "./package-mentions.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";

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

  /**
   * Produce the exact package.json result from already-safe project inputs.
   * @param projectJson - Parsed host package.json
   * @param detectedTypes - Canonically detected project types
   * @param lisaDir - Lisa package root
   * @param securityPinsOnly - Restrict to postinstall-safe security pins
   * @param projectDir - Host directory, read for its lockfiles so a forced
   *   package-manager floor reaches only hosts using that manager (#4848)
   * @param invokingPackageManager - Manager that launched the apply, used when
   *   the host has no field or lockfile to say (#4941)
   * @returns Package document that apply would persist
   */
  async planPackageJson(
    projectJson: Record<string, unknown>,
    detectedTypes: readonly ProjectType[],
    lisaDir: string,
    securityPinsOnly = false,
    projectDir?: string,
    invokingPackageManager?: string
  ): Promise<Record<string, unknown>> {
    const merged = await loadAndMergeTemplates(lisaDir, detectedTypes);
    const restricted =
      securityPinsOnly || projectJson.name === LISA_PACKAGE_NAME;
    const effective = restricted ? restrictToSecurityPins(merged) : merged;
    const forced = applyHostFittedTemplate(
      projectJson,
      effective,
      restricted,
      projectDir,
      this.readApplyingVersion,
      invokingPackageManager,
      await findMentionedPackages(
        projectDir,
        adoptableDependencies(projectJson, effective),
        declaredDependencies(projectJson)
      )
    );
    const result = planSelfReferencingOverrideNormalization(
      fitDirectRangesToLisaFloors(
        forced.packageJson,
        effective,
        this.PACKAGE_JSON
      ).packageJson,
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
    const detectedTypes = await detectProjectTypes(projectDir);
    const merged = await loadAndMergeTemplates(lisaDir, detectedTypes);
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
    const effective = restricted ? restrictToSecurityPins(merged) : merged;
    try {
      const forced = applyTemplate(
        projectJson,
        effective,
        this.PACKAGE_JSON,
        restricted,
        this.readApplyingVersion
      );
      return {
        applyPath,
        audit: auditSelfReferenceRewrites(
          fitDirectRangesToLisaFloors(
            forced.packageJson,
            effective,
            this.PACKAGE_JSON
          ).packageJson
        ),
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
      // Records the new file and its missing parents for rollback (#4459).
      await context.backupFile(destPath);
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
    const detectedTypes = await detectProjectTypes(projectDir);

    const merged = await loadAndMergeTemplates(lisaDir, detectedTypes);
    const restricted =
      securityPinsOnly || projectJson.name === LISA_PACKAGE_NAME;
    const effective = restricted ? restrictToSecurityPins(merged) : merged;
    const forced = applyHostFittedTemplate(
      projectJson,
      effective,
      restricted,
      projectDir,
      this.readApplyingVersion,
      context.config.invokingPackageManager,
      await findMentionedPackages(
        projectDir,
        adoptableDependencies(projectJson, effective),
        declaredDependencies(projectJson)
      )
    );
    const fitted = fitDirectRangesToLisaFloors(
      forced.packageJson,
      effective,
      this.PACKAGE_JSON
    );
    const plan = planSelfReferencingOverrideNormalization(
      fitted.packageJson,
      this.PACKAGE_JSON
    );
    assertManifestIsInstallable(plan.packageJson, this.PACKAGE_JSON);
    return {
      ...plan,
      notes: [...forced.notes, ...fitted.notes, ...plan.notes],
    };
  }
}
