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
 * lifecycle variables). So the environment comes from here: every module that
 * needs it imports this binding, and Lisa's lint (`eslint.config.local.ts`)
 * refuses every other route — `process.env`, the `env` export of
 * `node:process`, a renamed or namespace import of it, and destructuring.
 *
 * It is the live object, not a snapshot: a variable set after start-up is
 * visible, exactly as it was through `process.env`.
 * @module utils
 */
import { env } from "node:process";

/** The live process environment. */
export const processEnvironment: NodeJS.ProcessEnv = env;
