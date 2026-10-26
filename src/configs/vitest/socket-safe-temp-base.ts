/**
 * Pick a temp base short enough for supervised native Unix socket fixtures.
 *
 * macOS gives each user a TMPDIR under `/var/folders/…` of about 48 bytes.
 * Supervised fixtures bind sockets at
 * `<base>/lisa-scratch/run-<pid>-<epoch>-<suffix>/u-XXXXXX/<socket>`, and a
 * Unix socket path over 103 bytes cannot be bound, so on a stock Mac those
 * tests failed before asserting anything unless the developer happened to
 * export a short TMPDIR. Linux CI runners use `/tmp` and never reach this.
 *
 * Only that stock macOS default is replaced. Any other TMPDIR was chosen on
 * purpose (a nested run's scratch root, an operator's override) and is kept
 * even when long; the fixture then reports the length itself.
 * @module configs/vitest/socket-safe-temp-base
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Longest Unix socket path every supported platform can bind. */
export const UNIX_SOCKET_PATH_LIMIT = 103;

/**
 * Bytes a supervised fixture adds below the base, at the longest pid (7
 * digits), a 13-digit epoch and the longest socket name in use.
 */
const FIXTURE_SUFFIX_BYTES = Buffer.byteLength(
  "/lisa-scratch/run-4194304-1792777528381-b0e12b9d/u-XXXXXX/hook-reader.sock"
);

/** Longest temp base that still fits a fixture socket. */
export const MAX_SOCKET_SAFE_TEMP_BASE_BYTES =
  UNIX_SOCKET_PATH_LIMIT - FIXTURE_SUFFIX_BYTES;

/** macOS's per-user default temp dir (`confstr(_CS_DARWIN_USER_TEMP_DIR)`). */
const DARWIN_DEFAULT_TEMP = /^\/(?:private\/)?var\/folders\//;

/** Filesystem seam for tests. */
export interface TempBaseFs {
  readonly realpathSync: (target: string) => string;
  readonly lstatSync: (target: string) => fs.Stats;
  readonly accessSync: (target: string, mode: number) => void;
}

const NODE_FS: TempBaseFs = {
  realpathSync: target => fs.realpathSync(target),
  lstatSync: target => fs.lstatSync(target),
  accessSync: (target, mode) => fs.accessSync(target, mode),
};

/**
 * A short, real, writable replacement for macOS's stock temp dir when it is
 * too long, else undefined (keep `current`). Never returns a symlink:
 * the scratch namespace refuses a symlinked base, so `/tmp` is resolved to its
 * physical directory (`/private/tmp` on macOS) first.
 * @param current - The temp base the run would otherwise use
 * @param platform - Platform to decide for
 * @param seam - Filesystem seam
 * @returns Replacement base, or undefined to keep `current`
 */
export function socketSafeTempBase(
  current: string,
  platform: NodeJS.Platform = process.platform,
  seam: TempBaseFs = NODE_FS
): string | undefined {
  if (platform !== "darwin" || !DARWIN_DEFAULT_TEMP.test(current)) {
    return undefined;
  }
  if (Buffer.byteLength(current) <= MAX_SOCKET_SAFE_TEMP_BASE_BYTES) {
    return undefined;
  }
  try {
    const candidate = seam.realpathSync(`${path.sep}tmp`);
    const stat = seam.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return undefined;
    seam.accessSync(candidate, fs.constants.W_OK);
    return Buffer.byteLength(candidate) <= MAX_SOCKET_SAFE_TEMP_BASE_BYTES
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}
