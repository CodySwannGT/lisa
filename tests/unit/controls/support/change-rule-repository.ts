/**
 * A small real repository for the suites that hold a proof's change to what
 * it may touch: one commit, an ignore file, and a way to make any change
 * into a patch.
 * @module tests/unit/controls/support/change-rule-repository
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  buildControlAuditFixture,
  runControlAuditGit,
} from "../../../helpers/control-audit-fixtures.js";
import { keep } from "./report-check-run.js";

/** The file that declares the checks. */
export const DECLARATION = ".lisa.config.json";

/** The file a package manager reads its scripts from. */
export const MANIFEST = "package.json";

/** A source file the repository tracks. */
export const SOURCE = "src/app.txt";

/** A second source file the repository tracks. */
export const OTHER_SOURCE = "src/other.txt";

/** A source file the repository does not hold yet. */
export const NEW_SOURCE = "src/new.txt";

/** A program a check's command can be declared to start. */
export const SCRIPT = "scripts/lint.sh";

/** A tracked file at a path the repository's own ignore file names. */
export const TRACKED_IN_IGNORED = "vendor/kept.txt";

/** A path the repository ignores, where no file is yet. */
export const IGNORED_TOOL = "node_modules/.bin/tool";

/** What the repository's ignore file holds. */
export const IGNORE_FILE = "node_modules/\nvendor/\n.cache/\n";

/**
 * A `package.json` as text.
 * @param fields - What it holds
 * @returns The file's content
 */
export function manifestOf(fields: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(fields, null, 2)}\n`;
}

/** What the repository holds at its first commit. */
const FILES: Readonly<Record<string, string>> = {
  ".gitignore": IGNORE_FILE,
  [DECLARATION]: '{ "gates": {} }\n',
  [MANIFEST]: manifestOf({
    name: "fixture",
    scripts: { lint: "true" },
    dependencies: {},
  }),
  [SOURCE]: "one\n",
  [OTHER_SOURCE]: "two\n",
  [SCRIPT]: "#!/bin/sh\nexit 0\n",
};

/**
 * Run git in a repository.
 * @param repo - The repository
 * @param args - Arguments to git
 * @returns What it printed
 */
export function git(repo: string, ...args: readonly string[]): string {
  return runControlAuditGit(repo, args);
}

/**
 * Write a file, making its folder first.
 * @param repo - The repository
 * @param file - The file, from the root
 * @param content - What it holds
 */
export function write(repo: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), content);
}

/**
 * Build the repository: one commit of the files above, and a second that
 * tracks a file at a path its own ignore file names. It is removed with the
 * other fixtures of the case.
 * @returns The repository's root
 */
export function changeRuleRepository(): string {
  const { repoPath } = keep(
    buildControlAuditFixture("F-none", { extraFiles: FILES })
  );
  write(repoPath, TRACKED_IN_IGNORED, "kept\n");
  git(repoPath, "add", "--force", "--", TRACKED_IN_IGNORED);
  git(repoPath, "commit", "--quiet", "-m", "track a file");
  return repoPath;
}

/**
 * Make a change in a repository and take everything it did, ignored files
 * included, as one patch.
 * @param repo - The repository
 * @param change - Makes the change in the working copy
 * @returns What git says the change is
 */
function staged(repo: string, change: () => void): string {
  change();
  git(repo, "add", "--all", "--force");
  return git(repo, "diff", "--cached", "--find-renames", "--binary");
}

/**
 * Make a change in a repository, take it as a patch, and put the repository
 * back as it was.
 * @param repo - The repository
 * @param change - Makes the change in the working copy
 * @returns The patch
 */
export function patchOf(repo: string, change: () => void): string {
  const patch = staged(repo, change);
  git(repo, "reset", "--quiet", "--hard", "HEAD");
  git(repo, "clean", "-ffdxq");
  return `${patch}\n`;
}
