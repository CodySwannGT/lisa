#!/usr/bin/env node
/**
 * Health checks for a project's secrets configuration.
 *
 * The most valuable check here is the last one, and it is the reason this file
 * exists. A value present in both the provider and a local copy is **not a
 * duplicate** — it is two live credentials, one of which is untracked. Both
 * authenticate, so the difference is invisible from either side, and "tidying
 * up the duplicate" deletes a working credential that no record accounts for.
 * That is not hypothetical; it is what prompted the single-store rule.
 *
 * Every check reports without printing a value. Where two copies must be
 * compared, they are compared by digest.
 *
 * Usage:
 *   doctor-secrets.mjs
 * @module doctor-secrets
 */

import { createHash } from "node:crypto";

import { fetchAll } from "./providers.mjs";
import { readMaterialized } from "./resolve-secret.mjs";
import { readConfig } from "./surfaces.mjs";

/**
 * Build a collector so each run owns its findings.
 *
 * Module-level state would make the checks untestable in isolation and would
 * leak findings between runs in any process that calls them twice.
 * @returns {{findings: object[], report: Function}} A collector.
 */
export function collector() {
  const findings = [];
  return {
    findings,
    report: (level, name, message) => findings.push({ level, name, message }),
  };
}

/**
 * Digest a value so two copies can be compared without exposing either.
 * @param {string} value Secret value.
 * @returns {string} A short digest.
 */
function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Assert every declared name actually resolves.
 * @param {object} cfg Resolved configuration.
 * @param {Map<string, object>} provider Provider view.
 * @param {Map<string, string>} file Materialized view.
 * @param {Function} report Finding collector.
 */
export function checkRequired(cfg, provider, file, report) {
  for (const name of cfg.require ?? []) {
    const resolves =
      (process.env[name] ?? "").trim() ||
      file.get(name) ||
      provider.get(name)?.value;
    if (resolves) report("ok", name, "resolves");
    else
      report(
        "error",
        name,
        "declared in secrets.require but resolves nowhere — a startup error, " +
          "not a late surprise"
      );
  }
}

/**
 * Assert every key is an exact environment-variable name.
 * @param {Map<string, object>} provider Provider view.
 * @param {Function} report Finding collector.
 */
export function checkNaming(provider, report) {
  for (const name of provider.keys()) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      report(
        "warn",
        name,
        "key is not UPPER_SNAKE_CASE, so it will not resolve for the " +
          "environment variable of that name — lookup is exact, never fuzzy"
      );
    }
  }
}

/**
 * Assert every secret carries a usage note.
 * @param {Map<string, object>} provider Provider view.
 * @param {Function} report Finding collector.
 */
export function checkNotes(provider, report) {
  for (const [name, entry] of provider) {
    if (!entry.note?.trim()) {
      report(
        "warn",
        name,
        "has no usage note. An agent cannot learn this credential's scope " +
          "without one, and inferring it from the name is exactly the guess " +
          "that writes to the wrong system"
      );
    }
  }
}

/**
 * Assert every rotating credential could persist its replacement.
 * @param {object} cfg Resolved configuration.
 * @param {Map<string, object>} provider Provider view.
 * @param {Function} report Finding collector.
 */
export function checkRotating(cfg, provider, report) {
  for (const name of cfg.rotating ?? []) {
    if (!cfg.bootstrap?.key) {
      report(
        "error",
        name,
        "is declared rotating but the lane has no bootstrap, so a replacement " +
          "could not be written back. Using it once would strand it"
      );
      continue;
    }
    if (!provider.get(name)?.id) {
      report(
        "error",
        name,
        "is declared rotating but has no provider identifier to write back to"
      );
      continue;
    }
    report("ok", name, "rotating, with a write path");
  }
}

/**
 * Detect the same credential living in more than one store.
 *
 * Two different values under one name are two live credentials, not a stale
 * copy — treat it as stop-and-ask rather than something to adjudicate. Deleting
 * the one you cannot verify leaves a working credential recorded nowhere.
 * @param {Map<string, object>} provider Provider view.
 * @param {Map<string, string>} file Materialized view.
 * @param {Function} report Finding collector.
 */
export function checkTwoStores(provider, file, report) {
  for (const [name, value] of file) {
    const fromProvider = provider.get(name)?.value;
    if (!fromProvider) continue;
    if (fromProvider === value) {
      report(
        "warn",
        name,
        "exists in both the provider and a local copy. Same value today, but " +
          "two stores drift; the local copy should be re-materialized, never edited"
      );
      continue;
    }
    report(
      "error",
      name,
      `differs between the provider (${fingerprint(fromProvider)}) and the ` +
        `local copy (${fingerprint(value)}). These are TWO LIVE CREDENTIALS, ` +
        `not a duplicate. Stop and ask — deleting the one you cannot verify ` +
        `leaves a working credential that no record accounts for`
    );
  }
}

function main() {
  const cfg = readConfig();

  if (cfg.provider === "env") {
    console.log(
      "secrets: no credentials manager configured (provider: env).\n" +
        "  This is supported — the environment is the provider. A manager is the\n" +
        "  preferred path because it gives one store, rotation, and an audit trail,\n" +
        "  but it is never required. Configure one with secrets.provider when ready."
    );
    return;
  }

  const provider = fetchAll(cfg);
  const file = readMaterialized(cfg);

  console.log(`secrets: provider ${cfg.provider}, surface ${cfg.surface}`);
  const { findings, report } = collector();
  checkRequired(cfg, provider, file, report);
  checkNaming(provider, report);
  checkNotes(provider, report);
  checkRotating(cfg, provider, report);
  checkTwoStores(provider, file, report);

  const order = { error: 0, warn: 1, ok: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  for (const f of findings) {
    console.log(
      `  ${f.level.toUpperCase().padEnd(5)} ${f.name.padEnd(28)} ${f.message}`
    );
  }

  const errors = findings.filter(f => f.level === "error").length;
  if (errors) throw new Error(`${errors} secrets configuration error(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
