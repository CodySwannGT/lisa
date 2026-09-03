/**
 * Whether Lisa may delete a workflow file it finds in a consumer repository.
 *
 * A deletions manifest names DESTINATION PATHS. It cannot name bytes, and until
 * CodySwannGT/lisa#3656 nothing between the manifest and `fse.remove` looked at
 * any. So a manifest entry retiring one of Lisa's own workflows also removed a
 * completely unrelated file a consumer happened to author at the same path —
 * three of them at once, on a routine version bump, with nothing in the install
 * output anyone could read afterwards.
 *
 * The damage shape is what makes path-only deletion unacceptable here rather
 * than merely untidy. **A workflow that no longer exists cannot fail.** Removing
 * one does not redden a check; it removes the check. Two capabilities stopped in
 * that repo — PR branches were no longer auto-updated and required-checks drift
 * was no longer policed — and both losses presented as a quiet, healthy repo.
 * The only reason anyone found out was an unrelated test that happened to read
 * one of the files off disk and got `ENOENT`.
 *
 * ## Ownership is read from the file's own header, and the header already exists
 *
 * Every template Lisa ships carries an ownership header, and which header it
 * carries is enforced repo-wide by `tests/unit/templates/template-ownership-header.test.ts`.
 * The two headers are not decoration — they are opposite contracts, and this
 * module simply honours the one the file on disk is carrying:
 *
 * - **`copy-overwrite`**: "This file is managed by Lisa and IS replaced on each
 *   `lisa` run." Lisa asserts ownership of the bytes and has always replaced
 *   them wholesale. Retiring such a file is Lisa deleting its own artifact,
 *   which is squarely inside the mandate.
 * - **`create-only`**: "Seeded by Lisa on first setup — this file is YOURS.
 *   Lisa will not overwrite it." Lisa explicitly DISCLAIMED ownership at seed
 *   time. Whatever is in that file now may be entirely the consumer's work, and
 *   deleting it is the one operation the header promised would never happen.
 *   Overwriting it was already refused; removing it must be too.
 *
 * All three files lost in #3656 were `create-only` seeds. So was every workflow
 * template Lisa currently ships.
 *
 * ## Why a header and not the hash ledger
 *
 * `core/lisa-owned-provenance` answers a neighbouring question — are these bytes
 * some past Lisa release? — from a generated hash ledger, and it would be the
 * stronger signal if it applied. It does not: the generator
 * (`scripts/generate-lisa-owned-hash-ledger.mjs`) enrols only `copy-overwrite`
 * sources under `scripts/`, so `LISA_OWNED_HASH_LEDGER` holds no
 * `.github/workflows/` key at all and every workflow would classify as
 * `unenrolled` — the verdict whose documented meaning is "behave exactly as
 * before", which is the bug. Enrolling workflows would mean walking the history
 * of retired template paths, and it still could not vouch for a `create-only`
 * seed a consumer has since edited. The header answers the question that is
 * actually being asked, for every workflow Lisa has ever shipped, with no
 * generated artifact to keep in step.
 *
 * ## The residual risk, stated
 *
 * A consumer who deletes the `copy-overwrite` header out of a Lisa-managed
 * workflow makes it unattributable, and Lisa will then decline to retire it.
 * That is the safe direction: a stale reusable workflow nobody calls costs
 * nothing, and `lisa doctor` is not made worse by its presence. The unsafe
 * direction — deleting a file Lisa cannot account for — is the one this module
 * closes.
 * @module core/workflow-deletion-ownership
 */
import * as path from "node:path";

/**
 * Repo-relative directory GitHub Actions reads workflow definitions from.
 * Deletion of anything inside it is what this module governs.
 */
const WORKFLOWS_DIR = ".github/workflows";

/**
 * The sentence a `copy-overwrite` template carries, minus its comment prefix.
 *
 * Matched as a substring rather than a whole line because the prefix differs by
 * file type (`#`, `//`, ` *`) and the wording has been revised once already —
 * the retired header said "changes will be overwritten on the next `lisa` run".
 * Both spellings contain this phrase, so a consumer still holding a
 * years-old Lisa workflow is still correctly attributed.
 */
export const LISA_MANAGED_MARKER = "managed by Lisa";

/**
 * The word a `create-only` seed header shouts, minus its comment prefix.
 *
 * "YOURS" is the load-bearing token of that contract and the one the header
 * test asserts. A file carrying it came out of Lisa's template tree AND was
 * handed to the consumer, which is exactly the pair of facts that makes it
 * undeletable.
 */
export const LISA_SEEDED_MARKER = "YOURS";

/**
 * How many leading lines of a file count as its ownership header.
 *
 * Bounded on purpose. A whole-file search would let any mention of Lisa
 * anywhere in a consumer's workflow — a step name, a comment about a Lisa
 * command — authorise that file's deletion, which is the false-negative
 * direction that reintroduces #3656. Every shipped template puts its header on
 * the first two lines; four covers a leading `---` document marker or a blank
 * line above it and still stops short of any workflow body.
 */
const HEADER_LINES = 4;

/** What Lisa can prove about a workflow file it has been asked to delete. */
export type WorkflowDeletionVerdict =
  /** Header asserts Lisa replaces this file wholesale. Lisa may retire it. */
  | { readonly kind: "lisa-managed" }
  /** Header seeded it as the consumer's. Lisa promised not to touch it. */
  | { readonly kind: "host-owned-seed" }
  /** No Lisa header at all. Lisa has no record of installing this. */
  | { readonly kind: "unattributable" };

/**
 * Normalize a path for comparison: POSIX separators, no leading `./`.
 * @param value - Raw path from a deletions manifest
 * @returns Comparable POSIX-style repo-relative path
 */
function normalizeRepoPath(value: string): string {
  const posix = value.split(path.sep).join("/");
  return posix.startsWith("./") ? posix.slice(2) : posix;
}

/**
 * Whether a deletion target lives under `.github/workflows/`.
 *
 * Only this tree is gated. The manifests name 200-odd other paths whose
 * deletion is unchanged by #3656, and narrowing the guard is deliberate: a
 * workflow's absence is undetectable by construction, which is not true of a
 * missing config file or skill directory.
 * @param relativePath - Repo-relative path a deletions manifest wants removed
 * @returns Whether the ownership gate applies to it
 */
export function isWorkflowDeletionPath(relativePath: string): boolean {
  return normalizeRepoPath(relativePath).startsWith(`${WORKFLOWS_DIR}/`);
}

/**
 * Read the ownership contract a workflow file states about itself.
 *
 * Precedence is seed-before-managed. A `create-only` header mentions
 * `copy-overwrite` in its own second line, so a naive managed-first check would
 * read every seeded workflow as Lisa-managed and delete the very files #3656
 * lost. Ordering it this way means the strongest claim a file can make is the
 * one that keeps it.
 * @param contents - Raw text of the workflow file on disk
 * @returns The verdict its header supports
 */
export function classifyWorkflowForDeletion(
  contents: string
): WorkflowDeletionVerdict {
  const header = contents.split("\n").slice(0, HEADER_LINES).join("\n");
  if (header.includes(LISA_SEEDED_MARKER)) {
    return { kind: "host-owned-seed" };
  }
  return header.includes(LISA_MANAGED_MARKER)
    ? { kind: "lisa-managed" }
    : { kind: "unattributable" };
}

/**
 * The operator-readable reason a workflow deletion was refused.
 *
 * Written for whoever is staring at an install log wondering why a file they
 * expected to disappear is still there — so it names the contract, not the
 * implementation, and says what to do about it.
 * @param verdict - The verdict that refused the deletion
 * @returns A sentence fragment naming why the file was kept
 */
export function describeRefusal(
  verdict: Exclude<WorkflowDeletionVerdict, { kind: "lisa-managed" }>
): string {
  return verdict.kind === "host-owned-seed"
    ? "Lisa seeded this workflow as yours and will not remove it"
    : "Lisa cannot prove it installed this workflow";
}
