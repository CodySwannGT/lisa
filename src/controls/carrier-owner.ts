/**
 * Who owns git hooks in a repository.
 *
 * A carrier must never take hooks away from whatever already runs them, so
 * before anything is written the command works out who that is. The evidence
 * is weighed in a fixed order, strongest first:
 *
 * 1. `core.hooksPath`: git runs hooks from the folder it names and from
 *    nowhere else. That folder may be Husky's, Lisa's own, or the
 *    repository's.
 * 2. A `.husky` folder: Husky is set up, even where this checkout has not
 *    switched it on yet.
 * 3. A Lefthook configuration file.
 * 4. A `.pre-commit-config.yaml`: the pre-commit framework.
 * 5. A hook written by hand in git's own hooks folder.
 *
 * With none of these, nothing owns hooks and the command may.
 * @module controls/carrier-owner
 */
import { readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import type { CarrierGit } from "./carrier-git.js";
import { CARRIER_HOOKS_FOLDER, type HookOwner } from "./carrier-types.js";

/** Husky's folder, from the repository root. */
export const HUSKY_FOLDER = ".husky";

/** The pre-commit framework's configuration, from the repository root. */
const PRE_COMMIT_CONFIG = ".pre-commit-config.yaml";

/** Every name Lefthook reads its configuration from, YAML first. */
const LEFTHOOK_CONFIGS = [
  "lefthook.yml",
  "lefthook.yaml",
  ".lefthook.yml",
  ".lefthook.yaml",
  ".config/lefthook.yml",
  ".config/lefthook.yaml",
  "lefthook.toml",
  "lefthook.json",
  ".lefthook.toml",
  ".lefthook.json",
  ".config/lefthook.toml",
  ".config/lefthook.json",
] as const;

/** The ending of the example hooks git puts in every new repository. */
const SAMPLE_SUFFIX = ".sample";

/** What the command found out about hooks in one checkout. */
export interface HookFacts {
  /** Who owns the hooks. */
  readonly owner: HookOwner;
  /** The folder git runs hooks from in this checkout, as a real path. */
  readonly hooksFolder: string;
  /** Whether `core.hooksPath` is set in this checkout. */
  readonly hooksPathSet: boolean;
  /** The hook manager's configuration file, from the repository root. */
  readonly managerFile: string | null;
  /**
   * The folder every working tree of the repository shares (git's own
   * folder), as a real path; `null` when git was not asked for it.
   */
  readonly commonFolder: string | null;
  /**
   * Whether the repository has another working tree. Git's own hooks folder
   * and the repository's configuration are then shared with it: a hook
   * written there, or `core.hooksPath` set there, takes effect in every one.
   */
  readonly sharedByCheckouts: boolean;
}

/** How git's shared folder is named in a path shown to a person. */
export const GIT_COMMON_FOLDER_SHOWN = "<git-common-dir>";

/** How any other folder outside the checkout is named. */
export const OUTSIDE_SHOWN = "<outside the checkout>";

/**
 * Resolve a path that may not exist yet to the real path it would have.
 * @param target - An absolute path
 * @returns The real path of its deepest existing folder, plus the rest
 */
export async function realPathOf(target: string): Promise<string> {
  try {
    return await realpath(target);
  } catch {
    const parent = path.dirname(target);
    return parent === target
      ? target
      : path.join(await realPathOf(parent), path.basename(target));
  }
}

/**
 * Tell whether a path is a folder or inside it.
 * @param folder - The folder, as a real path
 * @param target - The path, as a real path
 * @returns Whether the path is the folder or below it
 */
export function isWithin(folder: string, target: string): boolean {
  return target === folder || target.startsWith(`${folder}${path.sep}`);
}

/**
 * Name a path the way a person reads it, never as a path of the machine.
 *
 * A result is printed, saved and passed on, and a path outside the checkout
 * holds the operator's own folder names. So a path is named from the
 * repository root when it is inside the checkout; from git's shared folder,
 * written {@link GIT_COMMON_FOLDER_SHOWN}, when it is inside that (a hook of
 * a linked working tree is; `git rev-parse --git-common-dir` prints the
 * folder); and otherwise by its file name alone, after
 * {@link OUTSIDE_SHOWN}.
 * @param root - Real path of the repository
 * @param absolute - The path
 * @param commonFolder - Real path of git's shared folder, when it is known
 * @returns The path as it is shown
 */
export function shownPath(
  root: string,
  absolute: string,
  commonFolder: string | null = null
): string {
  const from = (folder: string): string =>
    path.relative(folder, absolute).split(path.sep).join("/");
  if (isWithin(root, absolute)) return from(root);
  return commonFolder !== null && isWithin(commonFolder, absolute)
    ? `${GIT_COMMON_FOLDER_SHOWN}/${from(commonFolder)}`
    : `${OUTSIDE_SHOWN}/${path.basename(absolute)}`;
}

/**
 * Find the first of a list of files that exists.
 * @param root - Real path of the repository
 * @param candidates - Paths from the repository root, in order
 * @returns The first that is an ordinary file, or `null`
 */
async function firstFile(
  root: string,
  candidates: readonly string[]
): Promise<string | null> {
  const kinds = await Promise.all(
    candidates.map(candidate => pathKind(path.join(root, candidate)))
  );
  return candidates.find((_, index) => kinds[index] === "file") ?? null;
}

/**
 * Tell whether a hooks folder holds a hook someone wrote.
 * @param folder - The hooks folder
 * @returns Whether it holds anything but git's example hooks
 */
async function holdsHooks(folder: string): Promise<boolean> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.some(
      entry => !entry.isDirectory() && !entry.name.endsWith(SAMPLE_SUFFIX)
    );
  } catch {
    return false;
  }
}

/**
 * Name the owner a set `core.hooksPath` points at.
 * @param root - Real path of the repository
 * @param hooksFolder - The folder git runs hooks from, as a real path
 * @returns Lisa, Husky, or the repository's own folder
 */
function ownerOfHooksPath(root: string, hooksFolder: string): HookOwner {
  if (hooksFolder === path.join(root, CARRIER_HOOKS_FOLDER)) return "lisa";
  return isWithin(path.join(root, HUSKY_FOLDER), hooksFolder)
    ? "husky"
    : "hooks-path";
}

/**
 * Work out who owns git hooks in a checkout.
 * @param root - Real path of the repository
 * @param git - Git
 * @returns The owner and where hooks run from
 */
export async function detectHookOwner(
  root: string,
  git: CarrierGit
): Promise<HookFacts> {
  const [hooksPath, folder, common, workingTrees] = await Promise.all([
    git.hooksPath(root),
    git.hooksFolder(root),
    git.commonFolder?.(root) ?? null,
    git.workingTrees?.(root) ?? 1,
  ]);
  const hooksFolder = await realPathOf(folder);
  const commonFolder = common === null ? null : await realPathOf(common);
  const hooksPathSet = hooksPath !== null;
  const [husky, lefthook, preCommit, byHand] = await Promise.all([
    pathKind(path.join(root, HUSKY_FOLDER)),
    firstFile(root, LEFTHOOK_CONFIGS),
    firstFile(root, [PRE_COMMIT_CONFIG]),
    holdsHooks(hooksFolder),
  ]);
  const found = (owner: HookOwner, managerFile: string | null): HookFacts => ({
    commonFolder,
    hooksFolder,
    hooksPathSet,
    managerFile,
    owner,
    sharedByCheckouts: workingTrees > 1,
  });
  if (hooksPathSet) return found(ownerOfHooksPath(root, hooksFolder), null);
  if (husky === "folder") return found("husky", null);
  if (lefthook !== null) return found("lefthook", lefthook);
  if (preCommit !== null) return found("pre-commit", preCommit);
  return found(byHand ? "git-hooks" : "none", null);
}
