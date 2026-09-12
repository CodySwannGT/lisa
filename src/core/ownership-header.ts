/**
 * The ownership contract a Lisa template states about itself, in its own first
 * lines, and the bounded read that recovers it from a file on disk.
 *
 * Every template Lisa ships carries one of exactly two headers, and which one
 * is enforced repo-wide by `tests/unit/templates/template-ownership-header.test.ts`:
 *
 * - **`copy-overwrite`**: "This file is managed by Lisa and IS replaced on each
 *   `lisa` run." Lisa asserts ownership of the bytes.
 * - **`create-only`**: "Seeded by Lisa on first setup — this file is YOURS.
 *   Lisa will not overwrite it." Lisa disclaims ownership at seed time.
 *
 * The headers are not decoration; they are opposite contracts, and more than
 * one guard has to read them. `core/workflow-deletion-ownership` reads one to
 * decide whether Lisa may delete a file, and `core/stale-managed-banner` reads
 * the same one to decide whether the sentence is still TRUE. Both need the
 * marker strings, the precedence between them, and the bound on how far into
 * the file counts as "the header" — and a second copy of any of the three
 * would drift silently, which is the failure mode both callers exist to end.
 * So the reading lives here once and the callers ask it questions.
 * @module core/ownership-header
 */

/**
 * The sentence a `copy-overwrite` template carries, minus its comment prefix.
 *
 * Matched as a substring rather than a whole line because the prefix differs by
 * file type (`#`, `//`, ` *`) and the wording has been revised once already —
 * the retired header said "changes will be overwritten on the next `lisa` run".
 * Both spellings contain this phrase, so a consumer still holding a years-old
 * Lisa artifact is still correctly attributed.
 */
export const LISA_MANAGED_MARKER = "managed by Lisa";

/**
 * The word a `create-only` seed header shouts, minus its comment prefix.
 *
 * "YOURS" is the load-bearing token of that contract and the one the header
 * test asserts. A file carrying it came out of Lisa's template tree AND was
 * handed to the consumer.
 */
export const LISA_SEEDED_MARKER = "YOURS";

/**
 * How many leading lines of a file count as its ownership header.
 *
 * Bounded on purpose. A whole-file search would let any mention of Lisa
 * anywhere in a consumer's file — a step name, a comment about a Lisa command —
 * read as an ownership claim, which is the false-positive direction. Every
 * shipped template puts its header on the first two lines; four covers a
 * leading `---` document marker, a shebang, or a blank line above it and still
 * stops short of any file body.
 */
export const OWNERSHIP_HEADER_LINES = 4;

/** What a file's own leading lines say about who owns it. */
export type OwnershipHeader =
  /** Header asserts Lisa replaces this file wholesale. */
  | "lisa-managed"
  /** Header seeded it as the consumer's, and disclaimed overwriting. */
  | "host-owned-seed"
  /** No Lisa header at all. Lisa has no record of installing this. */
  | "unattributable";

/**
 * Read the ownership contract a file states about itself.
 *
 * Precedence is seed-before-managed. A `create-only` header mentions
 * `copy-overwrite` in its own second line, so a naive managed-first check would
 * read every seeded file as Lisa-managed — which, on the deletion path, deletes
 * files Lisa promised to keep (CodySwannGT/lisa#3656) and, on the banner path,
 * reports a truthful seed header as a false managed one. Ordering it this way
 * means the strongest claim a file can make is the one that keeps it.
 * @param contents - Raw text of the file, or a leading prefix of it long enough
 *   to contain {@link OWNERSHIP_HEADER_LINES} lines
 * @returns The contract its header states
 */
export function classifyOwnershipHeader(contents: string): OwnershipHeader {
  const header = contents
    .split("\n")
    .slice(0, OWNERSHIP_HEADER_LINES)
    .join("\n");
  if (header.includes(LISA_SEEDED_MARKER)) return "host-owned-seed";
  return header.includes(LISA_MANAGED_MARKER)
    ? "lisa-managed"
    : "unattributable";
}
