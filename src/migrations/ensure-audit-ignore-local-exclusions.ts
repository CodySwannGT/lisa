import * as path from "node:path";
import * as fse from "fs-extra";
import { gte, minVersion, valid } from "semver";
import type { ProjectType } from "../core/config.js";
import { readJson, readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const AUDIT_CONFIG = "audit.ignore.config.json";
const AUDIT_LOCAL = "audit.ignore.local.json";
const ESBUILD_ADVISORY = "GHSA-gv7w-rqvm-qjhr";
const ESBUILD_PATCHED_VERSION = "0.28.1";

/**
 * One exclusion entry (partial — we only read `id` to detect duplicates).
 *
 * Per security-audit-handling.md, every exclusion entry added by Claude must
 * include a `reason` field documenting the impact evaluation. That requirement
 * is a behavioural policy enforced by convention, not validated here. The
 * migration treats all fields other than `id` as opaque so that entries are
 * relocated intact regardless of their completeness.
 */
interface Exclusion {
  readonly id?: string;
  readonly [key: string]: unknown;
}

/**
 * Minimal shape of an audit ignore file
 */
interface AuditIgnoreLike {
  readonly exclusions?: readonly Exclusion[];
  readonly [key: string]: unknown;
}

/** Package-manager constraints relevant to the esbuild advisory cleanup. */
interface PackageJsonLike {
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly resolutions?: Readonly<Record<string, unknown>>;
}

/**
 * Preferred order of project types for sourcing the Lisa audit template.
 * First matching type wins.
 */
const TEMPLATE_PRIORITY: readonly ProjectType[] = [
  "typescript",
  "expo",
  "cdk",
  "nestjs",
  "npm-package",
];

/**
 * Find the Lisa template audit.ignore.config.json path for the detected project.
 * The Lisa-owned audit config lives under `<type>/copy-overwrite/audit.ignore.config.json`.
 * Only returns a path when the file actually exists on disk; continues to the
 * next priority type otherwise to avoid treating a missing template as an empty
 * baseline.
 * @param lisaDir - Lisa installation directory
 * @param detectedTypes - Project types detected for the destination project
 * @returns Template path, or null when no matching type ships one
 */
async function findTemplateConfigPath(
  lisaDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<string | null> {
  for (const type of TEMPLATE_PRIORITY) {
    if (!detectedTypes.includes(type)) {
      continue;
    }
    const candidate = path.join(lisaDir, type, "copy-overwrite", AUDIT_CONFIG);
    if (await fse.pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Extract the set of exclusion ids from a parsed audit ignore file.
 * Entries missing an `id` are ignored (they cannot be de-duplicated safely).
 * @param file - Parsed audit ignore file
 * @returns Set of exclusion ids found in the file
 */
function collectIds(file: AuditIgnoreLike | null): ReadonlySet<string> {
  if (!file || !Array.isArray(file.exclusions)) {
    return new Set();
  }
  const ids = file.exclusions
    .map(entry => entry.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return new Set(ids);
}

/**
 * Read a project-owned local JSON file, distinguishing between a missing file
 * (returns null) and a malformed file (throws). This prevents silent data loss
 * when a file exists but contains invalid JSON.
 * @param filePath - Path to the JSON file
 * @returns Parsed content, or null when the file does not exist
 */
async function readLocalJson<T>(filePath: string): Promise<T | null> {
  if (!(await fse.pathExists(filePath))) {
    return null;
  }
  return readJson<T>(filePath);
}

/**
 * Report whether the host both enforces and has installed a patched esbuild.
 * Requiring both signals prevents removal while the dependency tree is stale or
 * a permissive package-manager constraint could still select a vulnerable build.
 * @param projectDir - Host project receiving the migration
 * @returns Whether constraints and installed package are both patched
 */
async function hasPatchedEsbuild(projectDir: string): Promise<boolean> {
  const packageJson = await readJsonOrNull<PackageJsonLike>(
    path.join(projectDir, "package.json")
  );
  const installed = await readJsonOrNull<{ readonly version?: string }>(
    path.join(projectDir, "node_modules", "esbuild", "package.json")
  );
  const ranges = [
    packageJson?.overrides?.esbuild,
    packageJson?.resolutions?.esbuild,
  ].filter((range): range is string => typeof range === "string");
  if (ranges.length === 0 || !valid(installed?.version)) {
    return false;
  }
  const constraintsArePatched = ranges.every(range => {
    try {
      const minimum = minVersion(range);
      return minimum !== null && gte(minimum, ESBUILD_PATCHED_VERSION);
    } catch {
      return false;
    }
  });
  return (
    constraintsArePatched &&
    gte(installed?.version ?? "0.0.0", ESBUILD_PATCHED_VERSION)
  );
}

/**
 * Migration: relocate project-specific exclusions from `audit.ignore.config.json`
 * (Lisa-owned, copy-overwrite) into `audit.ignore.local.json` (project-owned,
 * create-only) so they survive future Lisa postinstall runs.
 *
 * Without this migration, projects that add transient-dependency exclusions to
 * the Lisa-owned config see them silently stripped every install, producing
 * noisy diffs and tempting users to commit the regression.
 *
 * Mirrors the shape of `EnsureTsconfigLocalIncludesMigration`:
 *   - `beforeStrategies` snapshots the project's pre-strategy exclusions that
 *     are not in the Lisa template (i.e., project-specific additions).
 *   - `apply` (post-strategy) writes any snapshotted exclusions missing from
 *     `audit.ignore.local.json` into that file.
 */
export class EnsureAuditIgnoreLocalExclusionsMigration implements Migration {
  readonly name = "ensure-audit-ignore-local-exclusions";
  readonly description =
    "Relocate project-specific audit exclusions from audit.ignore.config.json into audit.ignore.local.json";

  private snapshot: readonly Exclusion[] = [];

  /**
   * Snapshot project-specific exclusions that would otherwise be stripped by
   * the copy-overwrite strategy. An exclusion is "project-specific" when its
   * `id` is present in the project's audit.ignore.config.json but absent from
   * the Lisa template for the same project type.
   *
   * When no valid Lisa template can be found for the detected project type the
   * method returns without snapshotting anything. This is intentionally
   * conservative: without a template we cannot distinguish Lisa-owned from
   * project-specific exclusions, so migrating could copy Lisa-owned entries
   * into audit.ignore.local.json.
   * @param ctx - Migration context
   */
  async beforeStrategies(ctx: MigrationContext): Promise<void> {
    this.snapshot = [];

    const projectConfigPath = path.join(ctx.projectDir, AUDIT_CONFIG);
    const projectConfig =
      await readJsonOrNull<AuditIgnoreLike>(projectConfigPath);
    if (!projectConfig || !Array.isArray(projectConfig.exclusions)) {
      return;
    }

    const templatePath = await findTemplateConfigPath(
      ctx.lisaDir,
      ctx.detectedTypes
    );
    const template = templatePath
      ? await readJsonOrNull<AuditIgnoreLike>(templatePath)
      : null;

    if (!template) {
      return;
    }

    const templateIds = collectIds(template);

    const projectSpecific = projectConfig.exclusions.filter(entry => {
      if (typeof entry.id !== "string" || entry.id.length === 0) {
        return false;
      }
      return !templateIds.has(entry.id);
    });

    this.snapshot = projectSpecific;
  }

  /**
   * The migration applies when at least one snapshotted project-specific
   * exclusion is missing from `audit.ignore.local.json`.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const localPath = path.join(ctx.projectDir, AUDIT_LOCAL);
    const local = await readLocalJson<AuditIgnoreLike>(localPath);
    const patchedEsbuild = await hasPatchedEsbuild(ctx.projectDir);
    if (
      patchedEsbuild &&
      local?.exclusions?.some(entry => entry.id === ESBUILD_ADVISORY)
    ) {
      return true;
    }
    const snapshot = patchedEsbuild
      ? this.snapshot.filter(entry => entry.id !== ESBUILD_ADVISORY)
      : this.snapshot;
    if (snapshot.length === 0) {
      return false;
    }
    const localIds = collectIds(local);
    return snapshot.some(entry => {
      const id = entry.id;
      return typeof id === "string" && !localIds.has(id);
    });
  }

  /**
   * Merge snapshotted project-specific exclusions into audit.ignore.local.json,
   * skipping any whose id is already present. Deduplicates within the snapshot
   * itself so that duplicate source entries are only written once.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const localPath = path.join(ctx.projectDir, AUDIT_LOCAL);
    const local = await readLocalJson<AuditIgnoreLike>(localPath);
    const existing = Array.isArray(local?.exclusions) ? local.exclusions : [];
    const patchedEsbuild = await hasPatchedEsbuild(ctx.projectDir);
    const retained = patchedEsbuild
      ? existing.filter(entry => entry.id !== ESBUILD_ADVISORY)
      : existing;
    const removed = existing.length - retained.length;
    const localIds = collectIds({ exclusions: retained });

    const seenIds = new Set(localIds);
    const additions = this.snapshot.filter(entry => {
      const id = entry.id;
      if (
        typeof id !== "string" ||
        seenIds.has(id) ||
        (patchedEsbuild && id === ESBUILD_ADVISORY)
      ) {
        return false;
      }
      seenIds.add(id);
      return true;
    });

    if (additions.length === 0 && removed === 0) {
      return { name: this.name, action: "noop" };
    }

    const merged: AuditIgnoreLike = {
      ...(local ?? {}),
      exclusions: [...retained, ...additions],
    };

    const addedIds = additions
      .map(entry => entry.id)
      .filter((id): id is string => typeof id === "string");
    const actions = [
      additions.length > 0
        ? `relocated ${additions.length} exclusion(s) (${addedIds.join(", ")})`
        : "",
      removed > 0 ? `removed ${removed} patched esbuild exclusion(s)` : "",
    ].filter(Boolean);
    const message = `${actions.join(" and ")} in audit.ignore.local.json`;

    if (ctx.dryRun) {
      ctx.logger.dry(`Would ${actions.join(" and ")}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [AUDIT_LOCAL],
        message,
      };
    }

    await fse.ensureDir(path.dirname(localPath));
    await writeJson(localPath, merged);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [AUDIT_LOCAL],
      message,
    };
  }
}
