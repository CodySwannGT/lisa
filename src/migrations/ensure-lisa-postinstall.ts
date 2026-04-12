import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const PACKAGE_JSON = "package.json";
const LISA_INVOCATION =
  "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true";
const LISA_MARKER = "node_modules/@codyswann/lisa/dist/index.js";

/**
 * Project types that do not use Node.js postinstall hooks (e.g. Rails).
 * Projects detected as only these types are skipped by this migration.
 */
const NON_NODE_TYPES: readonly ProjectType[] = ["rails"];

/**
 * Minimal shape of a project's package.json for postinstall manipulation
 */
interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

/**
 * Read package.json, returning null if missing
 * @param projectDir - Project directory containing package.json
 * @returns Parsed package.json or null when absent/invalid
 */
async function readPackageJson(
  projectDir: string
): Promise<PackageJson | null> {
  return readJsonOrNull<PackageJson>(path.join(projectDir, PACKAGE_JSON));
}

/**
 * Compose the new postinstall, prepending the Lisa invocation to any existing command
 * @param existing - Existing postinstall script (may be undefined)
 * @returns The composed postinstall script
 */
function composePostinstall(existing: string | undefined): string {
  const trimmed = existing?.trim();
  if (!trimmed) {
    return LISA_INVOCATION;
  }
  return `${LISA_INVOCATION} && ${trimmed}`;
}

/**
 * Determine whether the detected types indicate a Node.js project that should
 * run Lisa via postinstall. Rails-only projects are excluded; any Node stack
 * (typescript, expo, nestjs, cdk, npm-package) qualifies.
 * @param detectedTypes - Detected project types for the destination
 * @returns True when at least one detected type uses Node postinstall hooks
 */
function hasNodePostinstallType(
  detectedTypes: readonly ProjectType[]
): boolean {
  if (detectedTypes.length === 0) {
    return false;
  }
  return detectedTypes.some(type => !NON_NODE_TYPES.includes(type));
}

/**
 * Migration: ensure Node-based projects chain Lisa into their postinstall script.
 *
 * Any TypeScript/Node project (expo, nestjs, cdk, npm-package, plain typescript) with a
 * custom postinstall (`patch-package && ...`) that never invokes Lisa will not apply
 * template updates automatically on `bun install` / `npm install`. Evidence: frontend-v2
 * (expo) and propswap/frontend (typescript-only) both needed this chained invocation.
 * This migration prepends the standard Lisa invocation so template updates apply
 * automatically on install. Rails-only projects are skipped (no Node postinstall).
 */
export class EnsureLisaPostinstallMigration implements Migration {
  readonly name = "ensure-lisa-postinstall";
  readonly description =
    "Ensure Node-based projects run Lisa in their postinstall script";

  /**
   * Check whether this migration should run on the project
   * @param ctx - Migration context
   * @returns True when a Node project is missing the Lisa invocation in postinstall
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    if (!hasNodePostinstallType(ctx.detectedTypes)) {
      return false;
    }
    const pkg = await readPackageJson(ctx.projectDir);
    if (!pkg) {
      return false;
    }
    const postinstall = pkg.scripts?.postinstall;
    if (postinstall && postinstall.includes(LISA_MARKER)) {
      return false;
    }
    return true;
  }

  /**
   * Apply the migration, prepending the Lisa invocation to the project's postinstall
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const pkgPath = path.join(ctx.projectDir, PACKAGE_JSON);
    const pkg = await readPackageJson(ctx.projectDir);
    if (!pkg) {
      return { name: this.name, action: "noop" };
    }

    const currentScripts = pkg.scripts ?? {};
    const newPostinstall = composePostinstall(currentScripts.postinstall);
    const nextPkg: PackageJson = {
      ...pkg,
      scripts: { ...currentScripts, postinstall: newPostinstall },
    };

    const message = currentScripts.postinstall
      ? `Chained Lisa into existing postinstall: ${newPostinstall}`
      : `Set postinstall to Lisa invocation: ${newPostinstall}`;

    if (ctx.dryRun) {
      ctx.logger.dry(`Would update package.json scripts.postinstall`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [PACKAGE_JSON],
        message,
      };
    }

    await writeJson(pkgPath, nextPkg);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [PACKAGE_JSON],
      message,
    };
  }
}
