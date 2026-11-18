/**
 * Fit a forced `devEngines.packageManager` floor to the host's package manager
 * (CodySwannGT/lisa#4848).
 *
 * A template may force a package-manager floor such as the CDK template's npm
 * floor (#4793). `actions/setup-node` reads `devEngines.packageManager` and
 * turns on that manager's dependency cache. On a host that uses a different
 * manager, the step then fails because it cannot find that manager's
 * lockfile. Because the key is forced, the host could not remove it for good.
 *
 * When the host has neither a `packageManager` field nor a lockfile, the
 * manager running this apply (`npm_config_user_agent`, as `bunx` or `npx`
 * set it) decides (CodySwannGT/lisa#4941). Without it, a fresh host adopted
 * through `bunx` received the npm floor and lost it on the next apply, once
 * `bun install` had written `bun.lock`.
 *
 * The floor stays in place when the host's manager is still unknown, so a new
 * project still gets it. It is dropped only when the host clearly uses a
 * different manager. A copy Lisa wrote on an earlier apply is then removed,
 * and a value the host wrote itself is left alone.
 * @module strategies/package-lisa-dev-engines
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { ResolvedPackageLisaTemplate } from "./package-lisa-types.js";

/**
 * Lockfiles in the order they are checked. An npm lockfile comes first, so a
 * stray lockfile from another manager does not override real npm use.
 */
const LOCKFILES: readonly (readonly [string, string])[] = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
];

/** A template whose forced floor now fits the host. */
export interface FittedDevEngines {
  /** The template to apply. */
  readonly template: ResolvedPackageLisaTemplate;
  /** True when the host still has the floor Lisa wrote and it must go. */
  readonly retire: boolean;
}

/** A package manager named by the process that invoked Lisa. */
export interface InvokingPackageManager {
  /** `bun`, `npm`, `pnpm` or `yarn`. */
  readonly name: string;
  /** Its version, as the user agent reports it. */
  readonly version: string;
}

/**
 * The first product token of a package manager's user agent, e.g.
 * `bun/1.4.4 npm/? node/v24.21.0 darwin arm64`: a known manager name, a
 * slash, and a version that starts with a digit. Anything else is not a
 * manager's user agent and says nothing.
 */
const USER_AGENT =
  /^(bun|npm|pnpm|yarn)\/(\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.+-]+)?)(?:\s|$)/u;

/**
 * Read the package manager that invoked this process from its user agent.
 * @param userAgent - `npm_config_user_agent`, when the process has one
 * @returns The manager and version, or undefined when it names none
 */
export function parseInvokingPackageManager(
  userAgent: string | undefined
): InvokingPackageManager | undefined {
  const match = USER_AGENT.exec(userAgent?.trim() ?? "");
  return match === null
    ? undefined
    : { name: match[1] ?? "", version: match[2] ?? "" };
}

/**
 * Work out which package manager the host uses: its `packageManager` field,
 * else its lockfile, else the manager running this apply.
 * @param projectDir - Host directory, or undefined when no tree is available
 * @param projectJson - Host package.json
 * @param invoking - Manager that invoked this apply, when one did
 * @returns The manager name, or undefined when nothing says
 */
export function detectHostPackageManager(
  projectDir: string | undefined,
  projectJson: Readonly<Record<string, unknown>>,
  invoking?: string
): string | undefined {
  const field = projectJson.packageManager;
  if (typeof field === "string" && field.trim() !== "")
    return field.split("@")[0];
  const locked =
    projectDir === undefined
      ? undefined
      : LOCKFILES.find(([file]) =>
          existsSync(path.join(projectDir, file))
        )?.[1];
  return locked ?? invoking;
}

/**
 * Read `devEngines.packageManager` from a manifest section.
 * @param section - A force section or a package.json
 * @returns The value, or undefined
 */
function packageManagerFloor(
  section: Readonly<Record<string, unknown>>
): unknown {
  const devEngines = section.devEngines;
  if (devEngines === null || typeof devEngines !== "object") return undefined;
  return (devEngines as Record<string, unknown>).packageManager;
}

/**
 * Drop a forced package-manager floor that names a manager the host does not use.
 * @param template - Merged template
 * @param hostManager - The host's manager, or undefined when unknown
 * @param projectJson - Host package.json before this apply
 * @returns The template to apply, and whether to remove Lisa's earlier copy
 */
export function fitDevEnginesToHost(
  template: ResolvedPackageLisaTemplate,
  hostManager: string | undefined,
  projectJson: Readonly<Record<string, unknown>>
): FittedDevEngines {
  const floor = packageManagerFloor(template.force);
  const named =
    floor !== null && typeof floor === "object"
      ? (floor as Record<string, unknown>).name
      : undefined;
  if (hostManager === undefined || named === undefined || named === hostManager)
    return { template, retire: false };

  return {
    template: { ...template, force: withoutFloor(template.force) },
    retire: canonical(packageManagerFloor(projectJson)) === canonical(floor),
  };
}

/**
 * Serialise a JSON value with object keys sorted, so two equal values compare
 * equal whatever order their keys were written in.
 * @param value - JSON value
 * @returns Canonical JSON text
 */
function canonical(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b)
          )
        )
      : inner
  );
}

/**
 * Copy an object without one key.
 * @param source - Object to copy
 * @param key - Key to leave out
 * @returns The copy
 */
function omit(
  source: Readonly<Record<string, unknown>>,
  key: string
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([name]) => name !== key)
  );
}

/**
 * Copy a manifest section without `devEngines.packageManager`, dropping
 * `devEngines` when nothing else is left in it.
 * @param section - A force section or a package.json
 * @returns The copy
 */
function withoutFloor(
  section: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const devEngines = section.devEngines;
  if (devEngines === null || typeof devEngines !== "object") return section;
  const rest = omit(devEngines as Record<string, unknown>, "packageManager");
  return Object.keys(rest).length === 0
    ? omit(section, "devEngines")
    : { ...section, devEngines: rest };
}

/**
 * Remove the floor Lisa wrote earlier, dropping `devEngines` if nothing is left.
 * @param packageJson - Planned package.json
 * @returns package.json without the retired floor
 */
export function retireDevEnginesFloor(
  packageJson: Record<string, unknown>
): Record<string, unknown> {
  return withoutFloor(packageJson);
}
