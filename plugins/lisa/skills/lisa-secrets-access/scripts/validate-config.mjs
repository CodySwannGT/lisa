#!/usr/bin/env node
/**
 * Validate the `secrets`, `remoteEnv`, and `automations` blocks.
 *
 * These blocks are read by shell, by Node, and by generated workflows, so a
 * malformed one surfaces late and somewhere unhelpful — a container that fails
 * mid-setup, a scheduled loop that never fires, a dispatch that names a surface
 * nobody provisioned. Checking the shape up front turns all of those into one
 * message at `doctor` time.
 *
 * Structure only. Whether a credential resolves is `doctor-secrets.mjs`; this
 * asks whether the declaration could ever be correct.
 *
 * Usage:
 *   validate-config.mjs
 * @module validate-config
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { SURFACES as SURFACE_CAPABILITIES } from "./surfaces.mjs";

/** Providers with a read implementation today. */
const IMPLEMENTED_PROVIDERS = new Set(["bitwarden", "doppler", "env"]);

/** Providers named in the dispatch table but not yet implemented. */
const DECLARED_PROVIDERS = new Set(["1password", "aws", "vault"]);

/**
 * Surfaces the resolver knows.
 *
 * Derived from the resolver's own table rather than restated here. The two
 * lists previously drifted apart by construction: adding a surface meant
 * remembering to edit a second file, and forgetting produced a config that
 * resolved correctly at runtime while `doctor` called it unknown.
 */
const SURFACES = new Set(Object.keys(SURFACE_CAPABILITIES));

/**
 * What a provisioned surface must record before anything dispatches to it.
 *
 * Deliberately not uniform, because these surfaces do not bind the same way. A
 * Codex Cloud environment is bound to one repository, so naming the repository
 * is part of proving the environment is the right one. A Claude cloud
 * environment has no repository at all — it is account-scoped configuration
 * (network policy, variables, setup script) and the repository arrives per
 * session — so its durable handle is the routine that dispatch fires.
 *
 * Requiring `repository` of every surface, as this file used to, would demand
 * a field that cannot be true of `claude-web` in any meaningful sense.
 *
 * `repository` stays the default so every existing surface keeps its current
 * contract. This file checks structure only — whether a declaration *could* be
 * correct — so it deliberately does not restate the fuller preconditions that
 * `lisa-remote-dispatch` enforces at the moment it actually dispatches.
 */
const SURFACE_BINDINGS = {
  "claude-web": ["routineId", "fireUrl"],
};

/**
 * The fields a surface must record, with the default applied.
 *
 * Read through one helper rather than at each call site, because the two
 * callers answer different questions — "could this declaration be correct" and
 * "may an automation dispatch to it" — and a fallback that drifted between them
 * would let those answers disagree about the very same config.
 * @param {string} surface Surface name.
 * @returns {string[]} Field names that must be present.
 */
function bindingsFor(surface) {
  return SURFACE_BINDINGS[surface] ?? ["repository"];
}

/** Install methods the toolchain runner supports. */
const INSTALL_METHODS = new Set(["release-zip", "npm-global"]);

/**
 * Validate the `secrets` block.
 * @param {object|undefined} secrets The block, if present.
 * @returns {string[]} Problems found.
 */
export function validateSecrets(secrets) {
  if (!secrets) return [];
  const problems = [];
  const provider = secrets.provider ?? "env";

  if (DECLARED_PROVIDERS.has(provider)) {
    problems.push(
      `secrets.provider "${provider}" is documented but has no read ` +
        `implementation yet. Add one in providers.mjs rather than configuring it.`
    );
  } else if (!IMPLEMENTED_PROVIDERS.has(provider)) {
    problems.push(
      `secrets.provider "${provider}" is unknown. ` +
        `Known: ${[...IMPLEMENTED_PROVIDERS, ...DECLARED_PROVIDERS].join(", ")}.`
    );
  }

  if (
    secrets.namespace &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(secrets.namespace)
  ) {
    problems.push(
      `secrets.namespace "${secrets.namespace}" is not one safe path segment. ` +
        `It is joined onto a config root, so a separator could redirect writes.`
    );
  }

  if (secrets.surface && !SURFACES.has(secrets.surface)) {
    problems.push(
      `secrets.surface "${secrets.surface}" is unknown. ` +
        `Known: ${[...SURFACES].join(", ")}.`
    );
  }

  for (const field of ["require", "rotating"]) {
    const value = secrets[field];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      problems.push(`secrets.${field} must be an array of exact key names`);
      continue;
    }
    for (const name of value) {
      if (typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
        problems.push(
          `secrets.${field} entry ${JSON.stringify(name)} is not an exact ` +
            `UPPER_SNAKE_CASE environment-variable name. Lookup is never fuzzy.`
        );
      }
    }
  }

  if ((secrets.rotating ?? []).length && !secrets.bootstrap?.key) {
    problems.push(
      `secrets.rotating is declared but secrets.bootstrap.key is not. A ` +
        `rotating credential whose replacement cannot be written back is ` +
        `stranded the first time it is used.`
    );
  }

  return problems;
}

/**
 * Validate the `remoteEnv` block.
 * @param {object|undefined} remoteEnv The block, if present.
 * @returns {string[]} Problems found.
 */
export function validateRemoteEnv(remoteEnv) {
  if (!remoteEnv) return [];
  const problems = [];

  for (const tool of remoteEnv.tools?.require ?? []) {
    if (!tool.name) problems.push("remoteEnv.tools.require entry has no name");
  }
  for (const tool of remoteEnv.tools?.install ?? []) {
    if (!tool.name) {
      problems.push("remoteEnv.tools.install entry has no name");
      continue;
    }
    if (!tool.version) {
      problems.push(`remoteEnv install "${tool.name}" has no pinned version`);
    }
    if (!INSTALL_METHODS.has(tool.install)) {
      problems.push(
        `remoteEnv install "${tool.name}" has method ${JSON.stringify(tool.install)}. ` +
          `Supported: ${[...INSTALL_METHODS].join(", ")}.`
      );
      continue;
    }
    if (tool.install === "release-zip" && !(tool.url && tool.sha256)) {
      problems.push(
        `remoteEnv install "${tool.name}" needs both url and sha256. A pinned ` +
          `version with no checksum still trusts whatever the URL serves today.`
      );
    }
    if (tool.install === "npm-global" && !tool.package) {
      problems.push(`remoteEnv install "${tool.name}" needs a package`);
    }
  }

  for (const [surface, block] of Object.entries(remoteEnv.surfaces ?? {})) {
    if (!SURFACES.has(surface)) {
      problems.push(`remoteEnv.surfaces has unknown surface "${surface}"`);
      continue;
    }
    for (const field of bindingsFor(surface)) {
      if (!block[field]) {
        problems.push(`remoteEnv.surfaces["${surface}"] has no ${field}`);
      }
    }
  }

  return problems;
}

/**
 * Report whether a surface has been provisioned far enough to dispatch to.
 * @param {object|undefined} remoteEnv The remote-environment block.
 * @param {string} surface Surface name.
 * @returns {boolean} Whether every binding field is recorded.
 */
export function isProvisioned(remoteEnv, surface) {
  const block = remoteEnv?.surfaces?.[surface];
  if (!block) return false;
  return bindingsFor(surface).every(field => Boolean(block[field]));
}

/**
 * Validate the `automations` block against declared surfaces.
 * @param {object|undefined} automations The block, if present.
 * @param {object|undefined} remoteEnv The remote-environment block.
 * @returns {string[]} Problems found.
 */
export function validateAutomations(automations, remoteEnv) {
  if (!automations) return [];
  const problems = [];

  for (const [name, loop] of Object.entries(automations)) {
    if (loop.scheduler !== "github-actions") continue;
    if (!loop.schedule) {
      problems.push(`automations["${name}"] has no schedule`);
    }
    if (!loop.executionEnv) {
      problems.push(`automations["${name}"] has no executionEnv`);
      continue;
    }
    if (!SURFACES.has(loop.executionEnv)) {
      problems.push(
        `automations["${name}"].executionEnv "${loop.executionEnv}" is unknown`
      );
      continue;
    }
    if (!isProvisioned(remoteEnv, loop.executionEnv)) {
      problems.push(
        `automations["${name}"] dispatches to "${loop.executionEnv}", which is ` +
          `not provisioned. Run /lisa:setup:remote-env ${loop.executionEnv} first.`
      );
    }
  }

  return problems;
}

/**
 * Validate every block this plan introduced.
 * @param {object} cfg Parsed `.lisa.config.json`.
 * @returns {string[]} Problems found.
 */
export function validateConfig(cfg) {
  return [
    ...validateSecrets(cfg.secrets),
    ...validateRemoteEnv(cfg.remoteEnv),
    ...validateAutomations(cfg.automations, cfg.remoteEnv),
  ];
}

function main() {
  const path = join(process.cwd(), ".lisa.config.json");
  if (!existsSync(path)) {
    console.log("no .lisa.config.json — nothing to validate");
    return;
  }
  const problems = validateConfig(JSON.parse(readFileSync(path, "utf8")));
  if (!problems.length) {
    console.log(
      "config: secrets, remoteEnv and automations blocks are well-formed"
    );
    return;
  }
  for (const problem of problems) console.error(`  ${problem}`);
  throw new Error(`${problems.length} configuration problem(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
