/**
 * Make a pinned commit readable in a shallow checkout (#4521).
 *
 * The audit action pin test reads the pinned commit's files with `git show`.
 * Hosted CI checks the pull request out at depth 1, where the pinned commit (an
 * ancestor of the head) is not present, so the read failed for a reason that
 * says nothing about the pin. In a shallow repository the one commit is fetched
 * by SHA first. A full clone is never touched, and a commit that still cannot be
 * read stays a failure: the pin must name a commit the remote actually holds.
 * @module tests/helpers/pinned-revision
 */
import { boundedSpawnSync } from "./io-latency-budget.js";

/**
 * Run git in a repository and return its status and stdout.
 * @param cwd - Repository directory
 * @param args - git arguments
 * @returns Exit status and stdout
 */
function git(cwd: string, args: readonly string[]) {
  const result = boundedSpawnSync({
    label: "pinned revision readback",
    command: "git",
    args: [...args],
    cwd,
  });
  return { status: result.status, stdout: String(result.stdout ?? "").trim() };
}

/**
 * Ensure a commit is present, fetching it by SHA only in a shallow clone.
 * @param revision - Full 40-character commit SHA
 * @param cwd - Repository directory
 * @returns How the commit became readable, or "unavailable"
 */
export function ensurePinnedRevision(
  revision: string,
  cwd = process.cwd()
): "present" | "fetched" | "unavailable" {
  const present = () =>
    git(cwd, ["cat-file", "-e", `${revision}^{commit}`]).status === 0;
  if (present()) return "present";
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]).stdout !== "true")
    return "unavailable";
  git(cwd, ["fetch", "--no-tags", "--depth=1", "origin", revision]);
  return present() ? "fetched" : "unavailable";
}
