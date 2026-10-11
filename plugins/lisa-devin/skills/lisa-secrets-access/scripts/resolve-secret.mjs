#!/usr/bin/env node
/**
 * Resolve a secret through the configured provider and surface.
 *
 * The executable half of `lisa-secrets-access`. It exists as a CLI rather than
 * a library because the callers are polyglot — Python scripts, shell, and
 * TypeScript all need the same answer, and a subprocess is the only interface
 * all three share without duplicating the logic three times.
 *
 * The resolution ladder is one rule with one order:
 *
 *   environment  ->  materialized file (surfaces that have one)  ->  provider
 *
 * Environment comes first so a CI run, where the pipeline injects secrets,
 * never reaches for a provider or a local store at all. The middle rung exists
 * only on surfaces whose bootstrap runs before the consuming process does.
 *
 * Values are written to stdout with no trailing newline and nothing else, so
 * `$(resolve-secret.mjs get NAME)` is safe. Diagnostics go to stderr.
 *
 * Usage:
 *   resolve-secret.mjs get NAME
 *   resolve-secret.mjs list
 *   resolve-secret.mjs describe NAME
 *   resolve-secret.mjs verify
 *   resolve-secret.mjs surface
 * @module resolve-secret
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseEnv } from "./envfile.mjs";
import { validateNote } from "./note-format.mjs";
import { ENV_KEY, fetchAll } from "./providers.mjs";
import { materializedPaths, readConfig } from "./surfaces.mjs";

export { readConfig };

/**
 * Read the materialized values file, if this surface has one.
 *
 * A surface without the capability returns empty rather than throwing: the
 * absence of a middle rung is normal, not an error.
 * @param {object} cfg Resolved configuration.
 * @returns {Map<string, string>} Values by exact name.
 */
export function readMaterialized(cfg) {
  if (!cfg.capabilities.materialized) return new Map();
  const { valuesFile } = materializedPaths(cfg.namespace);
  if (!existsSync(valuesFile)) return new Map();
  return parseEnv(readFileSync(valuesFile, "utf8"));
}

/**
 * Assert a name is declared when the project narrows itself with `require`.
 *
 * A `require` list is an assertion, not merely a filter: naming a secret
 * declares the project needs it, so asking for one outside the list is a
 * configuration error rather than a lookup miss.
 * @param {string} name Requested name.
 * @param {object} cfg Resolved configuration.
 */
function assertDeclared(name, cfg) {
  if (cfg.require && !cfg.require.includes(name)) {
    throw new Error(
      `${name} is not declared in secrets.require.\n` +
        `Declared: ${cfg.require.join(", ") || "(none)"}`
    );
  }
}

/**
 * Resolve one secret down the ladder.
 * @param {string} name Environment-variable-style key.
 * @param {object} [cfg] Resolved configuration.
 * @returns {string} The secret value.
 */
export function get(name, cfg = readConfig()) {
  const fromEnv = (process.env[name] ?? "").trim();
  if (fromEnv) return fromEnv;

  assertDeclared(name, cfg);

  const fromFile = readMaterialized(cfg).get(name);
  if (fromFile) return fromFile;

  const all = fetchAll(cfg);
  const hit = all.get(name);
  if (!hit || !hit.value) {
    throw new Error(
      `${name} is not available to this account.\n` +
        `Visible: ${[...all.keys()].sort().join(", ") || "(none)"}\n` +
        `A secret's key must be the exact environment variable name.`
    );
  }
  return hit.value;
}

/**
 * Report which rung of the ladder answers for a name, without revealing values.
 * @param {string} name Requested name.
 * @param {Map<string, object>} provider Provider view.
 * @param {Map<string, string>} file Materialized view.
 * @returns {string} A fixed-width source label.
 */
function sourceOf(name, provider, file) {
  if ((process.env[name] ?? "").trim()) return "env      ";
  if (file.get(name)) return "file     ";
  if (provider.get(name)?.value) return "provider ";
  return "         ";
}

/**
 * Say what is wrong with a note, not merely that something is.
 *
 * "NO NOTE" against a note that exists but is malformed sends the operator
 * looking for a missing field they already wrote.
 * @param {object} [fault] The blocking defect, if any.
 * @returns {string} A status label for the verify table.
 */
function noteStatus(fault) {
  if (!fault) return "noted";
  return fault.code === "missing-note" ? "NO NOTE" : `NOTE ${fault.code}`;
}

/**
 * Verify every declared secret, mirroring the ladder's own order.
 *
 * Checking only the provider would report MISSING for every secret in CI, where
 * the pipeline injects them as environment variables — a false negative exactly
 * where verification matters most.
 *
 * This command is read-only. Proving that a rotating credential can actually be
 * written back requires a write, so that check lives in the rotation path
 * rather than here.
 *
 * The two views are parameters so a test can supply them. Reaching for the
 * provider CLI is the one thing in here that cannot run in a test, and a check
 * nobody can test is how the note rule stayed unenforced for so long.
 * @param {object} cfg Resolved configuration.
 * @param {Map<string, object>} [provider] Provider view.
 * @param {Map<string, string>} [file] Materialized view.
 * @returns {number} Count of secrets that failed.
 */
export function verify(
  cfg,
  provider = fetchAll(cfg),
  file = readMaterialized(cfg)
) {
  const names = cfg.require ?? [
    ...new Set([...provider.keys(), ...file.keys()]),
  ];
  const rotating = new Set(cfg.rotating ?? []);
  let bad = 0;

  console.log(`surface: ${cfg.surface}   provider: ${cfg.provider}`);
  for (const name of names) {
    const resolves = Boolean(
      (process.env[name] ?? "").trim() ||
      file.get(name) ||
      provider.get(name)?.value
    );
    const named = ENV_KEY.test(name);
    // Presence is not well-formedness. Testing `Boolean(note)` passed a note
    // that was a single stray character, which is exactly the note an agent
    // learns nothing from. Same validator doctor uses, so the two agree.
    const defects = validateNote(provider.get(name)?.note);
    const noteFault = defects.find(d => d.level === "error");
    if (!resolves || !named || noteFault) bad += 1;
    console.log(
      `  ${name.padEnd(30)} ${resolves ? "resolves" : "MISSING "} ` +
        `${sourceOf(name, provider, file)} ` +
        `${named ? "name ok" : "NAME NOT UPPER_SNAKE"}  ` +
        `${noteStatus(noteFault)}` +
        `${rotating.has(name) ? "  rotating" : ""}`
    );
  }

  for (const name of rotating) {
    if (!cfg.bootstrap.key) {
      console.log(
        `  ${name.padEnd(30)} ROTATING BUT NO BOOTSTRAP — the replacement could ` +
          `not be written back, which strands the credential on first use`
      );
      bad += 1;
    }
  }
  return bad;
}

/**
 * Describe a secret's usage note without ever printing its value.
 * @param {string} name Requested name.
 * @param {object} cfg Resolved configuration.
 */
function describe(name, cfg) {
  const hit = fetchAll(cfg).get(name);
  if (hit) {
    // Infer *and* warn, never instead of. A silent fallback that works well
    // enough is what guarantees the notes stay empty forever.
    console.log(
      hit.note ||
        `(no note — purpose inferred from the name: ${name}. ` +
          `An inferred mapping must never authorise a write.)`
    );
    return;
  }
  // Environment-only is a legitimate state, not an error: CI injects secrets
  // that never appear in a provider listing. Say so rather than claiming the
  // secret does not exist, and never print the value.
  if ((process.env[name] ?? "").trim()) {
    console.log("(set in the environment; no provider entry, so no note)");
    return;
  }
  throw new Error(`${name} not found in the environment or the provider`);
}

function main() {
  const [op, name] = process.argv.slice(2);
  const cfg = readConfig();

  if (op === "surface") {
    console.log(cfg.surface);
    return;
  }
  if (op === "get") {
    if (!name) throw new Error("usage: resolve-secret.mjs get NAME");
    process.stdout.write(get(name, cfg));
    return;
  }
  if (op === "list") {
    // Names only. This command must never be able to leak a value.
    const names = new Set([
      ...fetchAll(cfg).keys(),
      ...readMaterialized(cfg).keys(),
    ]);
    console.log([...names].sort().join("\n"));
    return;
  }
  if (op === "describe") {
    if (!name) throw new Error("usage: resolve-secret.mjs describe NAME");
    describe(name, cfg);
    return;
  }
  if (op === "verify") {
    const bad = verify(cfg);
    if (bad) throw new Error(`${bad} secret(s) failed verification`);
    return;
  }
  throw new Error(
    "usage: resolve-secret.mjs get|list|describe|verify|surface [NAME]"
  );
}

/**
 * Whether this module is the one node was asked to run.
 *
 * Both sides are realpath'd: a raw URL comparison answers "no" through a
 * symlinked checkout, a git worktree, or a /tmp path on macOS, so the module
 * loads, runs nothing and exits 0 — a silent no-op that reads as success.
 *
 * A local copy rather than an import: plugin payload scripts ship standalone,
 * with no `lib/` sibling to import from once installed.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
