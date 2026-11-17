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
export const PRE_COMMIT_CONFIG = ".pre-commit-config.yaml";

/** Every name Lefthook reads its configuration from, YAML first. */
export const LEFTHOOK_CONFIGS = [
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
}

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
 * Name a path the way a person reads it: from the repository root when it is
 * inside the repository, in full when it is not.
 * @param root - Real path of the repository
 * @param absolute - The path
 * @returns The path as it is shown
 */
export function shownPath(root: string, absolute: string): string {
  return isWithin(root, absolute)
    ? path.relative(root, absolute).split(path.sep).join("/")
    : absolute;
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
  const [hooksPath, folder] = await Promise.all([
    git.hooksPath(root),
    git.hooksFolder(root),
  ]);
  const hooksFolder = await realPathOf(folder);
  const hooksPathSet = hooksPath !== null;
  const [husky, lefthook, preCommit, byHand] = await Promise.all([
    pathKind(path.join(root, HUSKY_FOLDER)),
    firstFile(root, LEFTHOOK_CONFIGS),
    firstFile(root, [PRE_COMMIT_CONFIG]),
    holdsHooks(hooksFolder),
  ]);
  const found = (owner: HookOwner, managerFile: string | null): HookFacts => ({
    hooksFolder,
    hooksPathSet,
    managerFile,
    owner,
  });
  if (hooksPathSet) return found(ownerOfHooksPath(root, hooksFolder), null);
  if (husky === "folder") return found("husky", null);
  if (lefthook !== null) return found("lefthook", lefthook);
  if (preCommit !== null) return found("pre-commit", preCommit);
  return found(byHand ? "git-hooks" : "none", null);
}
