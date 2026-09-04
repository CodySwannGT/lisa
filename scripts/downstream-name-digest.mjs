#!/usr/bin/env node
/**
 * Turn a host name into the denylist entry that represents it, without ever
 * writing the name down.
 *
 * WHY THIS EXISTS
 *
 * `HOST_NAME_ENTRIES` in `src/core/downstream-names.ts` holds truncated salted
 * digests precisely so the list cannot be read out of a public repository. That
 * is the right design and it has one cost: **adding an entry requires computing
 * a digest, and there was no way to do it.** Three names known to be missing —
 * a legal-entity org slug whose short product form is present, an organisation
 * whose tracker-site slug differs from its repo-host org slug, and organisation
 * email domains — have stayed missing for that reason rather than any other. A
 * gap nobody can close in one step stays open.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not write to `downstream-names.ts`, and it does not accept a file of
 * names. Both would put plaintext identities on disk in a repository whose
 * entire point here is that they are not on disk. It prints entries to stdout;
 * a person pastes them in. The name reaches the terminal and nowhere else.
 *
 * Prefer shell history hygiene when running it: on most shells a leading space
 * keeps the command out of the history file.
 *
 * USAGE
 *
 *   node scripts/downstream-name-digest.mjs "Some Host" somehost.example
 *   printf 'one\ntwo\n' | node scripts/downstream-name-digest.mjs
 *
 * Each line of output is one array element for `HOST_NAME_ENTRIES`, already
 * quoted and comma-terminated, sorted the way the existing list is.
 * @module scripts/downstream-name-digest
 */
import { createHash } from "node:crypto";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Domain separator, duplicated from `src/core/downstream-names.ts`.
 *
 * A second copy is the wrong shape in general, and it is the right one here:
 * this script must run with no build step and no import of compiled output,
 * because the person adding a name should not have to build the repository
 * first. The duplication is guarded — `downstream-name-digest.test.ts` asserts
 * this script's output equals `nameEntry()` for the same input, so a change to
 * the salt or the truncation on either side fails immediately rather than
 * silently producing entries that never match.
 */
const DIGEST_SALT = "lisa/downstream-name/v1";
/** Hex characters kept from each digest — 40 bits. Mirrors the module. */
const DIGEST_HEX_LENGTH = 10;
/** Shortest name worth listing. Mirrors the module. */
const MIN_NAME_LENGTH = 5;

/**
 * Reduce a name to the alphanumerics the matcher compares.
 * @param raw - The name as a person writes it.
 * @returns Lowercased alphanumerics only.
 */
export function normalize(raw) {
  return raw.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "");
}

/**
 * The `length:digest` entry for one name.
 * @param raw - The name as a person writes it.
 * @returns The entry, or undefined when the name is too short to list.
 */
export function entryFor(raw) {
  const normalized = normalize(raw);
  if (normalized.length < MIN_NAME_LENGTH) return undefined;
  const digest = createHash("sha256")
    .update(DIGEST_SALT)
    .update(normalized)
    .digest("hex")
    .slice(0, DIGEST_HEX_LENGTH);
  return `${normalized.length}:${digest}`;
}

/**
 * Read names from argv, or from stdin when argv carries none.
 * @returns The raw names.
 */
async function readNames() {
  const fromArgs = process.argv.slice(2).filter(name => name !== "");
  if (fromArgs.length > 0) return fromArgs;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return chunks
    .join("")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line !== "");
}

/** Print one entry per accepted name, and name the rejects on stderr. */
async function main() {
  const names = await readNames();
  if (names.length === 0) {
    process.stderr.write(
      "usage: node scripts/downstream-name-digest.mjs <name> [name...]\n"
    );
    process.exit(1);
  }
  const entries = names.map(name => ({ name, entry: entryFor(name) }));
  for (const rejected of entries.filter(pair => pair.entry === undefined)) {
    process.stderr.write(
      `skipped: a name shorter than ${MIN_NAME_LENGTH} characters after normalization would collide with ordinary words (${rejected.name.length} given)\n`
    );
  }
  const accepted = [
    ...new Set(
      entries
        .filter(pair => pair.entry !== undefined)
        .map(pair => `${pair.entry}`)
    ),
  ].sort();
  for (const entry of accepted) process.stdout.write(`  "${entry}",\n`);
  process.stderr.write(
    `\nPaste the ${accepted.length} line(s) above into HOST_NAME_ENTRIES in src/core/downstream-names.ts, keeping the array sorted.\nThe names themselves were not written anywhere.\n`
  );
}

if (invokedAsScript(import.meta.url)) {
  await main();
}
