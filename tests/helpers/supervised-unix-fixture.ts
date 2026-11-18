/**
 * A private, shallow temp directory for a native pathname-socket fixture.
 *
 * A Unix socket path over 103 bytes cannot be bound, so the directory sits
 * directly under the run's temp base, which `lisa-test-run` has already moved
 * off a too-long macOS default (`src/configs/vitest/socket-safe-temp-base.ts`).
 * The supervision lease and owner record this used to require were retired with
 * the per-test scratch policing (CodySwannGT/lisa#4602); the caller still
 * removes what it creates by calling `close`.
 *
 * The root is returned as its real path. A fixture that hands the root to a
 * native consumer which refuses non-canonical paths (the driver probe's
 * profile check) must not depend on the temp base being symlink-free: macOS's
 * default `/var/folders/...` base lives under the `/var` -> `/private/var`
 * symlink (CodySwannGT/lisa#4937).
 */
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UNIX_SOCKET_PATH_LIMIT } from "../../src/configs/vitest/socket-safe-temp-base.js";

/** The socket names fixtures bind. */
export type UnixFixtureSocket = "controller.sock" | "hook-reader.sock";

/**
 * Whether a fixture socket under this temp base can be bound.
 * @param base - Temp base the fixture directory would be created under.
 * @param socket - The socket basename the fixture will bind.
 * @returns True when the longest possible socket path fits the limit.
 */
function socketFits(base: string, socket: UnixFixtureSocket): boolean {
  return (
    Buffer.byteLength(join(`${join(base, "lisa-u-")}XXXXXX`, socket)) <=
    UNIX_SOCKET_PATH_LIMIT
  );
}

/**
 * The refusal for a temp base too long to bind the fixture socket.
 * @param base - The refused temp base.
 * @returns The error to throw.
 */
function tooLong(base: string): Error {
  return new Error(
    `Native Unix fixture needs a temp base short enough for a ${String(UNIX_SOCKET_PATH_LIMIT)}-byte socket path; ${base} is too long`
  );
}

/**
 * Create a private directory short enough to bind the named socket in.
 * @param socket - The socket basename the fixture will bind.
 * @param base - Temp base to create it under; defaults to the run's.
 * @returns The directory, as its real path, and a cleanup function.
 */
export function createSupervisedUnixFixture(
  socket: UnixFixtureSocket,
  base: string = tmpdir()
): { readonly root: string; readonly close: () => void } {
  if (!socketFits(base, socket)) throw tooLong(base);
  // Resolve the base before creating anything, and bound the socket path
  // against the real path the fixture will actually hand out.
  const canonicalBase = realpathSync(base);
  if (!socketFits(canonicalBase, socket)) throw tooLong(canonicalBase);
  const root = mkdtempSync(join(canonicalBase, "lisa-u-"));
  return {
    root,
    close: (): void => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
