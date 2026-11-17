/**
 * Resolve the Docker CLI once, to an absolute path, the way `execFile` would
 * resolve a bare `docker`: the first executable `docker` on `PATH`.
 *
 * The packaged-apply controller and its fixtures each used to name a bare
 * `docker` (or guess fixed locations) on every call, so the binary that
 * started a container and the one that removed it could differ. Resolving
 * once and passing the one absolute path to every caller keeps start and
 * cleanup on the same CLI.
 * @module scripts/lib/docker-cli
 */
import { accessSync, constants } from "node:fs";
import path from "node:path";

/**
 * Find the Docker CLI on a `PATH` value.
 * @param {string | undefined} [pathValue] - The `PATH` to search, in order;
 *   this process's own `PATH` when omitted, which is what a bare `docker`
 *   handed to `execFile` would search
 * @returns {string} Absolute path of the first executable `docker`
 * @throws {Error} When no directory on `PATH` holds an executable `docker`
 */
export function resolveDockerCli(pathValue = process.env.PATH) {
  const directories = (pathValue ?? "")
    .split(path.delimiter)
    .filter(directory => path.isAbsolute(directory));
  const found = directories
    .map(directory => path.join(directory, "docker"))
    .find(candidate => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  if (found === undefined)
    throw new Error("Docker CLI not found on PATH; install Docker first");
  return found;
}
