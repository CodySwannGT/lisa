/**
 * The packed-host journey's shared Bun install cache, freed by the last case
 * that installs through it (CodySwannGT/lisa#4548).
 *
 * ## What the teardown was paying for
 *
 * Measured at the teardown boundary after all ten cases (2026-11-02): the
 * owned root held 383,410 entries (3.9 GB), and 79% of them were this cache —
 * every package the installing hosts and the packed tool resolved, kept once
 * and hard-linked into each host's `node_modules`.
 *
 * The hosted runners mount their root filesystem ext4 `discard,data=writeback`.
 * In that mode freeing a file's data discards it on the device synchronously,
 * in the thread doing the unlink. Measured on six runners, removing the root
 * freed about 341,000 inodes with about 309,000 device discards, and the
 * devices completed 22,000-34,000 freed inodes a second however many unlinks
 * were in flight from four up: the best of 4 to 32 native worker threads beat
 * libuv's four threads by 3-26%, thirty-two did worse than eight, and a single
 * native `rmSync` thread was two to three times slower. At those rates the
 * root takes 10-16 s; passing baseline runs took up to 28 s and the failing
 * ones over 30 s, so slower devices exist and the rate is theirs, not the
 * code's. The removal could not be made fast enough to fit reliably in the
 * teardown's 30 s; it could only be made smaller.
 *
 * ## Why the cache, and why its last installer
 *
 * A host's `node_modules` holds a second hard link to each cache file, so a
 * case removing its own host frees almost nothing: the cache still holds the
 * data, and the teardown then freed all of it. The cache's last real user is
 * the last installing case, and the journey already frees each host inside
 * that host's own case budget for this same reason. So the cache is freed
 * there too, by whichever installing case finishes last, and the teardown
 * frees only the candidate's own fixtures — its oracle and installed tool —
 * and the evidence.
 *
 * ## What is freed before the cases run (CodySwannGT/lisa#4636)
 *
 * The candidate's checkout held 17,053 entries and nothing reads it once the
 * tarball is packed and its oracle extracted, so packing frees it there
 * ({@link freeCheckout}) instead of leaving it to the teardown. The tool is
 * installed afterwards and proven byte-identical to the oracle, not to the
 * checkout. And when the last installer frees the cache it first records the
 * cache's entry count, so the cache's size is a measurement rather than an
 * estimate.
 * @module tests/fixtures/shared-runtime-hosts/teardown
 */
import { lstatSync, readdirSync, unlinkSync } from "node:fs";
import * as path from "node:path";

import { cleanupTempDir } from "../../helpers/test-utils.js";

/** Removes a directory the journey owns. */
type Remove = (directory: string) => Promise<void>;

/** Counts the entries under a directory. */
type Count = (directory: string) => number | undefined;

/**
 * Count every entry under a directory — files, directories and links — without
 * following a symbolic link and without counting the directory itself.
 * @param directory - Directory to count
 * @returns The entry count
 */
export function countTreeEntries(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) =>
      total +
      1 +
      (entry.isDirectory()
        ? countTreeEntries(path.join(directory, entry.name))
        : 0),
    0
  );
}

/**
 * Count a directory for a record, never letting the count fail the caller.
 * @param count - The counter
 * @param directory - Directory to count
 * @returns The count, or undefined when it could not be taken
 */
function countForRecord(count: Count, directory: string): number | undefined {
  try {
    return count(directory);
  } catch {
    return undefined;
  }
}

/**
 * Free the candidate's checkout once the tarball is packed and proven.
 *
 * The checkout's `node_modules` is a symbolic link to the repository's own, so
 * the link is unlinked first and the removal can never reach through it.
 * @param checkout - The candidate's checkout directory
 * @param remove - Removal; injected only by the regression
 */
export async function freeCheckout(
  checkout: string,
  remove: Remove = cleanupTempDir
): Promise<void> {
  const link = path.join(checkout, "node_modules");
  const linked = ((): boolean => {
    try {
      return lstatSync(link).isSymbolicLink();
    } catch {
      return false;
    }
  })();
  if (linked) unlinkSync(link);
  await remove(checkout);
}

/** The shared install cache's lifetime across the journey's cases. */
export interface SharedInstallCache {
  /** The shared cache directory. */
  readonly directory: string;
  /**
   * Record that an installing case has finished, freeing the cache when no
   * declared installer is left to run.
   * @param installer - The finished case's name
   * @returns Whether this call freed the cache
   */
  readonly finish: (installer: string) => Promise<boolean>;
  /**
   * Whether every declared installer has finished.
   * @returns True once the last installer has finished
   */
  readonly allFinished: () => boolean;
  /**
   * Whether the cache has actually been freed — its removal completed, not
   * merely started.
   * @returns True once a removal of the cache has resolved
   */
  readonly freed: () => boolean;
  /**
   * The cache's entry count, taken just before the latest removal that freed
   * it and could count it.
   * @returns The count, or undefined before a free or when it was unreadable
   */
  readonly entriesAtFree: () => number | undefined;
}

/**
 * Tie the shared Bun install cache's removal to the cases that install through
 * it.
 *
 * Installers are counted by name, so finishing one twice counts once. Every
 * finish once all of them have finished frees the cache, so a failed removal
 * is tried again by the next finish, and an installer that finishes again
 * after the cache was freed — a `--retry` that installed and so rebuilt it —
 * frees what it rebuilt; removing a cache already gone costs nothing. A run
 * that filters an installer out never finishes them all, and its cache is
 * left to the teardown's removal of the whole root, exactly as before.
 * @param cache - The shared cache directory, inside the owned root
 * @param installers - Every case that installs through the cache
 * @param remove - Removal; injected only by the regression
 * @param count - Entry counter, run before each removal; injected only by the
 *   regression. A count that fails is recorded as unknown, never as a failure.
 * @returns The cache's lifetime
 */
export function sharedInstallCache(
  cache: string,
  installers: readonly string[],
  remove: Remove = cleanupTempDir,
  count: Count = countTreeEntries
): SharedInstallCache {
  const state: {
    current: {
      readonly finished: ReadonlySet<string>;
      readonly freed: boolean;
      readonly entries: number | undefined;
    };
  } = { current: { finished: new Set(), freed: false, entries: undefined } };
  const allFinished = (): boolean =>
    installers.every(name => state.current.finished.has(name));
  return {
    directory: cache,
    allFinished,
    freed: () => state.current.freed,
    entriesAtFree: () => state.current.entries,
    finish: async installer => {
      if (!installers.includes(installer))
        throw new Error(
          `${installer} does not install through the shared cache`
        );
      state.current = {
        ...state.current,
        finished: new Set([...state.current.finished, installer]),
      };
      if (!allFinished()) return false;
      const entries = countForRecord(count, cache);
      await remove(cache);
      // A finish that finds the cache already gone counts nothing; it must
      // not erase the count the real free recorded.
      state.current = {
        ...state.current,
        entries: entries ?? state.current.entries,
      };
      state.current = { ...state.current, freed: true };
      return true;
    },
  };
}
