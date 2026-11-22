/**
 * Temp folders a test file creates, removed when that file finishes.
 *
 * The suite's contract since CodySwannGT/lisa#4602 is that each test removes
 * what it creates; nothing global audits it any more. Fixture helpers shared by
 * many files broke that contract quietly: they returned a fresh `mkdtemp`
 * folder per call and nothing ever removed it, and on 2026-11-20 one machine
 * held 122,618 such entries in `/private/tmp` (CodySwannGT/lisa#5095). This is
 * the smallest correction at the owning component — a fixture records each
 * folder it makes, and the file that used the fixture removes them in
 * `afterAll`, success or failure.
 *
 * Every folder is spelled `lisa-…`, whatever prefix the caller passed. A run
 * killed before `afterAll` still leaves its folders, and the start-of-run
 * sweep (#4597) reclaims only top-level `lisa-` / `lisa.` names once they are
 * a day old; a bare `maestro-runid-` or `vacuity-wiring-` folder was invisible
 * to it for good.
 * @module tests/helpers/owned-temp-dirs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll } from "vitest";

/** Folders one owner created, and the means to remove them all. */
export interface OwnedTempDirs {
  /**
   * Create a folder under the platform temp root and record it.
   * @param prefix - The `mkdtemp` prefix, ending in `-`; `lisa-` is
   *   prepended when it is missing
   * @returns The new folder's path
   */
  readonly make: (prefix: string) => string;
  /** Remove every recorded folder; safe to call more than once. */
  readonly removeAll: () => void;
}

/**
 * Removal retries, for the errno set a concurrent writer produces; the same
 * reasoning as `cleanupTempDir` in `test-utils.ts`.
 */
const REMOVAL_RETRIES = 10;

/** The name prefix the start-of-run sweep recognises as Lisa's. */
const SWEEPABLE_PREFIX = "lisa-";

/**
 * The prefix spelled so the start-of-run sweep can reclaim a killed run's folder.
 * @param prefix - The caller's prefix
 * @returns The prefix, starting with `lisa-`
 */
export function sweepablePrefix(prefix: string): string {
  return prefix.startsWith(SWEEPABLE_PREFIX)
    ? prefix
    : `${SWEEPABLE_PREFIX}${prefix}`;
}

/**
 * A recorder of temp folders, with no test-runner wiring.
 * @returns The recorder
 */
export function ownedTempDirs(): OwnedTempDirs {
  const recorder = new TempDirRecorder();
  return {
    make: prefix => recorder.make(prefix),
    removeAll: () => recorder.removeAll(),
  };
}

/** Holds the folders made so far; a class is this repository's mutable-state shape. */
class TempDirRecorder {
  private readonly created = new Set<string>();

  /**
   * Create and record one folder.
   * @param prefix - The `mkdtemp` prefix
   * @returns The new folder's path
   */
  make(prefix: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), sweepablePrefix(prefix)));
    this.created.add(dir);
    return dir;
  }

  /** Remove every recorded folder and forget it. */
  removeAll(): void {
    const dirs = [...this.created];
    this.created.clear();
    dirs.forEach(dir =>
      rmSync(dir, { force: true, maxRetries: REMOVAL_RETRIES, recursive: true })
    );
  }
}

/**
 * A recorder whose folders are removed when the importing test file finishes.
 *
 * Call it at module level from a fixture helper or a test file: the
 * `afterAll` it registers belongs to the file being collected, so every file
 * that imports the helper removes what the helper made for it.
 * @returns The folder factory
 */
export function useOwnedTempDirs(): OwnedTempDirs["make"] {
  const owned = ownedTempDirs();
  afterAll(owned.removeAll);
  return owned.make;
}
