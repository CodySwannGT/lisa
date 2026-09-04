import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { LISA_PACKAGE_NAME } from "../core/self-apply.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const PACKAGE_JSON = "package.json";
const CI_GUARD_PREFIX = '[ -n "$CI" ] || ';
const BOOTSTRAP_PREFIX = "LISA_BOOTSTRAP=1 ";
const LEGACY_LISA_MARKER = "node_modules/@codyswann/lisa/dist/index.js";
const POSTINSTALL_RUNNER_MARKER =
  "node_modules/@codyswann/lisa/all/copy-overwrite/scripts/lisa-postinstall.mjs";

/**
 * The bootstrap invocation chained into a host project's `postinstall`.
 *
 * Shape: bounded, loud, durable, and deliberately non-fatal. The runner owns
 * the timeout, exposes the real error, and records a marker for `lisa doctor`;
 * `|| true` keeps a template failure from stranding the host before it can
 * install the fix. This is the same invocation the package template writes,
 * so a migration cannot leave older callers on the superseded direct apply.
 *
 * Exported so tests can execute the real script under `sh` rather than assert
 * on a string.
 */
export const LISA_INVOCATION = `${CI_GUARD_PREFIX}${BOOTSTRAP_PREFIX}node ${POSTINSTALL_RUNNER_MARKER} || true`;

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
 * Every historical spelling of the Lisa invocation, so an in-place upgrade
 * replaces it rather than chaining a second copy in front of it.
 *
 * The optional tail covers, in order: the failure-swallowing legacy form
 * (`2>/dev/null || true`), the loud-but-still-exit-0 form
 * (`|| echo "..." >&2`, CodySwannGT/lisa#3466), the current loud-and-fatal form
 * (`|| { echo "..." >&2; exit 1; }`), and a bare invocation with no tail at
 * all. Guard prefixes are optional and repeatable because older Lisa versions
 * introduced them one at a time — `LISA_POSTINSTALL=1` being the newest
 * (CodySwannGT/lisa#3066).
 *
 * **Every alternative here is permanent.** There is no cutover date: this text
 * lives in the consumer's own repository, and nothing updates it until an
 * apply runs — an apply that only rewrites it if this pattern matched it
 * first. A miss does not fail, it CHAINS a second invocation in front of the
 * old one, so the project quietly runs two applies per install and every
 * instrument reads normal (the CodySwannGT/lisa#3050 shape). A project that
 * never re-applies keeps its old spelling forever, which is why an old
 * alternative may never be removed.
 */
const LEGACY_LISA_INVOCATION_RE = new RegExp(
  '(?:(?:\\[ -n "\\$CI" \\] \\|\\| )|(?:LISA_BOOTSTRAP=1 )|(?:LISA_POSTINSTALL=1 ))*' +
    "node node_modules/@codyswann/lisa/dist/index\\.js --yes --skip-git-check \\." +
    "(?: 2>/dev/null \\|\\| true" +
    '| \\|\\| \\{ echo "[^"]*" >&2; exit 1; \\}' +
    '| \\|\\| echo "[^"]*" >&2)?'
);

/** The bounded runner spelling currently written by Lisa. */
const POSTINSTALL_RUNNER_RE = new RegExp(
  '(?:(?:\\[ -n "\\$CI" \\] \\|\\| )|(?:LISA_BOOTSTRAP=1 ))*' +
    "node node_modules/@codyswann/lisa/all/copy-overwrite/scripts/" +
    "lisa-postinstall\\.mjs(?: \\|\\| true)?"
);

/**
 * Compose the new postinstall, prepending the Lisa invocation to any existing command.
 * If the existing script already contains a legacy Lisa invocation (no CI guard),
 * replace it in place with the guarded invocation rather than duplicating it.
 * @param existing - Existing postinstall script (may be undefined)
 * @returns The composed postinstall script
 */
function composePostinstall(existing: string | undefined): string {
  const trimmed = existing?.trim();
  if (!trimmed) {
    return LISA_INVOCATION;
  }
  if (trimmed.includes(POSTINSTALL_RUNNER_MARKER)) {
    return trimmed.replace(POSTINSTALL_RUNNER_RE, LISA_INVOCATION);
  }
  if (trimmed.includes(LEGACY_LISA_MARKER)) {
    return trimmed.replace(LEGACY_LISA_INVOCATION_RE, LISA_INVOCATION);
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
 * (expo) and acmeorga/frontend (typescript-only) both needed this chained invocation.
 * This migration prepends the standard Lisa invocation so template updates apply
 * automatically on install. Rails-only projects are skipped (no Node postinstall).
 */
export class EnsureLisaPostinstallMigration implements Migration {
  readonly name = "ensure-lisa-postinstall";
  readonly description =
    "Ensure Node-based projects run Lisa in their postinstall script";

  /**
   * Check whether this migration should run on the project
   *
   * Primary path: Node project types (typescript, expo, nestjs, cdk, npm-package)
   * with a package.json whose postinstall lacks the CI-guarded Lisa invocation.
   *
   * Fallback path: non-Node projects (e.g. Rails-only) that nevertheless ship a
   * package.json containing a legacy Lisa postinstall (unguarded). These were
   * written by an older Lisa version before the CI guard existed and still need
   * an upgrade. Projects without a package.json are untouched.
   * @param ctx - Migration context
   * @returns True when a Node project is missing the Lisa invocation in postinstall,
   *   or when a non-Node project has an unguarded legacy Lisa postinstall
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const pkg = await readPackageJson(ctx.projectDir);
    if (!pkg) {
      return false;
    }
    // Never chain the bootstrap invocation into Lisa's own package.json — a
    // self-apply against the source repo must not inject the postinstall force
    // script (it would make Lisa re-apply itself on every install).
    if (pkg.name === LISA_PACKAGE_NAME) {
      return false;
    }
    const postinstall = pkg.scripts?.postinstall;
    if (!postinstall) {
      return hasNodePostinstallType(ctx.detectedTypes);
    }
    const normalizedPostinstall = composePostinstall(postinstall);
    if (!hasNodePostinstallType(ctx.detectedTypes)) {
      return (
        (postinstall.includes(LEGACY_LISA_MARKER) ||
          postinstall.includes(POSTINSTALL_RUNNER_MARKER)) &&
        normalizedPostinstall !== postinstall
      );
    }
    return normalizedPostinstall !== postinstall;
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
