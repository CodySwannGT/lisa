/**
 * @file process-environment.ts
 * @description The one sanctioned read of the process environment in Lisa's
 * own source.
 *
 * Application code is meant to reach configuration through one place rather
 * than reading `process.env` wherever it is convenient — that is the intent of
 * the `no-restricted-syntax` ban the TypeScript profile ships. Lisa is a CLI
 * and a set of config factories with no config service, and the environment
 * genuinely is their input (CI fingerprints, agent-runtime ids, package-manager
 * lifecycle variables). So every read and write goes through these functions,
 * each call explicit and greppable, and Lisa's lint (`eslint.config.local.ts`)
 * refuses every other direct route — `process.env` (plain, computed or through
 * `globalThis`), the `env` export of `node:process`, a renamed or namespace
 * import of it, and destructuring.
 *
 * Both read `process.env` at call time, never at import: a host whose test
 * setup reassigns `process.env = {...}` is read correctly afterwards.
 * @module utils
 */

/**
 * Reads one environment variable now.
 * @param name - Variable name
 * @returns Its current value, or undefined when unset
 */
export function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * The process environment object as it is now: for handing a whole
 * environment to a child process, a resolver, or a settings reader, and for
 * the few CLI entry points that set variables their payload inherits.
 * @returns The current `process.env` object (live, not a copy)
 */
export function currentEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

/**
 * Sets or removes one variable in this process's environment, for the CLI
 * entry points whose own later reads (`os.tmpdir()`) and spawned payload must
 * see the change. Every write to the environment goes through here.
 * @param name - Variable name
 * @param value - New value, or undefined to remove the variable
 */
export function writeEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
