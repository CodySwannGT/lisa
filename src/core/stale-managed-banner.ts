/**
 * Is a "managed by Lisa" banner on a consumer's file still TRUE?
 *
 * The banner is not decoration and it is not a label — it is an instruction.
 * "This file is managed by Lisa and IS replaced on each `lisa` run. Do not edit
 * directly" tells an engineer, and every agent reading the repository, that a
 * local fix to that file is pointless. When the template it came from has been
 * removed upstream, the sentence is false in the most expensive direction
 * available: it discourages exactly the edits the file now needs, and it
 * inverts any "is this ours to change?" audit that trusts it. A consuming
 * repository had a proposal to remove one such workflow declined on the stated
 * grounds that it was "a Lisa-managed file". It was not one
 * (CodySwannGT/lisa#3703).
 *
 * ## The claim this module makes, and the one it refuses to make
 *
 * It answers exactly one question: **does the installed package ship anything
 * at this destination path?** That is provable from the package on disk. It
 * does NOT claim to know why the answer is no — a template genuinely retired
 * upstream and a file the consumer derived by copying a Lisa template to a new
 * name are indistinguishable without a provenance record neither one carries.
 * Both make the banner false, and both make the file the host's, so the
 * finding is worded as the provable claim rather than the causal story.
 *
 * ## Report, never repair
 *
 * Nothing here edits, rewrites, or deletes anything. That is deliberate and it
 * is the whole safety argument. The file under a stale banner may now be the
 * host's only copy of that workflow or script, Lisa no longer has a template to
 * reconcile it against, and an automatic "strip the banner" pass would be Lisa
 * rewriting a file it has just finished proving it does not own. The remedy is
 * a one-line edit a human makes with the context to make it.
 *
 * ## Three states, never two
 *
 * The caller must distinguish "ships a template here", "ships nothing here",
 * and "could not establish what it ships". The last one is not a variant of the
 * second: a probe run against an unreadable or absent template tree reports
 * every file as unshipped, which would condemn a whole repository's banners at
 * once. This module refuses to be handed an empty index — see
 * {@link classifyManagedBanner} — and the caller carries the indeterminate case
 * as its own reported outcome.
 * @module core/stale-managed-banner
 */
import { classifyOwnershipHeader } from "./ownership-header.js";

/**
 * How the installed package ships a destination path.
 *
 * Only the two ownership-header strategies are named. Every other strategy —
 * `merge`, `tagged-merge`, `copy-contents`, `package-lisa` — collapses to
 * `other` because the question those answer is the same one: Lisa still writes
 * this path, so a banner saying so is not false. Distinguishing them further
 * would add states no caller acts on.
 */
export type ShippedTemplateStrategy =
  | "copy-overwrite"
  | "create-only"
  | "other";

/** What a file's managed banner is worth, given what the package ships. */
export type ManagedBannerVerdict =
  /** The banner is true: Lisa still writes this path. */
  | { readonly kind: "accurate" }
  /**
   * Lisa still ships this path, but as a `create-only` seed — so the file is
   * the host's and the managed wording overstates Lisa's claim.
   *
   * Reported as its own verdict rather than folded into `retired` because the
   * two have different remedies and different populations: this one is the
   * template that MOVED (CodySwannGT/lisa#3582), and calling it retired would
   * tell an operator that a template still in the package is gone.
   */
  | { readonly kind: "overstated" }
  /** Lisa ships nothing at this path. The banner is false and the file is the host's. */
  | { readonly kind: "retired" }
  /** The file makes no managed claim, so there is nothing to be wrong about. */
  | { readonly kind: "not-managed" };

/**
 * How many stale paths to name inline before deferring to a count.
 *
 * Naming them is the point of the finding, so the cap is generous; a doctor
 * line that runs to two hundred filenames is one an operator scrolls past.
 */
export const MAX_NAMED_STALE_BANNERS = 10;

/**
 * Normalise a repo-relative path so Windows separators compare equal.
 * @param relativePath - Repo-relative path as the caller spelled it
 * @returns The same path with forward slashes
 */
function normalise(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

/**
 * Judge one file's managed banner against what the installed package ships.
 *
 * `shippedDestinations` must be the destinations of EVERY lane the package
 * ships, not the lanes this project detected as. A template that ships only
 * under one stack is still shipped; scoping the index to detected stacks would
 * report every stack-specific artifact in the repository as retired the moment
 * detection shifted, which is the same false accusation with a different cause.
 *
 * An empty index is rejected rather than answered. "Ships nothing anywhere" is
 * not a state a real package can be in, so it means the tree was unreadable or
 * was never enumerated — and answering it would classify every managed file in
 * the project as retired at once.
 * @param relativePath - Repo-relative path of the file on disk
 * @param header - The file's leading bytes, long enough to carry its header
 * @param shippedDestinations - Every destination the installed package ships,
 *   with the strategy that ships it
 * @returns What the file's banner is worth
 * @throws {Error} When the shipped index is empty, which is not an answer
 */
export function classifyManagedBanner(
  relativePath: string,
  header: string,
  shippedDestinations: ReadonlyMap<string, ShippedTemplateStrategy>
): ManagedBannerVerdict {
  if (shippedDestinations.size === 0) {
    throw new Error(
      "refusing to judge banners against an empty template index: an unreadable package ships nothing, which is not the same as removing everything"
    );
  }
  if (classifyOwnershipHeader(header) !== "lisa-managed") {
    return { kind: "not-managed" };
  }
  const shippedAs = shippedDestinations.get(normalise(relativePath));
  if (shippedAs === undefined) return { kind: "retired" };
  return shippedAs === "create-only"
    ? { kind: "overstated" }
    : { kind: "accurate" };
}

/**
 * The operator-facing finding for files whose managed banner has gone false.
 *
 * Written for whoever is about to decide whether they may touch one of these
 * files. It names them, states the provable fact rather than the causal story,
 * and says what changes — the sentence, not the file. It deliberately does not
 * suggest removing the file: whether the workflow or script should still exist
 * is a separate question, and answering it here is how the original harm
 * happened in reverse.
 * @param relativePaths - Repo-relative paths carrying a false managed banner
 * @returns One operator-readable detail line
 */
export function describeStaleManagedBanners(
  relativePaths: readonly string[]
): string {
  const named = relativePaths.slice(0, MAX_NAMED_STALE_BANNERS);
  const withheld = relativePaths.length - named.length;
  const suffix = withheld > 0 ? `, and ${withheld} more` : "";
  return (
    `These files say Lisa manages them and replaces them on each run, but the ` +
    `installed Lisa ships no template at their paths, so nothing replaces ` +
    `them and the banner is false: ${named.join(", ")}${suffix}. The files are ` +
    `yours — edit them, and correct or remove the banner sentence so the next ` +
    `reader is not told a local fix is pointless. Lisa will not rewrite or ` +
    `remove these files; it no longer has a template for them`
  );
}
