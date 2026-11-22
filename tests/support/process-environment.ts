/**
 * The one accessor test harnesses use for the environment of the process
 * running the suite.
 *
 * Application code is barred from reading `process.env` directly and goes
 * through a configuration service instead. A test harness has no such service:
 * when it spawns a real child (a hook, a CLI, a provisioner) the child must
 * inherit the installed toolchain the suite itself runs under. Routing every
 * harness through this function keeps that inheritance in one reviewed place,
 * under `tests/support/`, where the project's lint configuration already
 * permits it, instead of scattering direct reads across helper modules.
 * @module tests/support/process-environment
 */

/**
 * Snapshot the environment the suite is running under.
 *
 * A copy, so a harness that adds or overrides keys for its child can never
 * change the environment of the suite or of a sibling test.
 * @returns A fresh copy of the current process environment
 */
export function inheritedEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env };
}
