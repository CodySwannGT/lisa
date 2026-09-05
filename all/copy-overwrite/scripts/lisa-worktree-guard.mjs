#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-worktree-guard — refuse to delete a linked worktree whose uncommitted
 * work exists in no commit (CodySwannGT/lisa#3863).
 *
 * @remarks
 * ## The asymmetry that makes this necessary
 *
 * `.git/refs` and the object store are **shared** across every linked worktree
 * of a repository; `.git/index` and the working files are **per-worktree**. So
 * deleting a worktree spares everything that was committed and destroys
 * everything that was only staged or only written. Two agents hit the same
 * deletion event on the same evening: the one whose work was in a commit lost
 * nothing, the one whose work was staged lost the whole deliverable. Nothing
 * about the two situations looked different from the outside — `git status`
 * reports staged work in green, which reads as "saved".
 *
 * `lisa-cross-worktree-guard.mjs` is the same control read from the other end:
 * it detects one agent committing another agent's uncommitted file, and it
 * needs BOTH halves — the commit and the surviving original — to see anything
 * at all. This guard is what keeps the second half in existence.
 *
 * ## Why the deletion cannot be allowed to report success quietly
 *
 * A worktree deletion **destroys the only evidence its own case could leave**.
 * Once the directory is gone the staged blob is unreferenced and the incident
 * is indistinguishable from ordinary cleanup: no per-agent identifier appears
 * in any git object, the branch survives, and the aggregate worktree count is
 * flat whenever deletions are matched by creations. Any detection has to happen
 * *before* the removal, which is why this is a pre-flight refusal rather than a
 * monitor.
 *
 * ## What is refused, and what is not
 *
 * The question asked of every uncommitted file is narrow and answerable:
 * **does a commit anywhere in this repository already contain these exact
 * bytes?** If yes, deleting the worktree costs nothing recoverable and the
 * removal proceeds without ceremony — a worktree full of untracked build
 * output, or holding a file byte-identical to one already pushed, is not work
 * at risk. If no, the removal is refused and the at-risk files are named.
 *
 * Reachability is answered from `git rev-list --objects --all`, which walks
 * every ref rather than only the current branch, so work committed on a
 * different branch (or already pushed and merged) reads as safe. A blob that
 * exists only in the object database — which is exactly what `git add` writes —
 * is NOT reachable and is exactly the case this guard exists to catch.
 *
 * ## The override is real, and it is recorded
 *
 * An operator who genuinely wants the directory gone must not be stranded, so
 * `--force` (or `LISA_WORKTREE_REMOVE_OVERRIDE=1`) proceeds. Both the refusal
 * and the override append a line to a JSONL ledger in the **common** git
 * directory — never inside the worktree, which is about to stop existing. The
 * ledger is the only artifact that survives to say a detectable case was
 * knowingly made undetectable.
 *
 * Failing closed is deliberate: an unreadable repository, a `rev-list` that
 * cannot be buffered, or a worktree git does not know about all resolve to
 * refusal. "I could not tell" must never be cheaper than "there is work here".
 * @module scripts/lisa-worktree-guard
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Exit code meaning "safe, or removed". */
const OK = 0;
/** Exit code meaning "usage or environment error". */
const ERROR = 1;
/** Exit code meaning "refused: uncommitted work would be destroyed". */
const REFUSED = 2;

/** Ledger filename, written beside the shared object store. */
const LEDGER = "lisa-worktree-removals.jsonl";

/** Environment variable spelling of `--force`. */
const OVERRIDE_ENV = "LISA_WORKTREE_REMOVE_OVERRIDE";

/** Verdict reason: the path is not a git worktree at all. */
const NOT_A_WORKTREE = "not-a-worktree";

/** Verdict reason: the path is the primary checkout, which is never removable. */
const PRIMARY_CHECKOUT = "primary-checkout";

/** Verdict reason: the repository's objects could not be enumerated. */
const UNREADABLE = "unreadable";

/** Largest `git rev-list` payload buffered before the guard fails closed. */
const MAX_BUFFER = 1 << 28;

/**
 * Run git, returning stdout.
 * @param {string[]} args - Arguments after `git`.
 * @param {string} cwd - Directory to run in.
 * @returns {string} Captured stdout.
 */
function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Run git, returning `null` instead of throwing.
 * @param {string[]} args - Arguments after `git`.
 * @param {string} cwd - Directory to run in.
 * @returns {string | null} Captured stdout, or `null` when git failed.
 */
function gitOrNull(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    // probe-direction: fail-closed — no caller spends this null as an answer.
    // `candidatePaths`, `indexBlobs` and `candidateBlobs` each propagate it,
    // and `classifyWorktree` turns it into UNREADABLE, which REFUSES the
    // removal. A git that cannot answer costs a false refusal, never a
    // silent deletion.
    return null;
  }
}

/**
 * Split NUL-delimited git output into entries.
 * @param {string | null} out - Raw git output.
 * @returns {string[]} Non-empty entries.
 */
function splitZ(out) {
  return (out ?? "").split("\0").filter(Boolean);
}

/**
 * Repo-relative paths whose current bytes may differ from every commit.
 *
 * Staged additions, unstaged modifications and untracked files are all at risk;
 * ignored files are not (that is what makes build output cheap to delete).
 *
 * Returns `null` when any of the three probes failed. An empty list means
 * "git looked and found nothing"; `null` means "git could not look", and the
 * two must never collapse into each other — collapsing them is what lets an
 * unreadable worktree be deleted as though it were empty.
 * @param {string} wt - Worktree path.
 * @returns {string[] | null} Candidate repo-relative paths, or `null`.
 */
function candidatePaths(wt) {
  const staged = gitOrNull(
    ["diff", "--cached", "--name-only", "--no-renames", "-z"],
    wt
  );
  const unstaged = gitOrNull(["diff", "--name-only", "--no-renames", "-z"], wt);
  const untracked = gitOrNull(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    wt
  );
  if (staged === null || unstaged === null || untracked === null) return null;
  return [
    ...new Set([...splitZ(staged), ...splitZ(unstaged), ...splitZ(untracked)]),
  ];
}

/**
 * Index blob ids for the given paths, keyed by path.
 * @param {string} wt - Worktree path.
 * @param {string[]} paths - Candidate repo-relative paths.
 * @returns {Map<string, string> | null} Path to staged blob id, or `null`.
 */
function indexBlobs(wt, paths) {
  const entries = new Map();
  if (paths.length === 0) return entries;
  const raw = gitOrNull(["ls-files", "-s", "-z", "--", ...paths], wt);
  if (raw === null) return null;
  for (const line of splitZ(raw)) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const fields = line.slice(0, tab).split(" ");
    if (fields.length >= 2) entries.set(line.slice(tab + 1), fields[1]);
  }
  return entries;
}

/**
 * Every blob a worktree holds that no commit may contain, as path/blob pairs.
 *
 * Both sides of a path are collected: the INDEX blob (what `git add` wrote) and
 * the WORKING blob (what is on disk). They differ for a file staged and then
 * edited again, and losing either is losing work.
 * @param {string} wt - Worktree path.
 * @returns {{path: string, blob: string, source: string}[] | null} Candidate
 *   blobs, or `null` when the worktree could not be read.
 */
function candidateBlobs(wt) {
  const paths = candidatePaths(wt);
  if (paths === null) return null;
  const staged = indexBlobs(wt, paths);
  if (staged === null) return null;
  const found = [];
  for (const rel of paths) {
    const stagedBlob = staged.get(rel);
    if (stagedBlob)
      found.push({ path: rel, blob: stagedBlob, source: "index" });
    if (!existsSync(path.join(wt, rel))) continue;
    const hashed = gitOrNull(["hash-object", "--", rel], wt);
    // A file that is on disk but cannot be hashed is unread, not unchanged.
    if (hashed === null) return null;
    const id = hashed.trim();
    if (id && id !== stagedBlob) {
      found.push({ path: rel, blob: id, source: "worktree" });
    }
  }
  return found;
}

/**
 * The subset of `wanted` blob ids that some commit already contains.
 *
 * Returns `null` when the answer could not be computed, which callers must
 * treat as "nothing is reachable" rather than as "everything is".
 * @param {string} wt - Worktree path.
 * @param {Set<string>} wanted - Blob ids to look for.
 * @returns {Set<string> | null} Reachable ids, or `null` on failure.
 */
function reachableBlobs(wt, wanted) {
  if (wanted.size === 0) return new Set();
  const raw = gitOrNull(["rev-list", "--objects", "--all"], wt);
  if (raw === null) return null;
  const reachable = new Set();
  for (const line of raw.split("\n")) {
    const space = line.indexOf(" ");
    const id = space === -1 ? line : line.slice(0, space);
    if (wanted.has(id)) reachable.add(id);
  }
  return reachable;
}

/**
 * Resolve the worktree's identity: its branch, the primary checkout, and
 * whether the path is a linked worktree at all.
 * @param {string} target - Path to inspect.
 * @returns {{worktree: string, primary: string, common: string, branch: string, linked: boolean} | null} Identity, or `null` when not a repository.
 */
function identify(target) {
  const top = gitOrNull(["rev-parse", "--show-toplevel"], target)?.trim();
  if (!top) return null;
  const gitDir = gitOrNull(["rev-parse", "--absolute-git-dir"], target)?.trim();
  const commonRaw = gitOrNull(
    ["rev-parse", "--git-common-dir"],
    target
  )?.trim();
  if (!gitDir || !commonRaw) return null;
  const common = path.resolve(top, commonRaw);
  const listed = gitOrNull(["worktree", "list", "--porcelain"], target) ?? "";
  const first = listed.split("\n")[0] ?? "";
  return {
    worktree: top,
    primary: first.startsWith("worktree ")
      ? first.slice(9)
      : path.dirname(common),
    common,
    branch:
      gitOrNull(["rev-parse", "--abbrev-ref", "HEAD"], target)?.trim() ?? "",
    linked: path.resolve(gitDir) !== common,
  };
}

/**
 * Classify a worktree for removal safety.
 * @param {string} target - Path to inspect.
 * @returns {{ok: boolean, reason: string, identity: object | null, atRisk: object[]}} Verdict.
 */
export function classifyWorktree(target) {
  const identity = identify(target);
  if (!identity) {
    return { ok: false, reason: NOT_A_WORKTREE, identity: null, atRisk: [] };
  }
  if (!identity.linked) {
    return { ok: false, reason: PRIMARY_CHECKOUT, identity, atRisk: [] };
  }
  const blobs = candidateBlobs(identity.worktree);
  if (blobs === null) {
    return { ok: false, reason: UNREADABLE, identity, atRisk: [] };
  }
  const reachable = reachableBlobs(
    identity.worktree,
    new Set(blobs.map(entry => entry.blob))
  );
  if (reachable === null) {
    return { ok: false, reason: UNREADABLE, identity, atRisk: blobs };
  }
  const atRisk = blobs.filter(entry => !reachable.has(entry.blob));
  return {
    ok: atRisk.length === 0,
    reason: atRisk.length === 0 ? "safe" : "work-at-risk",
    identity,
    atRisk,
  };
}

/**
 * Append one line to the removal ledger in the shared git directory.
 *
 * Best-effort by construction: a ledger that cannot be written must not turn a
 * safe removal into a failure, and must not turn a refusal into a pass.
 * @param {string} common - Absolute path to the common git directory.
 * @param {object} row - The record to append.
 * @returns {string | null} Ledger path when written, else `null`.
 */
export function recordRemoval(common, row) {
  const file = path.join(common, LEDGER);
  try {
    appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
    return file;
  } catch {
    return null;
  }
}

/**
 * Human-readable refusal, naming every file that exists nowhere else.
 * @param {object} verdict - Result of `classifyWorktree`.
 * @returns {string} Message for stderr.
 */
function refusalMessage(verdict) {
  const lines = verdict.atRisk.map(
    entry => `  ${entry.source.padEnd(8)} ${entry.path}  (blob ${entry.blob})`
  );
  return [
    `REFUSED: ${verdict.identity.worktree}`,
    `${verdict.atRisk.length} file(s) here exist in no commit, in this repository or any other:`,
    ...lines,
    "",
    "A worktree's index and working files are per-worktree; only commits are shared.",
    "Deleting this directory destroys the bytes above and leaves no trace that it did.",
    "Commit them (they need no push to survive), or re-run with --force to delete them",
    `anyway — an override is recorded in ${LEDGER}.`,
  ].join("\n");
}

/**
 * Reasons that describe a broken request rather than work at risk.
 * @param {string} reason - Verdict reason.
 * @returns {string} Operator-readable explanation.
 */
function hardFailure(reason) {
  if (reason === NOT_A_WORKTREE) return "not a git worktree";
  if (reason === PRIMARY_CHECKOUT) {
    return "refusing to touch the primary checkout (no override exists)";
  }
  return "could not read the repository's objects; refusing fail-closed";
}

/**
 * Parse argv into a verb, a target and flags.
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{verb: string, target: string, force: boolean, json: boolean}} Options.
 */
function parseArgs(argv) {
  const rest = argv.filter(arg => !arg.startsWith("--"));
  const verb = rest[0] === "remove" || rest[0] === "check" ? rest[0] : "check";
  const positional = rest[0] === verb && rest.length > 1 ? rest[1] : rest[0];
  return {
    verb,
    target: positional ?? "",
    force: argv.includes("--force") || process.env[OVERRIDE_ENV] === "1",
    json: argv.includes("--json"),
  };
}

/**
 * Entry point.
 * @param {string[]} argv - Arguments after the script name.
 * @param {{out?: NodeJS.WritableStream, err?: NodeJS.WritableStream}} [io] - Streams.
 * @returns {number} Process exit code.
 */
export function main(argv, io = {}) {
  const out = io.out ?? process.stdout;
  const err = io.err ?? process.stderr;
  const opts = parseArgs(argv);
  if (!opts.target) {
    err.write(
      "usage: lisa-worktree-guard [check|remove] <worktree> [--force]\n"
    );
    return ERROR;
  }
  const verdict = classifyWorktree(opts.target);
  if (opts.json) out.write(`${JSON.stringify(verdict)}\n`);
  if (!verdict.identity || verdict.reason === PRIMARY_CHECKOUT) {
    err.write(`${hardFailure(verdict.reason)}\n`);
    return ERROR;
  }
  return finish(verdict, opts, out, err);
}

/**
 * Apply the verdict: refuse, record an override, or remove.
 * @param {object} verdict - Result of `classifyWorktree`.
 * @param {object} opts - Parsed options.
 * @param {NodeJS.WritableStream} out - Stdout.
 * @param {NodeJS.WritableStream} err - Stderr.
 * @returns {number} Process exit code.
 */
function finish(verdict, opts, out, err) {
  const { identity } = verdict;
  const base = {
    at: new Date().toISOString(),
    worktree: identity.worktree,
    branch: identity.branch,
    verb: opts.verb,
    atRisk: verdict.atRisk,
  };
  if (!verdict.ok && !opts.force) {
    recordRemoval(identity.common, { ...base, action: "refused" });
    if (verdict.reason === UNREADABLE) {
      err.write(`${hardFailure(verdict.reason)}\n`);
      return REFUSED;
    }
    err.write(`${refusalMessage(verdict)}\n`);
    return REFUSED;
  }
  const action = verdict.ok ? "removed" : "override";
  if (opts.verb === "check") {
    if (!verdict.ok) recordRemoval(identity.common, { ...base, action });
    return OK;
  }
  return remove(identity, { ...base, action }, out, err);
}

/**
 * Remove the worktree and record it.
 * @param {object} identity - Worktree identity.
 * @param {object} row - Ledger row.
 * @param {NodeJS.WritableStream} out - Stdout.
 * @param {NodeJS.WritableStream} err - Stderr.
 * @returns {number} Process exit code.
 */
function remove(identity, row, out, err) {
  recordRemoval(identity.common, row);
  try {
    git(["worktree", "remove", "--force", identity.worktree], identity.primary);
  } catch (error) {
    err.write(`error: git worktree remove failed: ${error.message}\n`);
    return ERROR;
  }
  out.write(`removed ${identity.worktree}\n`);
  return OK;
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
