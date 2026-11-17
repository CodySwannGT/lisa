/**
 * @file lisa-owned-hash-ledger.ts
 * @description Loads the Lisa-owned hash ledger into the frozen records the
 * runtime reads.
 *
 * The data lives in `lisa-owned-hash-ledger.json`, written by
 * `scripts/generate-lisa-owned-hash-ledger.mjs` (`bun run
 * build:lisa-owned-hash-ledger`). It is data, not source: one hash per line
 * keeps the per-entry diff and the merge driver's pointwise merge, and as JSON
 * it answers to no source-file length budget. This module validates its shape
 * once at load and freezes it, so a consumer can never observe a partially
 * formed or mutable ledger.
 * @module core/lisa-owned-hash-ledger
 */
import ledgerDocument from "./lisa-owned-hash-ledger.json" with { type: "json" };

/** Destination path to every content hash recorded for it. */
type HashRecord = Readonly<Record<string, readonly string[]>>;

/** A lower-case hex sha256 digest. */
const SHA256 = /^[0-9a-f]{64}$/u;

/**
 * Validate and deep-freeze one record of the ledger document.
 * @param document - The parsed ledger JSON
 * @param name - The record to read
 * @returns The frozen record
 * @throws {Error} When the record is missing or not a map of digest arrays
 */
function readHashRecord(document: unknown, name: string): HashRecord {
  const record: unknown =
    typeof document === "object" && document !== null
      ? (document as Record<string, unknown>)[name]
      : undefined;
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new Error(`lisa-owned-hash-ledger.json has no ${name} record`);
  }
  const entries = Object.entries(record).map(([destination, hashes]) => {
    if (
      !Array.isArray(hashes) ||
      !hashes.every(hash => typeof hash === "string" && SHA256.test(hash))
    ) {
      throw new Error(
        `lisa-owned-hash-ledger.json ${name} entry ${destination} is not a list of sha256 digests`
      );
    }
    return [destination, Object.freeze([...(hashes as string[])])] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * Every content hash Lisa has published at each Lisa-owned destination path.
 *
 * A host copy whose hash appears here is provably an older Lisa artifact and may
 * be refreshed. One that appears nowhere here was edited downstream, and refresh
 * refuses rather than risk deleting a stronger guard. See
 * `src/core/lisa-owned-provenance.ts`.
 */
export const LISA_OWNED_HASH_LEDGER: HashRecord = readHashRecord(
  ledgerDocument,
  "LISA_OWNED_HASH_LEDGER"
);

/**
 * The subset of the ledger some run of the generator derived from git history.
 *
 * Provenance, in one lookup (CodySwannGT/lisa#3115). A digest recorded here was
 * produced by the `git log --follow` walk, or by the bytes in the working tree,
 * at the time it was recorded. A digest in the ledger and NOT here was **carried
 * forward** from an earlier checked-in ledger, and no run of the generator has
 * been able to derive it since.
 *
 * Carried-forward digests are kept, never pruned. The history walk depends on
 * clone depth and merge topology, so "this clone cannot see it" is not evidence
 * that Lisa never shipped it, and dropping one would permanently stop refresh
 * recognising a genuinely older host copy. They are *reported* instead — by
 * `bun run build:lisa-owned-hash-ledger` and by its `--check` mode — so the
 * question is answerable without archaeology.
 */
export const LISA_OWNED_HASH_HISTORY_DERIVED: HashRecord = readHashRecord(
  ledgerDocument,
  "LISA_OWNED_HASH_HISTORY_DERIVED"
);
