#!/usr/bin/env node
/**
 * Surface definitions and configuration for `lisa-secrets-access`.
 *
 * A *provider* is where secrets live. A *surface* is where the running code
 * lives, and it determines how secrets reach that code. These are independent
 * axes: the same Bitwarden project serves a laptop, a CI runner, and a remote
 * agent container, but each of the three obtains its values differently.
 *
 * Surfaces are declared by capability rather than by name so adding one is a
 * single entry here rather than a new branch in every consumer. That is the
 * whole reason this table exists.
 * @module surfaces
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Capabilities, per surface.
 *
 * `materialized` — the surface obtains values from files written before the
 * code ran, so the resolver must consult them.
 *
 * `mayWriteValues` — the surface is permitted to write resolved values to
 * disk. This is normally forbidden, because a value on disk is a copy that can
 * drift and leak. It is *required* on surfaces whose bootstrap runs before the
 * consuming process exists and which therefore have no other channel; a remote
 * agent container prepares itself during setup, long before any task starts.
 */
export const SURFACES = {
  local: { materialized: false, mayWriteValues: false },
  "github-actions": { materialized: false, mayWriteValues: false },
  "codex-cloud": { materialized: true, mayWriteValues: true },
};

/** Config defaults when `.lisa.config.json` carries no `secrets` block. */
const DEFAULTS = {
  provider: "env",
  bootstrap: { sources: ["env"], key: null },
  require: null,
  rotating: [],
  namespace: "lisa",
  narrow: { projectIds: [], excludeKeys: [] },
  surface: null,
};

/**
 * Identify the surface this process is running on.
 *
 * An explicit value always wins, so an operator can reproduce another
 * surface's behaviour locally when diagnosing one. Detection is otherwise
 * ordered most-specific first.
 * @param {string|null} [configured] Surface named in `.lisa.config.json`.
 * @param {Record<string, string|undefined>} [env] Environment to inspect.
 * @returns {string} A key of {@link SURFACES}.
 */
export function detectSurface(configured = null, env = process.env) {
  const explicit = (env.LISA_SECRETS_SURFACE ?? "").trim() || configured;
  if (explicit) {
    if (!SURFACES[explicit]) {
      throw new Error(
        `unknown surface "${explicit}".\n` +
          `Known: ${Object.keys(SURFACES).join(", ")}`
      );
    }
    return explicit;
  }
  if ((env.GITHUB_ACTIONS ?? "") === "true") return "github-actions";
  if ((env.CODEX_SANDBOX ?? env.CODEX_HOME ?? "") !== "") return "codex-cloud";
  return "local";
}

/**
 * Reject a namespace that is not exactly one safe path segment.
 *
 * The namespace is joined onto a config root, so anything containing a
 * separator or a parent reference could redirect writes outside the intended
 * directory. Validating here means every caller inherits the guard.
 * @param {string} namespace Candidate namespace.
 * @returns {string} The namespace, unchanged, when valid.
 */
export function assertNamespace(namespace) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(namespace) || namespace === "..") {
    throw new Error(
      `secrets.namespace must be one safe path segment, got "${namespace}"`
    );
  }
  return namespace;
}

/**
 * Where a surface's materialized files live.
 * @param {string} namespace Validated namespace.
 * @param {Record<string, string|undefined>} [env] Environment to inspect.
 * @returns {{dir: string, valuesFile: string, notesFile: string}} Paths.
 */
export function materializedPaths(namespace, env = process.env) {
  const root = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  const dir = join(root, assertNamespace(namespace));
  return {
    dir,
    valuesFile: join(dir, "secrets.env"),
    notesFile: join(dir, "secret-notes.json"),
  };
}

/**
 * Read the `secrets` block from `.lisa.config.json`.
 *
 * A project with no block is a supported state, not an error: the `env`
 * provider means the environment *is* the provider. A credentials manager is
 * the preferred path, never a required one.
 * @param {string} [cwd] Directory to look in.
 * @returns {object} Resolved configuration with defaults applied.
 */
export function readConfig(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) return withSurface(DEFAULTS);
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(path, "utf8")).secrets;
  } catch (err) {
    throw new Error(`.lisa.config.json is not readable: ${err.message}`);
  }
  if (!cfg) return withSurface(DEFAULTS);
  return withSurface({
    provider: cfg.provider ?? DEFAULTS.provider,
    bootstrap: { ...DEFAULTS.bootstrap, ...(cfg.bootstrap ?? {}) },
    require: cfg.require ?? null,
    rotating: cfg.rotating ?? [],
    namespace: assertNamespace(cfg.namespace ?? DEFAULTS.namespace),
    narrow: { ...DEFAULTS.narrow, ...(cfg.narrow ?? {}) },
    surface: cfg.surface ?? null,
  });
}

/**
 * Attach the resolved surface and its capabilities to a configuration.
 * @param {object} cfg Configuration without surface resolution.
 * @returns {object} The same configuration plus `surface` and `capabilities`.
 */
function withSurface(cfg) {
  const surface = detectSurface(cfg.surface);
  return { ...cfg, surface, capabilities: SURFACES[surface] };
}
