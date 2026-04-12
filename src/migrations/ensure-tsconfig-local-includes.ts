import * as path from "node:path";
import * as fse from "fs-extra";
import type { ProjectType } from "../core/config.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const TSCONFIG_LOCAL = "tsconfig.local.json";

/**
 * Minimal shape of a tsconfig.local.json file for include/exclude manipulation
 */
interface TsconfigLocal {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * Pair of include/exclude arrays sourced from a Lisa template
 */
interface IncludeExcludeDefaults {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
}

/**
 * Preferred order of project types for sourcing include/exclude defaults.
 * The first type in detectedTypes matching this list is used.
 */
const TEMPLATE_PRIORITY: readonly ProjectType[] = [
  "expo",
  "cdk",
  "nestjs",
  "npm-package",
  "typescript",
];

/**
 * Fallback defaults when the template file cannot be read (matches typescript/create-only)
 */
const FALLBACK_DEFAULTS: IncludeExcludeDefaults = {
  include: ["src/**/*"],
  exclude: ["node_modules", ".build", "dist", "**/*.test.ts", "**/*.spec.ts"],
};

/**
 * Return the template project type to read defaults from, or null if none applies
 * @param detectedTypes - Detected project types for the destination project
 * @returns The highest-priority matching project type, or null when none match
 */
function pickTemplateType(
  detectedTypes: readonly ProjectType[]
): ProjectType | null {
  for (const type of TEMPLATE_PRIORITY) {
    if (detectedTypes.includes(type)) {
      return type;
    }
  }
  return null;
}

/**
 * Load include/exclude defaults from a Lisa template tsconfig.local.json
 * @param lisaDir - Lisa installation directory
 * @param type - Project type whose template to read
 * @returns The template's include/exclude, or the fallback defaults when absent
 */
async function loadTemplateDefaults(
  lisaDir: string,
  type: ProjectType
): Promise<IncludeExcludeDefaults> {
  const templatePath = path.join(lisaDir, type, "create-only", TSCONFIG_LOCAL);
  const template = await readJsonOrNull<TsconfigLocal>(templatePath);
  if (!template) {
    return FALLBACK_DEFAULTS;
  }
  return {
    include: template.include ?? FALLBACK_DEFAULTS.include,
    exclude: template.exclude ?? FALLBACK_DEFAULTS.exclude,
  };
}

/**
 * Migration: backfill missing include/exclude in existing tsconfig.local.json files.
 *
 * Before PR #373, include/exclude lived in tsconfig.json. After they moved to
 * tsconfig.local.json (create-only), existing projects kept their include-less local
 * tsconfig and typecheck began compiling tests, worktrees, etc. This migration injects
 * the canonical defaults for any key that is missing without touching existing values.
 */
export class EnsureTsconfigLocalIncludesMigration implements Migration {
  readonly name = "ensure-tsconfig-local-includes";
  readonly description =
    "Backfill include/exclude in tsconfig.local.json for projects upgraded past PR #373";

  /**
   * Check whether this migration should run on the project
   * @param ctx - Migration context
   * @returns True when tsconfig.local.json exists but is missing include or exclude
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const tsconfigLocalPath = path.join(ctx.projectDir, TSCONFIG_LOCAL);
    const existing = await readJsonOrNull<TsconfigLocal>(tsconfigLocalPath);
    if (!existing) {
      return false;
    }
    return existing.include === undefined || existing.exclude === undefined;
  }

  /**
   * Apply the migration, injecting any missing include/exclude keys
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const tsconfigLocalPath = path.join(ctx.projectDir, TSCONFIG_LOCAL);
    const existing = await readJsonOrNull<TsconfigLocal>(tsconfigLocalPath);
    if (!existing) {
      return { name: this.name, action: "noop" };
    }

    const templateType = pickTemplateType(ctx.detectedTypes);
    const defaults = templateType
      ? await loadTemplateDefaults(ctx.lisaDir, templateType)
      : FALLBACK_DEFAULTS;

    const patched: TsconfigLocal = {
      ...existing,
      ...(existing.include === undefined ? { include: defaults.include } : {}),
      ...(existing.exclude === undefined ? { exclude: defaults.exclude } : {}),
    };

    const missing: readonly string[] = [
      ...(existing.include === undefined ? ["include"] : []),
      ...(existing.exclude === undefined ? ["exclude"] : []),
    ];

    if (missing.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const message = `Injected ${missing.join(", ")} into tsconfig.local.json`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update tsconfig.local.json: ${missing.join(", ")}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [TSCONFIG_LOCAL],
        message,
      };
    }

    await fse.ensureDir(path.dirname(tsconfigLocalPath));
    await writeJson(tsconfigLocalPath, patched);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [TSCONFIG_LOCAL],
      message,
    };
  }
}
