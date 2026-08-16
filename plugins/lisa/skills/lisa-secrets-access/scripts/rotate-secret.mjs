#!/usr/bin/env node
/**
 * The single-writer path for consumable credentials.
 *
 * A *consumable* credential is one where using it can invalidate the stored
 * copy: an OAuth refresh token the issuer replaces on every exchange, a
 * short-lived session, a single-use enrollment token. The property is not
 * "OAuth" — it is that a successful use makes the value on record wrong.
 *
 * This is a deliberate sibling of the resolver rather than a mode of it. The
 * resolver never writes, and that is what makes it safe to hand to anything. A
 * credential that must be written back needs an authority the read path should
 * not hold, so it gets its own program and its own contract.
 *
 * The failure this exists to prevent is not rotation. It is **rotation with no
 * proven write path**: a job exchanges the token, the issuer invalidates the
 * old one, the replacement cannot be saved, and every downstream consumer is
 * broken until a human notices. So the write is proven *before* the
 * irreversible use, never after.
 *
 * Usage:
 *   rotate-secret.mjs preflight NAME     # prove the write path, change nothing
 *   rotate-secret.mjs checkout NAME      # preflight, take the lease, emit value
 *   rotate-secret.mjs commit NAME        # read replacement on stdin, release
 *   rotate-secret.mjs release NAME       # release without writing
 *   rotate-secret.mjs leases             # show current holders
 * @module rotate-secret
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

import {
  LEASE_KEY,
  fetchRotatable,
  rawByKey,
  writeSecret,
} from "./providers.mjs";
import { readConfig } from "./surfaces.mjs";

/** How long a lease is honoured before it is treated as abandoned. */
const LEASE_TTL_MS = 30 * 60 * 1000;

/**
 * Assert a name is declared rotating before any write path opens for it.
 *
 * Declaration is config, never inference from a note: the note lives
 * provider-side, is editable outside review, and a read-only account cannot
 * correct a wrong one. Config is the surface where this decision is reviewable.
 * @param {string} name Requested name.
 * @param {object} cfg Resolved configuration.
 */
function assertRotating(name, cfg) {
  if (!(cfg.rotating ?? []).includes(name)) {
    throw new Error(
      `${name} is not declared in secrets.rotating.\n` +
        `Only a declared consumable credential may use the write path. If this ` +
        `credential really is replaced on use, declare it — silently rotating an ` +
        `undeclared one is how a shared token gets stranded.`
    );
  }
}

/**
 * Locate a secret and its provider-side identifier.
 * @param {string} name Requested name.
 * @param {object} cfg Resolved configuration.
 * @returns {{value: string, id: string}} The current entry.
 */
function entryFor(name, cfg) {
  // Rotation view, not the materialization view: a name may be excluded from
  // every surface and still need its replacement persisted. assertRotating has
  // already proved this name is declared in config.
  const hit = fetchRotatable(cfg).get(name);
  if (!hit) throw new Error(`${name} is not available to this account`);
  if (!hit.id) {
    throw new Error(
      `${name} has no provider identifier, so it cannot be written back.\n` +
        `Provider "${cfg.provider}" may not support rotation.`
    );
  }
  return { value: hit.value, id: hit.id };
}

/**
 * Prove the replacement could be saved, by writing the value already stored.
 *
 * A no-op re-write is the only honest proof: it exercises the exact permission
 * the rotation will need, against the exact record, and changes nothing. A
 * check that merely confirms the CLI exists proves a different thing than the
 * one that fails — which is precisely how the original incident happened.
 * @param {string} name Requested name.
 * @param {object} cfg Resolved configuration.
 * @returns {{value: string, id: string}} The verified entry.
 */
export function preflight(name, cfg) {
  assertRotating(name, cfg);
  const entry = entryFor(name, cfg);
  try {
    writeSecret(cfg, entry.id, entry.value);
  } catch (err) {
    throw new Error(
      `no write access to ${name}: ${String(err.message).split("\n")[0]}\n` +
        `Refusing to continue. Rotating a credential whose replacement cannot ` +
        `be persisted breaks every consumer of it.`
    );
  }
  return entry;
}

/**
 * Read the lease record, tolerating its absence.
 * @param {object} cfg Resolved configuration.
 * @returns {{row: object|null, leases: Record<string, object>}} Current state.
 */
function readLeases(cfg) {
  const row = rawByKey(cfg, LEASE_KEY);
  if (!row) return { row: null, leases: {} };
  try {
    const parsed = JSON.parse(row.value || "{}");
    return { row, leases: typeof parsed === "object" ? parsed : {} };
  } catch {
    return { row, leases: {} };
  }
}

/**
 * Persist the lease record.
 *
 * When the record does not exist the lease is skipped rather than invented.
 * Creating provider entries is not this program's authority, and an advisory
 * lock whose absence blocks a legitimate rotation would be worse than no lock.
 * @param {object} cfg Resolved configuration.
 * @param {object|null} row Existing lease row.
 * @param {Record<string, object>} leases Updated lease map.
 */
function writeLeases(cfg, row, leases) {
  if (!row?.id) return;
  writeSecret(cfg, row.id, JSON.stringify(leases));
}

/**
 * Identify this holder well enough for a human to find it.
 * @param {object} cfg Resolved configuration.
 * @returns {string} A holder label.
 */
function holderId(cfg) {
  const run = process.env.GITHUB_RUN_ID;
  return run ? `${cfg.surface}:run-${run}` : `${cfg.surface}:${hostname()}`;
}

/**
 * Take the advisory lease, refusing while another holder's lease is live.
 *
 * Advisory is the honest word. True cross-surface exclusion is not achievable
 * with per-surface primitives, and claiming otherwise would invite exactly the
 * concurrent rotation this guards against. What this does give is a record every
 * surface can see, and an expiry so a crashed holder heals itself.
 * @param {string} name Requested name.
 * @param {object} cfg Resolved configuration.
 * @param {number} now Current epoch milliseconds.
 */
function acquire(name, cfg, now) {
  const { row, leases } = readLeases(cfg);
  const held = leases[name];
  const holder = holderId(cfg);
  if (held && held.holder !== holder && Number(held.expiresAt) > now) {
    throw new Error(
      `${name} is leased by ${held.holder} until ` +
        `${new Date(Number(held.expiresAt)).toISOString()}.\n` +
        `Two refresh loops race: each receives a new value and invalidates the ` +
        `other, and whichever wrote last wins while the other copy is dead.`
    );
  }
  leases[name] = {
    holder,
    surface: cfg.surface,
    acquiredAt: now,
    expiresAt: now + LEASE_TTL_MS,
  };
  writeLeases(cfg, row, leases);
}

/**
 * Release the lease if this holder owns it.
 * @param {string} name Requested name.
 * @param {object} cfg Resolved configuration.
 */
function release(name, cfg) {
  const { row, leases } = readLeases(cfg);
  if (leases[name]?.holder === holderId(cfg)) {
    delete leases[name];
    writeLeases(cfg, row, leases);
  }
}

/**
 * Read the replacement value from stdin.
 *
 * Stdin rather than an argument, because process arguments are visible to
 * anything that can list processes on the host.
 * @returns {string} The replacement value.
 */
function readStdin() {
  const value = readFileSync(0, "utf8");
  if (!value.trim()) {
    throw new Error(
      "no replacement value on stdin; refusing to store an empty secret"
    );
  }
  return value;
}

function main() {
  const [op, name] = process.argv.slice(2);
  const cfg = readConfig();
  const now = Date.now();

  if (op === "leases") {
    const { leases } = readLeases(cfg);
    const rows = Object.entries(leases);
    if (!rows.length) {
      console.log("no rotation leases held");
      return;
    }
    for (const [key, lease] of rows) {
      const state = Number(lease.expiresAt) > now ? "held" : "expired";
      console.log(
        `  ${key.padEnd(30)} ${state.padEnd(8)} ${lease.holder}  ` +
          `until ${new Date(Number(lease.expiresAt)).toISOString()}`
      );
    }
    return;
  }

  if (!name) throw new Error(`usage: rotate-secret.mjs ${op ?? "OP"} NAME`);

  if (op === "preflight") {
    preflight(name, cfg);
    console.log(`${name}: write path proven; nothing was changed`);
    return;
  }
  if (op === "checkout") {
    const entry = preflight(name, cfg);
    acquire(name, cfg, now);
    process.stdout.write(entry.value);
    return;
  }
  if (op === "commit") {
    assertRotating(name, cfg);
    const { id } = entryFor(name, cfg);
    writeSecret(cfg, id, readStdin());
    release(name, cfg);
    console.log(`${name}: replacement stored and lease released`);
    return;
  }
  if (op === "release") {
    release(name, cfg);
    console.log(`${name}: lease released`);
    return;
  }
  throw new Error(
    "usage: rotate-secret.mjs preflight|checkout|commit|release|leases [NAME]"
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
