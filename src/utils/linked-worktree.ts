import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Resolve the primary checkout root when a directory is a linked git
 * worktree.
 *
 * A linked worktree has a `.git` FILE containing
 * `gitdir: <primary>/.git/worktrees/<name>`; a primary checkout has a `.git`
 * directory. Parsing the file avoids spawning git — this runs inside
 * package-manager lifecycle scripts where every child process is a
 * measurable cost. Submodule `.git` files point at `.git/modules/<name>` and
 * deliberately do not match. The primary is only returned when its `.claude`
 * directory exists, mirroring install-claude-plugins.sh and the
 * install-pkgs.sh node_modules link (add08b409).
 * @param dir - Directory to inspect (typically the Lisa destDir)
 * @returns Primary checkout root, or null when dir is not a linked worktree
 *   of a reachable primary checkout
 */
export async function resolvePrimaryWorktreeRoot(
  dir: string
): Promise<string | null> {
  const resolvedDir = path.resolve(dir);
  const gitdirContent = await readFile(
    path.join(resolvedDir, ".git"),
    "utf-8"
  ).catch(() => null);
  if (gitdirContent === null) {
    return null;
  }
  const gitdirMatch = /^gitdir:(.*)$/m.exec(gitdirContent);
  const gitdirTarget = gitdirMatch?.[1]?.trim();
  if (gitdirTarget === undefined || gitdirTarget === "") {
    return null;
  }
  const gitdir = path.resolve(resolvedDir, gitdirTarget);
  const worktreesMatch = /^(.*)[/\\]\.git[/\\]worktrees[/\\][^/\\]+$/.exec(
    gitdir
  );
  if (!worktreesMatch?.[1]) {
    return null;
  }
  const primaryRoot = worktreesMatch[1];
  if (primaryRoot === resolvedDir) {
    return null;
  }
  return existsSync(path.join(primaryRoot, ".claude")) ? primaryRoot : null;
}
