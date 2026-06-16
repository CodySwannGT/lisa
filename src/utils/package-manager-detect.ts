/**
 * @file package-manager-detect.ts
 * @description Package-manager detection + lockfile-regen plans shared by the
 * postinstall reconciliation trampoline. Split out from postinstall-trampoline
 * so the detection surface (which manager a project actually uses, and which it
 * explicitly forbids via `engines`) lives in one cohesive, well-tested module.
 * @module utils
 */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

/**
 * Known package managers whose lockfiles must be regenerated when Lisa's apply
 * mutates package.json (e.g., adds/updates resolutions or overrides entries).
 */
export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

/**
 * Description of a package manager's lockfile file + the command Lisa should run
 * to rebuild the lockfile without running install scripts.
 */
export interface LockfileRegenPlan {
  readonly pm: PackageManager;
  readonly lockfile: string;
  /** Additional lockfile names for the same PM (e.g. bun.lockb for bun). */
  readonly lockfileAlternatives?: readonly string[];
  readonly command: string;
  readonly args: readonly string[];
}

const INSTALL = "install";
const IGNORE_SCRIPTS = "--ignore-scripts";

/**
 * Per-PM lockfile + regen command mapping. The regen commands are all
 * "sync lockfile without running scripts" variants — we do NOT want to
 * re-run lifecycle scripts (that would re-trigger the trampoline).
 *
 * bun: `bun install` is the canonical way to sync bun.lock after package.json
 * changes. As of bun 1.x there is no `--lockfile-only` flag; `bun install`
 * is already fast when node_modules is up-to-date and will simply update
 * bun.lock to match package.json. We pass `--ignore-scripts` to avoid re-running
 * the parent PM's lifecycle hooks (which triggered this trampoline to begin with).
 */
export const LOCKFILE_REGEN_PLANS: Readonly<
  Record<PackageManager, LockfileRegenPlan>
> = {
  bun: {
    pm: "bun",
    lockfile: "bun.lock",
    lockfileAlternatives: ["bun.lockb"],
    command: "bun",
    args: [INSTALL, IGNORE_SCRIPTS],
  },
  npm: {
    pm: "npm",
    lockfile: "package-lock.json",
    command: "npm",
    args: [INSTALL, "--package-lock-only", IGNORE_SCRIPTS],
  },
  pnpm: {
    pm: "pnpm",
    lockfile: "pnpm-lock.yaml",
    command: "pnpm",
    args: [INSTALL, "--lockfile-only", IGNORE_SCRIPTS],
  },
  yarn: {
    pm: "yarn",
    lockfile: "yarn.lock",
    command: "yarn",
    args: [INSTALL, "--mode", "update-lockfile"],
  },
} as const;

/**
 * Read the set of package managers a project explicitly opts OUT of via its
 * package.json `engines` field. The repo-wide convention is to pin an unwanted
 * package manager to a sentinel string such as `"please-use-npm"` (e.g. an
 * npm-only project sets `engines.bun = "please-use-npm"`). Such a manager must
 * never have its lockfile regenerated — even if a stray lockfile for it is
 * present — because doing so re-creates the stray lockfile via that manager's
 * `install`. That is the SE-5221 regression: a stray `bun.lock` in an npm-only
 * project kept alive by `bun install`, which then misroutes the pre-push hook's
 * package-manager detection to the bun branch.
 * @param projectDir - Absolute path to the project directory
 * @returns Set of package managers the project forbids (possibly empty)
 */
export function enginesForbiddenManagers(
  projectDir: string
): ReadonlySet<PackageManager> {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(projectDir, "package.json"), "utf8")
    ) as { readonly engines?: Record<string, unknown> };
    const engines = pkg.engines ?? {};
    const managers = ["bun", "npm", "yarn", "pnpm"] as const;
    return new Set(
      managers.filter(pm => {
        const value = engines[pm];
        return (
          typeof value === "string" && /please-use|do-not-use/i.test(value)
        );
      })
    );
  } catch {
    // No package.json, or it is unreadable/invalid — nothing is forbidden.
    return new Set();
  }
}

/**
 * Detect which package managers the project uses based on lockfile presence,
 * excluding any manager the project explicitly forbids via `engines`.
 *
 * A project may have more than one lockfile (the CDK dual-lockfile pattern
 * keeps `bun.lock` for local dev while publishing `package-lock.json` for
 * consumers), in which case every present lockfile must be regenerated so both
 * stay in sync with package.json.
 *
 * Managers opted out via an `engines` sentinel (e.g. `bun = "please-use-npm"`)
 * are dropped even when their lockfile is present, so the reconciliation never
 * re-creates a stray lockfile the project deliberately disallows (SE-5221).
 * @param projectDir - Absolute path to the project directory
 * @returns Ordered list of detected package managers (possibly empty)
 */
export function detectPackageManagers(
  projectDir: string
): readonly PackageManager[] {
  const forbidden = enginesForbiddenManagers(projectDir);
  return Object.values(LOCKFILE_REGEN_PLANS)
    .filter(plan =>
      [plan.lockfile, ...(plan.lockfileAlternatives ?? [])].some(f =>
        existsSync(path.join(projectDir, f))
      )
    )
    .map(plan => plan.pm)
    .filter(pm => !forbidden.has(pm));
}

/**
 * Get the regen plan (command/args/lockfile) for a given package manager.
 * @param pm - Package manager to look up
 * @returns Regen plan describing which command to spawn
 */
export function getLockfileRegenPlan(pm: PackageManager): LockfileRegenPlan {
  return LOCKFILE_REGEN_PLANS[pm];
}
