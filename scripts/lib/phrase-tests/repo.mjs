/**
 * Repository access for the phrase-test tooling (CodySwannGT/lisa#4609):
 * which test files exist, and how to read a source either from the working
 * tree or from a commit, so the parity check can classify and run files that
 * the working tree no longer has.
 * @module scripts/lib/phrase-tests/repo
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute repository root (this file lives in scripts/lib/phrase-tests). */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

/** Test files the classifier considers. */
const TEST_PATHSPEC = "tests/**/*.test.ts";

/**
 * Run git in the repository and return stdout.
 * @param {string} root - Repository root.
 * @param {string[]} args - git arguments.
 * @returns {string} Output.
 */
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Every test file on disk in the working tree, tracked or not (but not
 * ignored), so files restored from an older commit are seen too.
 * @param {string} root - Repository root.
 * @returns {string[]} Sorted repository-relative paths.
 */
export function workingTreeTestFiles(root) {
  return git(root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    TEST_PATHSPEC,
  ])
    .split("\n")
    .filter(file => file !== "" && existsSync(path.join(root, file)))
    .sort();
}

/**
 * Every test file at a commit.
 * @param {string} root - Repository root.
 * @param {string} ref - Commit-ish.
 * @returns {string[]} Sorted repository-relative paths.
 */
export function testFilesAt(root, ref) {
  return git(root, ["ls-tree", "-r", "--name-only", ref, "--", "tests"])
    .split("\n")
    .filter(file => file.startsWith("tests/") && file.endsWith(".test.ts"))
    .sort();
}

/**
 * A reader over the working tree.
 * @param {string} root - Repository root.
 * @returns {(file: string) => string | undefined} Reads a repo-relative file.
 */
export function workingTreeReader(root) {
  return file => {
    const absolute = path.join(root, file);
    return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
  };
}

/**
 * A reader over one commit, via `git show <ref>:<path>`, memoised.
 * @param {string} root - Repository root.
 * @param {string} ref - Commit-ish.
 * @returns {(file: string) => string | undefined} Reads a repo-relative file.
 */
export function commitReader(root, ref) {
  const tracked = new Set(
    git(root, ["ls-tree", "-r", "--name-only", ref, "--", "tests"]).split("\n")
  );
  /** @type {Map<string, string>} */
  const cache = new Map();
  return file => {
    if (!tracked.has(file)) return undefined;
    if (!cache.has(file))
      cache.set(file, git(root, ["show", `${ref}:${file}`]));
    return cache.get(file);
  };
}
