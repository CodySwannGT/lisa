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
 * native `rmSync` thread was two to three times slower. So the removal could
 * not be made fast enough to fit reliably in the teardown's 30 s; it could
 * only be made smaller.
 *
 * ## Why the cache, and why its last installer
 *
 * A host's `node_modules` holds a second hard link to each cache file, so a
 * case removing its own host frees almost nothing: the cache still holds the
 * data, and the teardown then freed all of it. The cache's last real user is
 * the last installing case, and the journey already frees each host inside
 * that host's own case budget for this same reason. So the cache is freed
 * there too, by whichever installing case finishes last, and the teardown
 * frees only the candidate's own fixtures — its checkout, oracle and
 * installed tool — and the evidence.
 * @module tests/fixtures/shared-runtime-hosts/teardown
 */
import { cleanupTempDir } from "../../helpers/test-utils.js";

/** Removes a directory the journey owns. */
type Remove = (directory: string) => Promise<void>;

/** The shared install cache's lifetime across the journey's cases. */
export interface SharedInstallCache {
  /** The shared cache directory. */
  readonly directory: string;
  /**
   * Record that an installing case has finished, freeing the cache when no
   * declared installer is left to run and it has not been freed yet.
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
}

/**
 * Tie the shared Bun install cache's removal to the cases that install through
 * it.
 *
 * Installers are counted by name, so finishing one twice counts once, and the
 * cache is removed at most once after a removal succeeds; a failed removal is
 * tried again by the next finish. A run that filters an installer out never
 * finishes them all, and its cache is left to the teardown's removal of the
 * whole root, exactly as before. The suite configures no retries; under
 * `--retry` a failed last installer would free the cache before its retry ran,
 * and that retry would install into an empty cache.
 * @param cache - The shared cache directory, inside the owned root
 * @param installers - Every case that installs through the cache
 * @param remove - Removal; injected only by the regression
 * @returns The cache's lifetime
 */
export function sharedInstallCache(
  cache: string,
  installers: readonly string[],
  remove: Remove = cleanupTempDir
): SharedInstallCache {
  const state: {
    current: {
      readonly finished: ReadonlySet<string>;
      readonly freed: boolean;
    };
  } = { current: { finished: new Set(), freed: false } };
  const allFinished = (): boolean =>
    installers.every(name => state.current.finished.has(name));
  return {
    directory: cache,
    allFinished,
    freed: () => state.current.freed,
    finish: async installer => {
      if (!installers.includes(installer))
        throw new Error(
          `${installer} does not install through the shared cache`
        );
      state.current = {
        ...state.current,
        finished: new Set([...state.current.finished, installer]),
      };
      // TDD RED: the cache is still left to the teardown, as it always was;
      // `remove` stays unused until the last installer frees it.
      return allFinished() && remove === undefined;
    },
  };
}
