/**
 * An absolute git path and a git environment, shared by tests that shell out.
 *
 * Two reasons this is not `spawnSync("git", ...)` at each call site: the lint
 * ruleset refuses a command resolved through a writeable `PATH`, and fixture
 * repositories inherit `GIT_*` from the outer checkout, which silently points a
 * temp-repo command back at the repository the suite is running inside.
 * @module tests/support/git-executable
 */
import { accessSync, constants, existsSync } from "node:fs";
import * as path from "node:path";

/**
 * Fixed absolute git locations, in the order they are tried.
 *
 * Fixed locations rather than a bare command name, so a writeable directory
 * early on `PATH` cannot decide which binary a test executes.
 *
 * Order within that constraint is set by measurement. Dispatching through the
 * shim costs a **median 33 ms against 15 ms** for either developer-directory
 * git, and **100 ms against 21 ms at p90** — randomized call order, fixed
 * inter-call gaps, `git rev-parse --show-toplevel`, n=30 each (lisa#2898).
 * The call does no work; the difference is the dispatch.
 *
 * The two entries promoted ahead of the shim are the developer-directory gits
 * the shim itself re-executes. Both are `root:wheel` files in system
 * locations, so this is the same trust class as `/usr/bin/git` and NOT a
 * relaxation — the user-writable Homebrew and `/usr/local` entries stay last,
 * where they already were. On Linux neither promoted path exists, so CI
 * resolves `/usr/bin/git` exactly as before.
 */
export const GIT_CANDIDATES: readonly string[] = Object.freeze([
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/opt/homebrew/bin/git",
  "/usr/local/bin/git",
]);

/**
 * The path that is not git.
 *
 * On macOS `/usr/bin/git` is Apple's `xcrun` shim, which locates a developer
 * directory and re-executes the real binary there. Exported so a guard test can
 * pin it by name rather than by string literal.
 */
export const XCRUN_SHIM = "/usr/bin/git";

/**
 * Resolve git to an absolute executable path.
 *
 * The fixed candidates are tried first; a `PATH` scan is the fallback for
 * layouts none of them cover (Windows git-bash, a container with git somewhere
 * unusual).
 * @returns Absolute path to the git executable
 */
export function resolveGit(): string {
  const fixed = GIT_CANDIDATES.find(candidate => existsSync(candidate));
  if (fixed !== undefined) return fixed;
  const found = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(directory => directory !== "")
    .map(directory => path.join(directory, "git"))
    .find(candidate => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (found === undefined) {
    throw new Error("git executable not found on PATH");
  }
  return found;
}

/**
 * The resolved git path, computed once.
 *
 * Call sites that only need a constant should use this rather than calling
 * {@link resolveGit} at module scope, so the filesystem probe happens once per
 * process instead of once per test file.
 */
export const GIT_BIN: string = resolveGit();

/**
 * Environment without the outer repository's git state, so fixture repositories
 * are never contaminated by the worktree these tests run inside.
 * @returns Environment safe for fixture git commands
 */
export function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // `LISA_PUSHED_REFS_FILE` is not git's, but it is injected by the same hook
    // and carries the same hazard: it names the REAL push's refs, so a fixture
    // that inherits it stops being about its own repository
    // (CodySwannGT/lisa#3874).
    if (key.startsWith("GIT_") || key === "LISA_PUSHED_REFS_FILE") {
      delete env[key];
    }
  }
  return env;
}
