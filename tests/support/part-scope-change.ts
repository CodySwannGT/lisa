/**
 * Making a change in a fixture repository and asking what it touches
 * (CodySwannGT/lisa#4988).
 *
 * The gate runner skips a part whose folder a change does not touch, so every
 * suite about that needs the same three things: a change staged or committed
 * in a real repository, the list of refs a push hook is handed, and the
 * runner's own reading of the change. They are written once here.
 * @module tests/support/part-scope-change
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { changeAt } from "../../all/copy-overwrite/scripts/lib/changed-paths.mjs";
import {
  controlAuditGitEnv,
  runControlAuditGit,
} from "../helpers/control-audit-fixtures.js";

/** What the runner knows about the change it was started for. */
export interface Change {
  /** Repository-relative paths the change touches; `null` when not known. */
  readonly paths: string[] | null;
  /** What the runner tells the operator about it; `null` to say nothing. */
  readonly note: string | null;
}

/** The object name git writes for "no object": a new ref, or a deleted one. */
export const NO_OBJECT = "0".repeat(40);

/** The branch every fixture starts on, as a push names it. */
export const MAIN_REF = "refs/heads/main";

/**
 * Write a file in a repository without staging it.
 * @param repoPath - The repository root
 * @param relative - The file, written from the root
 * @param content - What the file holds
 */
export function writeIn(
  repoPath: string,
  relative: string,
  content = "changed\n"
): void {
  const target = path.join(repoPath, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/**
 * Write files and stage them, the way `git add` does before a commit.
 * @param repoPath - The repository root
 * @param relatives - The files, written from the root
 */
export function stage(repoPath: string, relatives: readonly string[]): void {
  for (const relative of relatives) writeIn(repoPath, relative);
  runControlAuditGit(repoPath, ["add", "--", ...relatives]);
}

/**
 * Delete a tracked file and stage the deletion.
 * @param repoPath - The repository root
 * @param relative - The file, written from the root
 */
export function stageDeletion(repoPath: string, relative: string): void {
  rmSync(path.join(repoPath, relative));
  runControlAuditGit(repoPath, ["add", "--all", "--", relative]);
}

/**
 * Commit whatever is staged, and name the commit.
 * @param repoPath - The repository root
 * @param message - The commit subject
 * @returns The new commit's object name
 */
export function commitStaged(repoPath: string, message = "change"): string {
  runControlAuditGit(repoPath, [
    "commit",
    "--quiet",
    "--allow-empty",
    "--message",
    message,
  ]);
  return runControlAuditGit(repoPath, ["rev-parse", "HEAD"]);
}

/**
 * Write, stage and commit files in one step.
 * @param repoPath - The repository root
 * @param relatives - The files, written from the root
 * @returns The new commit's object name
 */
export function commitFiles(
  repoPath: string,
  relatives: readonly string[]
): string {
  stage(repoPath, relatives);
  return commitStaged(repoPath, `change ${relatives.join(", ")}`);
}

/**
 * One line of what git hands a push hook on standard input.
 * @param update - The ref update
 * @param update.local - The commit being pushed; `NO_OBJECT` for a deletion
 * @param update.remote - The commit the remote holds; `NO_OBJECT` for a new ref
 * @param update.ref - The ref on both sides
 * @returns The line, with its line ending
 */
export function pushLine(update: {
  readonly local: string;
  readonly remote: string;
  readonly ref?: string;
}): string {
  const ref = update.ref ?? MAIN_REF;
  const localRef = update.local === NO_OBJECT ? "(delete)" : ref;
  return `${localRef} ${update.local} ${ref} ${update.remote}\n`;
}

/**
 * Write the pushed refs to a file outside the repository's tracked tree.
 * @param repoPath - The repository root
 * @param lines - The lines, as `pushLine` writes them
 * @returns The file's absolute path
 */
export function pushRefsFile(
  repoPath: string,
  lines: readonly string[]
): string {
  const file = path.join(repoPath, ".git", "lisa-test-pushed-refs");
  writeFileSync(file, lines.join(""));
  return file;
}

/**
 * Ask the shipped module what a change touches, in the fixture's environment.
 *
 * The environment is the fixture's on purpose: none of the variables a hook
 * exports, so a suite started from a hook still asks about the fixture.
 * @param repoPath - The repository root
 * @param moment - The moment the runner was started for
 * @param options - What the caller supplied
 * @param options.pushRefs - The `--push-refs` value, when one was given
 * @param options.env - Environment entries to add to the fixture's
 * @returns What the runner would know about the change
 */
export function changeIn(
  repoPath: string,
  moment: string,
  options: {
    readonly pushRefs?: string | null;
    readonly env?: Readonly<Record<string, string>>;
  } = {}
): Change {
  return changeAt({
    env: { ...controlAuditGitEnv(), ...options.env },
    moment,
    pushRefs: options.pushRefs ?? null,
    root: repoPath,
  }) as Change;
}
