/**
 * Everything about a repository an operator would notice had changed, as
 * hashes (CodySwannGT/lisa#4996).
 *
 * `lisa controls attest` promises to leave the repository it is pointed at
 * exactly as it found it. "Exactly" is checked here, not sampled: every file
 * of the working copy including the ones git does not track, the index byte
 * for byte, every ref, the stash, this checkout's own git settings and the
 * list of linked working copies.
 *
 * Nothing here may itself change what it measures. `git status` rewrites the
 * index when a file's timestamp moved, so it is never run: the index is read
 * as bytes and listed with `git ls-files`, which only reads.
 * @module tests/support/repository-state
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { compareCodeUnits } from "../../src/controls/canonical-json.js";
import { runControlAuditGit } from "../helpers/control-audit-fixtures.js";

/** Git's own folder, which is hashed through git and not file by file. */
const GIT_FOLDER = ".git";

/** One hash per thing an operator would notice had changed. */
export interface RepositoryState {
  /** Every file outside `.git`: its path, its mode and its content. */
  readonly workingTree: string;
  /** The index: its bytes, and the entries git reads from it. */
  readonly index: string;
  /** Every ref and the commit it names, and what `HEAD` is. */
  readonly refs: string;
  /** Every stash entry: its commit and its message. */
  readonly stash: string;
  /** This checkout's own git settings, byte for byte. */
  readonly config: string;
  /** The working copies linked to this repository. */
  readonly worktrees: string;
}

/**
 * Hash some text or bytes.
 * @param content - What to hash
 * @returns The SHA-256, in hex
 */
function digest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * List every path under a folder that is not a folder itself.
 * @param root - The repository
 * @param folder - The folder to list, from the repository root
 * @returns One line per path: the path, its mode, and a hash of what it holds
 */
function listed(root: string, folder: string): readonly string[] {
  return readdirSync(path.join(root, folder), { withFileTypes: true })
    .filter(entry => !(folder === "" && entry.name === GIT_FOLDER))
    .flatMap(entry => {
      const relative = path.posix.join(folder, entry.name);
      const absolute = path.join(root, relative);
      if (entry.isDirectory()) return listed(root, relative);
      const { mode } = lstatSync(absolute);
      const held = entry.isSymbolicLink()
        ? `link:${readlinkSync(absolute)}`
        : digest(readFileSync(absolute));
      return [`${relative}\0${mode.toString(8)}\0${held}`];
    });
}

/**
 * Hash everything about a repository an operator would notice had changed.
 * @param root - The repository
 * @returns One hash per thing
 */
export function repositoryState(root: string): RepositoryState {
  const git = (...args: readonly string[]): string =>
    runControlAuditGit(root, args);
  const gitFolder = path.join(root, GIT_FOLDER);
  return {
    workingTree: digest(
      [...listed(root, "")].sort(compareCodeUnits).join("\n")
    ),
    index: digest(
      Buffer.concat([
        readFileSync(path.join(gitFolder, "index")),
        Buffer.from(git("ls-files", "--stage")),
      ])
    ),
    refs: digest(
      [
        git("for-each-ref", "--format=%(refname) %(objectname)"),
        git("rev-parse", "--symbolic-full-name", "HEAD"),
        git("rev-parse", "HEAD"),
      ].join("\n")
    ),
    stash: digest(git("stash", "list", "--format=%H %gs")),
    config: digest(readFileSync(path.join(gitFolder, "config"))),
    worktrees: digest(git("worktree", "list", "--porcelain")),
  };
}

/** What {@link withUncommittedWork} left in a repository. */
export interface UncommittedWork {
  /** A tracked file changed and not staged, from the repository root. */
  readonly changed: string;
  /** A new file, staged and not committed. */
  readonly staged: string;
  /** A new file git does not track. */
  readonly untracked: string;
  /** The message of the one stash entry. */
  readonly stashed: string;
}

/**
 * Give a repository the work an operator has in progress: one stash entry, a
 * tracked file changed and not staged, a new file staged, and a new file git
 * does not track.
 * @param root - The repository
 * @param tracked - A tracked file to change, from the repository root
 * @returns What was left where
 */
export function withUncommittedWork(
  root: string,
  tracked: string
): UncommittedWork {
  const work: UncommittedWork = {
    changed: tracked,
    staged: "notes/staged-and-not-committed.txt",
    untracked: "notes/never-added.txt",
    stashed: "work the operator set aside",
  };
  const file = (relative: string): string => path.join(root, relative);
  appendFileSync(file(tracked), "# set aside for later\n");
  runControlAuditGit(root, ["stash", "push", "--message", work.stashed]);
  appendFileSync(file(tracked), "# work in progress, not committed\n");
  for (const relative of [work.staged, work.untracked]) {
    mkdirSync(path.dirname(file(relative)), { recursive: true });
    writeFileSync(file(relative), `${relative}\n`);
  }
  runControlAuditGit(root, ["add", "--", work.staged]);
  return work;
}
