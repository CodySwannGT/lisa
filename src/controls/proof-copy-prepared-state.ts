/** Preserve prepared runtime files outside the disposable Git index. */
import { cpSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { outputWithoutSecretValues } from "./evidence-redact.js";
import { isPlainPath } from "./proof-copy-files.js";
import { copyGit, gitSaid } from "./proof-copy-git.js";

/** A prepared file or directory, stored outside the Git working tree. */
interface PreparedPath {
  readonly name: string;
  readonly backedUp: boolean;
}

/** Files a preparation changed, kept outside the proof commits. */
export interface PreparedProofCopy {
  readonly backup: string;
  readonly paths: readonly PreparedPath[];
}

/**
 * Report whether a file exists without following a symlink at its own path.
 * @param file - File, symlink or directory
 * @returns Whether the path exists
 */
function hasPath(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Copy a working-tree path without following symlinks to outside the copy.
 * @param from - Source path inside an owned scratch directory
 * @param to - Destination path inside an owned scratch directory
 */
function copyPreparedPath(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
  });
}

/**
 * Keep generated files and tracked preparation changes outside Git so every
 * proof half can return to the same state without re-running preparation.
 * @param clone - The prepared working copy
 * @param backup - Private sibling directory for the snapshot
 * @param base - The clone's commit before preparation
 * @returns The snapshot or a reason the copy cannot be used
 */
export function snapshotPreparedCopy(
  clone: string,
  backup: string,
  base: string
):
  | { readonly problem: null; readonly preparation: PreparedProofCopy }
  | { readonly problem: string } {
  const git = copyGit(clone);
  const listed = [
    git(["diff", "--name-only", "--no-renames", "-z", base, "--"]),
    git(["ls-files", "--others", "--exclude-standard", "--directory", "-z"]),
    git([
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "-z",
    ]),
  ];
  const failed = listed.find(exit => exit.code !== 0);
  if (failed !== undefined)
    return {
      problem: `Could not inventory the prepared proof copy: ${outputWithoutSecretValues(gitSaid(failed))}`,
    };
  const names = [
    ...new Set(
      listed
        .flatMap(exit => exit.stdout.split("\0"))
        .filter(Boolean)
        .map(name => name.replace(/\/$/u, ""))
    ),
  ];
  if (names.some(name => !isPlainPath(name))) {
    return {
      problem:
        "Proof copy preparation produced a path that cannot be preserved safely.",
    };
  }
  const unique = new Set(names);
  const roots = names.filter(name => {
    const parts = name.split("/");
    return !parts
      .slice(0, -1)
      .some((_, index) => unique.has(parts.slice(0, index + 1).join("/")));
  });
  try {
    const paths = roots.map(name => {
      const file = path.join(clone, name);
      const backedUp = hasPath(file);
      if (backedUp) copyPreparedPath(file, path.join(backup, name));
      return { name, backedUp };
    });
    return { problem: null, preparation: { backup, paths } };
  } catch (error) {
    return {
      problem: `Could not preserve the prepared proof files: ${outputWithoutSecretValues(String(error))}`,
    };
  }
}

/**
 * Restore the runtime files after Git has reset and cleaned the working tree.
 * @param clone - The proof working copy
 * @param preparation - The recorded state after the prepare commands
 * @returns An error when the prepared state could not be restored
 */
export function restorePreparedCopy(
  clone: string,
  preparation: PreparedProofCopy
): string | null {
  try {
    for (const { name, backedUp } of preparation.paths) {
      const restored = path.join(clone, name);
      rmSync(restored, { recursive: true, force: true });
      if (backedUp)
        copyPreparedPath(path.join(preparation.backup, name), restored);
    }
    return null;
  } catch (error) {
    return outputWithoutSecretValues(String(error));
  }
}
