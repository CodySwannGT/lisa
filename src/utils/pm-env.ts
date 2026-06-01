/**
 * @file pm-env.ts
 * @description Package-manager environment sanitization for the postinstall
 * reconciliation trampoline.
 *
 * When Lisa's postinstall schedules a detached reconciliation child (and that
 * child in turn spawns `bun install` / a Lisa re-invocation), the child must
 * resolve its target project STRICTLY from the explicit `cwd` / projectDir
 * argument — never from package-manager-injected environment variables that pin
 * the package manager to a different project. This module centralizes the list
 * of those dangerous variables and the function that strips them.
 * @module utils
 */

/**
 * Package-manager-injected environment variable PREFIXES that pin a package
 * manager to a project directory OTHER than the one it is being told to operate
 * on via `cwd` / the positional argument.
 *
 * We scrub the whole `npm_config_*` / `npm_package_*` / `npm_lifecycle_*`
 * families rather than enumerating individual keys, because any one of them can
 * leak a stale project path and new ones appear across package-manager versions.
 */
export const PM_PATH_ENV_PREFIXES: readonly string[] = [
  "npm_config_",
  "npm_package_",
  "npm_lifecycle_",
] as const;

/**
 * Standalone package-manager-injected environment variable NAMES that, like the
 * prefixed families, can redirect a re-spawned package manager to a sibling
 * project. `INIT_CWD` is the classic one; `npm_config_local_prefix` (covered by
 * the prefix list above) is the most dangerous, because Lisa's own postinstall
 * script derives `PROJECT_ROOT` from it and bun/npm honour it over `cwd`.
 */
export const PM_PATH_ENV_NAMES: readonly string[] = [
  "INIT_CWD",
  "npm_node_execpath",
  "npm_execpath",
  "PROJECT_CWD",
  "BUN_INSTALL_CACHE_DIR",
] as const;

/**
 * Decide whether a single environment variable name is a package-manager
 * path/lifecycle variable that must be stripped before a reconciliation re-run.
 * @param key - Environment variable name
 * @returns true when the variable could redirect a re-spawned package manager
 */
export function isPackageManagerPathEnvVar(key: string): boolean {
  if (PM_PATH_ENV_NAMES.includes(key)) {
    return true;
  }
  return PM_PATH_ENV_PREFIXES.some(prefix => key.startsWith(prefix));
}

/**
 * Strip every package-manager-injected variable that could redirect a re-spawned
 * package manager (or Lisa re-invocation) away from the explicit target directory.
 *
 * Returns a NEW object — the input is not mutated. Used both for the detached
 * trampoline child's environment and as the source of truth the inline
 * trampoline script reuses to scrub the environment of the `bun install` / Lisa
 * processes it spawns.
 *
 * Background: during a batched concurrent multi-project Lisa update, the
 * detached reconciliation child inherited `npm_config_local_prefix` / `INIT_CWD`
 * pointing at a SIBLING project. bun/npm honour `npm_config_local_prefix` (and
 * Lisa's postinstall script reads it as `PROJECT_ROOT`) over `cwd`, so the
 * re-run + its `bun install` resolved to the wrong project, writing one
 * project's package.json into another. Stripping these vars makes the
 * reconciliation path strictly project-local.
 * @param env - Source environment (typically a copy of process.env)
 * @returns A copy of env with all package-manager path/lifecycle vars removed
 */
export function sanitizeEnvForReconciliation(
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !isPackageManagerPathEnvVar(key))
  );
}
