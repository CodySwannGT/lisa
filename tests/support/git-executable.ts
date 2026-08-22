/**
 * An absolute git path and a git environment, shared by tests that shell out.
 *
 * Two reasons this is not `spawnSync("git", ...)` at each call site: the lint
 * ruleset refuses a command resolved through a writeable `PATH`, and fixture
 * repositories inherit `GIT_*` from the outer checkout, which silently points a
 * temp-repo command back at the repository the suite is running inside.
 * @module tests/support/git-executable
 */
import { accessSync, constants } from "node:fs";
import * as path from "node:path";

/**
 * Resolve git to an absolute executable path by scanning `PATH`.
 * @returns Absolute path to the git executable
 */
export function resolveGit(): string {
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
 * Environment without the outer repository's git state, so fixture repositories
 * are never contaminated by the worktree these tests run inside.
 * @returns Environment safe for fixture git commands
 */
export function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  return env;
}
