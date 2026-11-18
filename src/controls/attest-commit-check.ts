/**
 * Holding a verdict to the commit its evidence was recorded at.
 *
 * A verdict says the checks worked when they were proved. Every evidence
 * record names the commit the proofs were run against. `lisa controls attest
 * --check` is often run later, in a repository that has moved on, so it asks
 * one more question beside whether the three files agree: is what was proved
 * still what is here?
 *
 * ## What is compared
 *
 * For each commit the evidence names that is not the commit the repository
 * is at, git is asked which of these differ between the two commits:
 *
 * - `.lisa.config.json`, which declares the checks;
 * - everything under `.lisa/controls/proofs/`, the changes the proofs plant;
 * - the hook scripts, the record of the files Lisa placed and every file it
 *   lists, and the gate runner (`./proof-change-rule.ts`).
 *
 * Any difference fails the check: the verdict is about the checks as they
 * were. Nothing differing passes it, whatever else changed in between,
 * because committing the three result files themselves moves the repository
 * to a new commit.
 *
 * ## What cannot be compared is not called current
 *
 * A clone that does not hold the recorded commit, which is what a shallow
 * clone is, has nothing to compare with. The check says so and exits
 * non-zero. It does not pass.
 *
 * ## What it does not see
 *
 * - A change to the checked tool's own files: a linter's rule file, a test
 *   runner's settings. They are the project's, and this comparison has no
 *   list of them.
 * - Work that is not committed. The comparison is between two commits. A
 *   declaration edited and not committed is caught by the register, which
 *   is generated again from the working copy.
 * - A record that names no commit (`null`): there is nothing to compare.
 * @module controls/attest-commit-check
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { compareCodeUnits } from "./canonical-json.js";
import type { EvidenceDocument } from "./evidence-types.js";
import { readHeadCommit } from "./head-commit.js";
import { checkFilesOf } from "./proof-change-rule.js";
import { shortCommit } from "./proof-copy-wording.js";
import { isolatedGit, PROOF_FOLDER } from "./proof-patch.js";

const run = promisify(execFile);

/** How long one git command may take, in milliseconds. */
const GIT_TIMEOUT_MS = 30_000;

/** The most of git's answer that is kept, in bytes. */
const GIT_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Tells git not to fetch an object this clone does not hold. */
const NO_FETCH = "GIT_NO_LAZY_FETCH=1";

/** How many changed files a line names before it counts the rest. */
const NAMED_FILES = 5;

/** What comparing the recorded commits with the repository found. */
export interface RecordedCommitCheck {
  /** One line per commit since which a file that defines the checks changed. */
  readonly differences: readonly string[];
  /** One line per commit that could not be compared. */
  readonly uncompared: readonly string[];
  /**
   * What to say about the commits when nothing is wrong; empty when the
   * evidence names none.
   */
  readonly standing: string;
}

/** What git answered. */
interface GitAnswer {
  /** Whether git ran and exited zero. */
  readonly ok: boolean;
  readonly stdout: string;
}

/**
 * Start git in a repository the way a proof's patch is applied: in that
 * folder, not looking above it, without the machine's own settings.
 * @param root - Real path of the repository
 * @param args - Arguments to git
 * @returns Whether it succeeded, and what it printed
 */
async function git(root: string, args: readonly string[]): Promise<GitAnswer> {
  const [program, ...start] = isolatedGit(root);
  if (program === undefined) return { ok: false, stdout: "" };
  // A clone that leaves objects out can fetch one it is asked about. This
  // check reads what is here and opens no connection, so git is told not to.
  const prefix = [...start.slice(0, -1), NO_FETCH, ...start.slice(-1)];
  try {
    const { stdout } = await run(program, [...prefix, ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: GIT_OUTPUT_BYTES,
      timeout: GIT_TIMEOUT_MS,
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * Name some files in a sentence, counting the ones left out.
 * @param files - The files, in order
 * @returns For example `a, b and 3 more`
 */
function named(files: readonly string[]): string {
  const shown = files.slice(0, NAMED_FILES).join(", ");
  const more = files.length - NAMED_FILES;
  return more > 0 ? `${shown} and ${String(more)} more` : shown;
}

/** What comparing one recorded commit with the repository found. */
type Compared =
  | { readonly kind: "same" }
  | { readonly kind: "differs"; readonly line: string }
  | { readonly kind: "uncompared"; readonly line: string };

/**
 * Compare one commit the evidence names with the commit the repository is
 * at.
 * @param root - Real path of the repository
 * @param commit - The recorded commit
 * @param head - The commit the repository is at
 * @param paths - The files and folders that say what the checks are, or run
 *   them
 * @returns What was found
 */
async function comparedWith(
  root: string,
  commit: string,
  head: string,
  paths: readonly string[]
): Promise<Compared> {
  if (commit === head) return { kind: "same" };
  const held = await git(root, ["cat-file", "-e", `${commit}^{commit}`]);
  if (!held.ok) {
    return {
      kind: "uncompared",
      line: `The evidence was recorded at commit ${commit}, and this clone does not have that commit (a shallow clone leaves history out), so what has changed since could not be compared. Fetch the full history (git fetch --unshallow), or run "lisa controls attest" again.`,
    };
  }
  // The paths are names, never patterns: a name with a `*` in it is that
  // file and no other.
  const changed = await git(root, [
    "--literal-pathspecs",
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    "--no-ext-diff",
    commit,
    head,
    "--",
    ...paths,
  ]);
  if (!changed.ok) {
    return {
      kind: "uncompared",
      line: `The evidence was recorded at commit ${commit}, and git could not compare it with the commit this repository is at (${head}), so what has changed since is not known. Run "lisa controls attest" again.`,
    };
  }
  const files = changed.stdout
    .split("\0")
    .filter(file => file !== "")
    .sort(compareCodeUnits);
  return files.length === 0
    ? { kind: "same" }
    : {
        kind: "differs",
        line: `The evidence was recorded at commit ${shortCommit(commit)}, and this repository is now at ${shortCommit(head)}. Between the two, a file that says what the checks are or runs them has changed: ${named(files)}. The verdict is about the checks as they were, so it no longer describes what is here.`,
      };
}

/**
 * Say where the recorded commits stand when nothing is wrong with them.
 * @param commits - Every commit the evidence names
 * @param head - The commit the repository is at
 * @returns The sentence
 */
function standingOf(commits: readonly string[], head: string): string {
  const shown = commits.map(commit => shortCommit(commit)).join(", ");
  return commits.every(commit => commit === head)
    ? `The evidence was recorded at commit ${shown}, the commit this repository is at.`
    : `The evidence was recorded at commit ${shown}. This repository is now at ${shortCommit(head)}, and no file that says what the checks are or runs them has changed since.`;
}

/**
 * Hold a verdict to the commits its evidence was recorded at.
 * @param root - Real path of the repository
 * @param evidence - The committed evidence file
 * @returns Each commit since which the checks changed, each that could not
 *   be compared, and what to say when neither list holds anything
 * @throws {Error} When this copy of Lisa does not hold the gate runner
 */
export async function checkRecordedCommits(
  root: string,
  evidence: EvidenceDocument
): Promise<RecordedCommitCheck> {
  const commits = [
    ...new Set(
      evidence.records.flatMap(record =>
        record.commit === null ? [] : [record.commit]
      )
    ),
  ].sort(compareCodeUnits);
  if (commits.length === 0) {
    return { differences: [], uncompared: [], standing: "" };
  }
  const head = await readHeadCommit(root);
  if (head === null) {
    return {
      differences: [],
      uncompared: commits.map(
        commit =>
          `The evidence was recorded at commit ${commit}, and this folder has no commit to compare it with: it is not the top folder of a git repository, or the repository has no commit yet. Run this in a clone of the repository.`
      ),
      standing: "",
    };
  }
  const checkFiles = await checkFilesOf(root);
  const paths = [...checkFiles.files, ...checkFiles.folders, PROOF_FOLDER];
  const compared = await Promise.all(
    commits.map(commit => comparedWith(root, commit, head, paths))
  );
  const lines = (kind: "differs" | "uncompared"): readonly string[] =>
    compared.flatMap(each => (each.kind === kind ? [each.line] : []));
  return {
    differences: lines("differs"),
    uncompared: lines("uncompared"),
    standing: standingOf(commits, head),
  };
}
