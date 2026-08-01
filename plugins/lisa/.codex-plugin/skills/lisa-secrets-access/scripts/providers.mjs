#!/usr/bin/env node
/**
 * Provider reads and boundary enforcement for `lisa-secrets-access`.
 *
 * Retrieval and selection are separated deliberately. `fetchRaw` is the only
 * function that touches a provider; everything downstream operates on plain
 * rows, which is what makes the boundary rules testable with synthetic data and
 * without granting a test process access to any real secret.
 * @module providers
 */

import { execFileSync } from "node:child_process";

/**
 * A provider key becomes a shell variable name on materializing surfaces, so
 * only names valid in every POSIX-like shell are accepted. Anything else stays
 * in the provider and is intentionally not exported.
 */
export const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The provider entry holding rotation leases.
 *
 * Leases live in the provider because it is the only substrate every surface
 * shares — a CI concurrency group and a laptop lockfile cannot see each other,
 * but both can see this. It is coordination state rather than a credential, so
 * it is excluded from every selection: nothing should resolve or materialize it.
 */
export const LEASE_KEY = "LISA_ROTATION_LEASES";

/**
 * Obtain the one credential that unlocks the provider.
 *
 * Walks `sources` in order, environment first, so a CI run where the pipeline
 * injects the bootstrap never reaches for a local store. This is the only
 * credential permitted in an OS keychain — it is a bootstrap, not a cached copy
 * of anything downstream.
 * @param {{sources: string[], key: string|null}} bootstrap Bootstrap config.
 * @returns {string|null} The token, or null when the provider needs none.
 */
export function bootstrapToken(bootstrap) {
  if (!bootstrap.key) return null;
  for (const source of bootstrap.sources) {
    const found =
      source === "env"
        ? (process.env[bootstrap.key] ?? "").trim()
        : source === "keychain"
          ? fromKeychain(bootstrap.key)
          : "";
    if (found) return found;
  }
  throw new Error(
    `${bootstrap.key} not found in: ${bootstrap.sources.join(", ")}.\n` +
      `It is the bootstrap credential — without it no other secret can be read.`
  );
}

/**
 * Read one value from the macOS keychain, treating absence as empty.
 * @param {string} key Keychain service name.
 * @returns {string} The value, or an empty string when unavailable.
 */
function fromKeychain(key) {
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", key, "-a", process.env.USER ?? "", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    return "";
  }
}

/**
 * Read every secret the provider grants, as unfiltered rows.
 *
 * Deliberately reads all rather than one: the provider already scopes what this
 * caller may see, so the set it returns *is* the permitted set. Restating that
 * as a list in config would duplicate a boundary the provider already enforces.
 * @param {object} cfg Resolved configuration.
 * @returns {Array<{key: string, value: string, note: string, projectId: string|null}>} Rows.
 */
export function fetchRaw(cfg) {
  const env = { ...process.env };
  const token = bootstrapToken(cfg.bootstrap);
  if (cfg.bootstrap.key && token) env[cfg.bootstrap.key] = token;

  if (cfg.provider === "env") {
    return Object.entries(process.env)
      .filter(([k]) => /^[A-Z][A-Z0-9_]*$/.test(k))
      .map(([key, value]) => ({
        key,
        value: value ?? "",
        note: "",
        projectId: null,
      }));
  }

  if (cfg.provider === "bitwarden") {
    const raw = run("bws", ["secret", "list", "--output", "json"], env);
    return JSON.parse(raw || "[]").map(s => ({
      key: s.key,
      value: s.value,
      note: s.note ?? "",
      projectId: s.projectId ?? null,
      id: s.id ?? null,
    }));
  }

  if (cfg.provider === "doppler") {
    const args = ["secrets", "download", "--no-file", "--format", "json"];
    const raw = run("doppler", args, env);
    return Object.entries(JSON.parse(raw || "{}")).map(([key, value]) => ({
      key,
      value: String(value),
      note: "",
      projectId: null,
    }));
  }

  throw new Error(
    `provider "${cfg.provider}" has no bulk read implemented yet.\n` +
      `Add one in providers.mjs — see the dispatch table in SKILL.md.`
  );
}

/**
 * Run a provider CLI, keeping its output off any shared stream.
 * @param {string} bin Executable name.
 * @param {string[]} args Arguments.
 * @param {NodeJS.ProcessEnv} env Environment for the child.
 * @returns {string} Captured stdout.
 */
function run(bin, args, env) {
  return execFileSync(bin, args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Apply the exposure boundary and reject an ambiguous set.
 *
 * The provider's own scoping is the default allowlist. The optional controls
 * may only *narrow* it — there is intentionally no way to widen access from
 * config, because that boundary belongs to the provider grant.
 *
 * A duplicate exact-name key is fatal rather than last-wins. Silently choosing
 * one would make which credential gets used depend on provider response order,
 * which is neither stable nor visible at the call site.
 * @param {Array<object>} rows Raw provider rows.
 * @param {{projectIds: string[], excludeKeys: string[]}} narrow Narrowing controls.
 * @returns {Map<string, {value: string, note: string, id: string|null}>} Selected secrets by name.
 */
export function normalizeRows(
  rows,
  narrow = { projectIds: [], excludeKeys: [] }
) {
  const projects = new Set(narrow.projectIds ?? []);
  const excluded = new Set([...(narrow.excludeKeys ?? []), LEASE_KEY]);
  const out = new Map();

  for (const row of rows) {
    if (projects.size && !projects.has(row.projectId)) continue;
    if (typeof row.key !== "string" || !ENV_KEY.test(row.key)) continue;
    if (excluded.has(row.key)) continue;
    if (out.has(row.key)) {
      throw new Error(
        `duplicate secret key across visible projects: ${row.key}.\n` +
          `Resolve it at the provider — choosing one here would make credential ` +
          `use depend on response order.`
      );
    }
    if (typeof row.value !== "string") {
      throw new Error(`secret value is not a string: ${row.key}`);
    }
    out.set(row.key, {
      value: row.value,
      note: row.note ?? "",
      id: row.id ?? null,
    });
  }
  return out;
}

/**
 * Read and select in one step — the normal entry point for consumers.
 * @param {object} cfg Resolved configuration.
 * @returns {Map<string, {value: string, note: string, id: string|null}>} Selected secrets.
 */
export function fetchAll(cfg) {
  return normalizeRows(fetchRaw(cfg), cfg.narrow);
}

/**
 * Find one raw row by exact key, bypassing the exposure boundary.
 *
 * Only the rotation path uses this, and only to reach the lease record, which
 * is deliberately excluded from every normal selection. Reading a *credential*
 * must always go through {@link fetchAll} so the boundary applies.
 * @param {object} cfg Resolved configuration.
 * @param {string} key Exact key name.
 * @returns {object|null} The raw row, or null when absent.
 */
export function rawByKey(cfg, key) {
  const matches = fetchRaw(cfg).filter(row => row.key === key);
  if (matches.length > 1) throw new Error(`duplicate secret key: ${key}`);
  return matches[0] ?? null;
}

/**
 * Write a replacement value back to the provider.
 *
 * Passing a value as an argument is normally forbidden, because process
 * arguments are visible to anyone who can run `ps` on the same host. The
 * Bitwarden CLI exposes no stdin path for an edit, so this is a documented
 * exception rather than an oversight: it is confined to the one operation that
 * cannot be expressed otherwise, and `execFileSync` at least keeps the value
 * out of a shell and therefore out of shell history.
 * @param {object} cfg Resolved configuration.
 * @param {string} id Provider-side identifier for the secret.
 * @param {string} value Replacement value.
 */
export function writeSecret(cfg, id, value) {
  const env = { ...process.env };
  const token = bootstrapToken(cfg.bootstrap);
  if (cfg.bootstrap.key && token) env[cfg.bootstrap.key] = token;

  if (cfg.provider === "bitwarden") {
    run("bws", ["secret", "edit", id, "--value", value], env);
    return;
  }
  throw new Error(
    `provider "${cfg.provider}" has no write implemented.\n` +
      `Rotation requires a proven write path; add one in providers.mjs.`
  );
}
