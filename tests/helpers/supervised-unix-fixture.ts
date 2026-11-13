/**
 * A private, shallow temp directory for a native pathname-socket fixture.
 *
 * A Unix socket path over 103 bytes cannot be bound, so the directory sits
 * directly under the run's temp base, which `lisa-test-run` has already moved
 * off a too-long macOS default (`src/configs/vitest/socket-safe-temp-base.ts`).
 * The supervision lease and owner record this used to require were retired with
 * the per-test scratch policing (CodySwannGT/lisa#4602); the caller still
 * removes what it creates by calling `close`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UNIX_SOCKET_PATH_LIMIT } from "../../src/configs/vitest/socket-safe-temp-base.js";

/** The socket names fixtures bind. */
export type UnixFixtureSocket = "controller.sock" | "hook-reader.sock";

/**
 * Create a private directory short enough to bind the named socket in.
 * @param socket - The socket basename the fixture will bind.
 * @param base - Temp base to create it under; defaults to the run's.
 * @returns The directory and a cleanup function.
 */
export function createSupervisedUnixFixture(
  socket: UnixFixtureSocket,
  base: string = tmpdir()
): { readonly root: string; readonly close: () => void } {
  const prefix = join(base, "lisa-u-");
  if (
    Buffer.byteLength(join(`${prefix}XXXXXX`, socket)) > UNIX_SOCKET_PATH_LIMIT
  ) {
    throw new Error(
      `Native Unix fixture needs a temp base short enough for a ${String(UNIX_SOCKET_PATH_LIMIT)}-byte socket path; ${base} is too long`
    );
  }
  const root = mkdtempSync(prefix);
  return {
    root,
    close: (): void => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
