/**
 * The `.mjs` files Lisa ships, split by whether a push can actually carry them.
 *
 * @remarks
 * Two suites — `eslint-shipped-mjs-clean` and `eslint-shipped-mjs-coverage` —
 * each discovered the shipped payload by walking `<stack>/copy-overwrite/`
 * trees on disk, and each wrote its own walk. Disk looks like the right
 * authority, because `copy-overwrite` is what the installer reads. It is the
 * wrong authority for a **push gate**, and CodySwannGT/lisa#2824 is what that
 * cost:
 *
 * An agent created an untracked `.mjs` under a shipped tree. A DIFFERENT agent
 * sharing the checkout was blocked from pushing by four lint findings in it.
 * Every route to understanding the failure was closed — the file was not in the
 * index, so `git status` showed nothing; not in the commit, so the diff could
 * not find it; and unattributable from the pushing side, so it was blamed on a
 * third agent who had never touched it. The gate is required, so there was no
 * proceeding. Two sessions spent a round trip establishing "not mine".
 *
 * ## The property, stated as a property
 *
 * A push gate governs **what the push contains**. That is the index, and it is
 * not a glob that happens to miss today's scratch files — a glob tuned to the
 * current directory layout is the same defect with a longer fuse. An untracked
 * file is in no commit, so it cannot reach a published package, which is the
 * thing these suites protect.
 *
 * ## Nothing stops being examined
 *
 * Narrowing what a gate BLOCKS on is not a licence to narrow what it LOOKS at.
 * Untracked files under a shipped tree are still discovered and still linted;
 * they simply report instead of blocking, and they say plainly that they are
 * untracked and where they are. An author who forgot to `git add` gets told; an
 * author who never created the file is not stopped by it.
 * @module tests/helpers/shipped-mjs-roster
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { trackedPaths } from "./tracked-files.js";

/** Directory name marking a tree the installer copies into a consumer. */
const COPY_OVERWRITE = "copy-overwrite";

/**
 * Order paths without a bare `.sort()`, which is `javascript:S2871` — the
 * finding that started this whole line of work.
 * @param left - First path
 * @param right - Second path
 * @returns Standard comparator result
 */
function byPath(left: string, right: string): number {
  return left < right ? -1 : Number(left > right);
}

/**
 * Whether a repo-relative path is a `.mjs` file Lisa copies into a consumer.
 *
 * Mirrors what the filesystem walk selected — a `copy-overwrite` directory at
 * the second segment of a top-level directory that is not dot-prefixed — with
 * no regular expression, so no ReDoS rule has an opinion about it.
 * @param repoRelative - Repo-relative path, forward-slash separated
 * @returns True when the path is part of the shipped `.mjs` payload
 */
export function isShippedMjs(repoRelative: string): boolean {
  if (!repoRelative.endsWith(".mjs")) return false;
  const segments = repoRelative.split("/");
  if (segments.length < 3) return false;
  const top = segments[0] ?? "";
  return top !== "" && !top.startsWith(".") && segments[1] === COPY_OVERWRITE;
}

/**
 * Every `.mjs` file beneath a directory, repo-relative.
 * @param root - Repository root
 * @param dir - Absolute directory to walk
 * @returns Repo-relative paths of every `.mjs` file beneath it
 */
function walkMjs(root: string, dir: string): readonly string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkMjs(root, full);
    return entry.isFile() && entry.name.endsWith(".mjs")
      ? [path.relative(root, full).split(path.sep).join("/")]
      : [];
  });
}

/**
 * Every shipped `.mjs` file present on disk, tracked or not.
 * @param root - Repository root
 * @returns Repo-relative paths, sorted
 */
export function shippedMjsOnDisk(root: string): readonly string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry => path.join(root, entry.name, COPY_OVERWRITE))
    .filter(dir => fs.existsSync(dir))
    .flatMap(dir => walkMjs(root, dir))
    .slice()
    .sort(byPath);
}

/**
 * @typedef {object} ShippedMjsRoster
 * @property tracked - Shipped `.mjs` files git tracks, which a push can carry.
 * @property untracked - Shipped `.mjs` files on disk that no commit contains.
 */
export type ShippedMjsRoster = {
  readonly tracked: readonly string[];
  readonly untracked: readonly string[];
};

/**
 * The shipped `.mjs` payload, split by whether a push can carry it.
 *
 * `tracked` is filtered by existence on disk as well as by the index: a file
 * staged for deletion is still listed by `git ls-files`, and handing ESLint a
 * path with no file behind it turns a clean tree into an error about the
 * harness rather than about the payload.
 * @param root - Repository root, defaulting to the vitest working directory
 * @returns The tracked and untracked halves, each sorted
 */
export function shippedMjsRoster(
  root: string = process.cwd()
): ShippedMjsRoster {
  const onDisk = shippedMjsOnDisk(root);
  const indexed = new Set(trackedPaths(root).filter(isShippedMjs));
  return {
    tracked: onDisk.filter(file => indexed.has(file)),
    untracked: onDisk.filter(file => !indexed.has(file)),
  };
}

/**
 * The note shown for findings in untracked shipped-tree files.
 *
 * Absolute paths, deliberately. The reader of this note may be in a different
 * worktree from whoever created the file, so a repo-relative path is exactly
 * the thing they cannot resolve — that ambiguity is what made #2824 cost two
 * sessions a round trip.
 * @param root - Repository root
 * @param findings - Finding lines, each starting with a repo-relative path
 * @returns The note, or an empty string when there is nothing to report
 */
export function untrackedFindingNote(
  root: string,
  findings: readonly string[]
): string {
  if (findings.length === 0) return "";
  const absolute = findings.map(finding => `  ${path.join(root, finding)}`);
  return [
    "NOT BLOCKING — findings below are in UNTRACKED files.",
    "",
    "These files are in no commit, so no push carries them and no published",
    "package can contain them. They are linted and reported, never enforced.",
    "In a shared checkout an untracked file may belong to another agent",
    "entirely, and blocking your push on it would name a file you cannot see",
    "in your own `git status` (CodySwannGT/lisa#2824).",
    "",
    ...absolute,
    "",
    "If one of these is yours and you meant to ship it, `git add` it — then",
    "this gate blocks on it, which is the point.",
  ].join("\n");
}
