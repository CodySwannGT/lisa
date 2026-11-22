/**
 * The harness-parity council's one read of the process environment. The council
 * runs as standalone node scripts that cannot import Lisa's src/ TypeScript,
 * so every council module imports this instead, and Lisa's lint allows the
 * read in this file alone.
 * @module council-environment
 */

/**
 * Read council environment values without assuming a Node global exists.
 * @returns {NodeJS.ProcessEnv} Process environment values when available.
 */
export function councilEnvironment() {
  return globalThis.process?.env ?? {};
}
