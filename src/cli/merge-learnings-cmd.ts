/**
 * `lisa merge-learnings` — the git merge driver for the project-learnings
 * ledger.
 *
 * Git invokes this with the three sides of a merge and expects the result to be
 * written over the "ours" file, exiting zero for a clean merge and non-zero to
 * record a conflict. The union itself lives in `core/learnings-merge.ts`; this
 * module is only the process boundary — argument plumbing, file IO, and the
 * exit-code contract.
 *
 * On conflict the "ours" file is deliberately left untouched rather than filled
 * with conflict markers: git still records the conflict from the non-zero exit,
 * and leaving a parseable ledger in the working tree means the recovering agent
 * reads a real document plus a precise reason on stderr, instead of a corrupted
 * one. The marker guard in `core/learnings-document.ts` remains the backstop for
 * ledgers corrupted while this driver was NOT registered.
 * @module cli/merge-learnings-cmd
 */
import { readFile } from "node:fs/promises";
import { mergeLearningsDocuments } from "../core/learnings-merge.js";
import { writeFileAtomically } from "../utils/atomic-file-write.js";

/** Git-supplied merge sides, mapped from `%O %A %B %P`. */
export interface MergeLearningsOptions {
  /** `%O` — merge-base version; an empty file when the ledger is new. */
  readonly base?: string;
  /** `%A` — our version, and the file the result must be written to. */
  readonly ours?: string;
  /** `%B` — their (incoming) version. */
  readonly theirs?: string;
  /** `%P` — the real pathname, used only in diagnostics. */
  readonly path?: string;
}

/** Injectable collaborators for {@link runMergeLearnings}. */
export interface MergeLearningsDependencies {
  /** Sink for the conflict diagnostic (defaults to stderr). */
  readonly error?: (message: string) => void;
}

/** A side that was read, or a side whose supplied path could not be read. */
type SideRead =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false };

/**
 * Read one merge side that was definitely supplied.
 *
 * Never conflates "unreadable" with "empty". Collapsing the two is what made
 * this driver fail OPEN: an unreadable merge base silently became "no base",
 * the union degraded to two-way, and a superseded entry was resurrected into a
 * CLEAN, committed merge. Real triggers include ERR_STRING_TOO_LONG on an
 * oversized base, EACCES, ENOMEM, and EMFILE/ENFILE exhaustion under exactly
 * the parallel worktree merges this driver serves.
 * @param file - Path supplied by git
 * @returns The contents, or an explicit read failure
 */
async function readSide(file: string): Promise<SideRead> {
  try {
    return { ok: true, content: await readFile(file, "utf8") };
  } catch {
    return { ok: false };
  }
}

/**
 * Run the union merge and publish the result.
 * @param options - Git-supplied merge sides
 * @param dependencies - Injectable collaborators for tests
 * @returns Process exit code: 0 merged, 1 conflict
 */
export async function runMergeLearnings(
  options: MergeLearningsOptions,
  dependencies: MergeLearningsDependencies = {}
): Promise<number> {
  const error =
    dependencies.error ?? ((message: string) => console.error(message));
  const label = options.path ?? "project learnings";
  if (options.ours === undefined || options.theirs === undefined) {
    error(
      "merge-learnings: --ours and --theirs are required (git supplies %A and %B)"
    );
    return 1;
  }
  const oursPath = options.ours;
  const ours = await readSide(oursPath);
  const theirs = await readSide(options.theirs);
  if (!ours.ok || !theirs.ok) {
    error(`merge-learnings: ${label}: could not read both merge sides`);
    return 1;
  }
  // An OMITTED --base legitimately means "new on both sides". A base that was
  // supplied and cannot be read is a different thing entirely, and must never
  // be silently downgraded into the first case — exit 0 makes git record a
  // clean merge, so failing open here publishes data loss with no marker, no
  // diagnostic, and no second chance.
  const base =
    options.base === undefined
      ? { ok: true, content: "" }
      : await readSide(options.base);
  if (!base.ok) {
    error(
      `merge-learnings: ${label}: merge base could not be read — refusing to merge without it, because a two-way union silently resurrects superseded entries`
    );
    return 1;
  }
  const result = mergeLearningsDocuments(
    base.content,
    ours.content,
    theirs.content
  );
  if (result.kind === "conflict") {
    error(`merge-learnings: ${label}: ${result.reason}`);
    return 1;
  }
  await writeFileAtomically(oursPath, result.content);
  return 0;
}
