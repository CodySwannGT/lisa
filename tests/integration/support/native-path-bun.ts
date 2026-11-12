/** Defer native dual-lock cases when PATH's first `bun` is not the native executable. */
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { deferToCi } from "../../support/ci-runtime.js";

/**
 * Whether the first `bun` on PATH is the native executable the updater's
 * `qualifiedBun` accepts: absolute, a regular file, not a symlink, one hard
 * link, and its own realpath. Mirrors that identity check so a developer
 * machine whose PATH puts a symlinked bun first (an npm-global shim) defers
 * instead of failing a push gate for a reason unrelated to the change.
 * @param pathValue - PATH to search
 * @returns True when the updater would accept the PATH's bun
 */
export function pathBunIsNative(
  pathValue: string | undefined = process.env.PATH
): boolean {
  const candidate = (pathValue ?? "")
    .split(":")
    .filter(isAbsolute)
    .map(directory => join(directory, "bun"))
    .find(existsSync);
  if (candidate === undefined) return false;
  const stat = lstatSync(candidate);
  return (
    stat.isFile() &&
    !stat.isSymbolicLink() &&
    stat.nlink === 1 &&
    realpathSync(candidate) === candidate
  );
}

/**
 * Call first in a test that needs the native Bun. Returns when it is present;
 * otherwise skips the test locally with a named note, and fails in CI, which
 * provisions it.
 */
export function requireNativeBun(): void {
  if (pathBunIsNative()) return;
  deferToCi(
    "a native (non-symlinked) Bun first on PATH",
    "Put the real Bun executable ahead of any npm-global or shim `bun`, e.g. `mise use bun@1.4.4`."
  );
}
