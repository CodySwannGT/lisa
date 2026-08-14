/**
 * Which managed files Lisa owns outright, as opposed to files a host project
 * shares with Lisa and legitimately customises.
 *
 * The two populations sit side by side in the `copy-overwrite` trees and want
 * opposite defaults. `tsconfig.json`, `knip.json`, and `eslint.config.ts` are
 * seeded by Lisa and then edited downstream, so a non-interactive apply must
 * never replace them without being asked. `scripts/lisa-hooks/*` and
 * `scripts/lisa-enforcement-fallback.sh` are the enforcement itself — their
 * content *is* the guard — and nobody edits them downstream. Treating those two
 * populations the same is what made a released security fix undeliverable: the
 * fail-open fixes in #2374 sat in the package while installed repos kept running
 * the vulnerable guard, until someone deleted the files by hand so the create
 * path would recreate them.
 *
 * Ownership is recognised two ways, and the second exists because the first was
 * not enough on its own.
 *
 * The original marker is the `lisa-` namespace in the path. Lisa names much of
 * what it owns outright that way — `lisa-hooks/`, `lisa-enforcement-fallback.sh`,
 * `lisa-work-item.mjs` — and its own skills and hooks invoke those by exact
 * path, which is precisely why a host cannot meaningfully fork one in place.
 *
 * But a naming convention is a stand-in for a property, and a stand-in nobody
 * enforces drifts. `scripts/check-state-classification.mjs` shipped without the
 * segment, so refresh never looked at it: every adopter who already had the file
 * was frozen on whatever version they first installed, at every version bump,
 * while CI ran the frozen gate and passed. That is #2374's undeliverable-fix
 * incident reoccurring through the very marker introduced to close it (#2551).
 *
 * It was never one file. Across the stack trees 21 shipped gates were frozen the
 * same way, `check-bdd-coverage.mjs` among them — its fix for six ways the gate
 * could report what it had not proven could reach nobody who already had it.
 *
 * So the second rule names the property directly: **`scripts/` is Lisa's
 * enforcement tree.** Everything Lisa installs there is a gate or the machinery
 * a gate calls, its content *is* the guard, and a host tunes those gates through
 * config — `.lisa.config.json`, `*.thresholds.json`, workflow inputs — never by
 * editing the checker. `check-threshold-ratchet.mjs` is the worked example: its
 * human override is a `thresholdRatchet.allow` entry, not a local edit.
 *
 * Two things bound the widening, and both matter:
 *
 * - **Scope.** This predicate is only ever asked about destinations Lisa ships
 *   from a `copy-overwrite` tree — `CopyOverwriteStrategy` and doctor's
 *   `shippedByStack` are the only callers. A host's own `scripts/` files are not
 *   Lisa-managed paths and never reach it, and Lisa's `create-only` seeds under
 *   `scripts/` are placed by a strategy that never consults it.
 * - **Proof.** Owning a file is permission to *consider* refreshing it, not to
 *   overwrite it. `classifyHostCopy` still has to prove the installed copy is
 *   behind, and a path with no ledger entry classifies `unenrolled`, which
 *   refresh reads as permission to overwrite. So enrolment in
 *   `LISA_OWNED_HASH_LEDGER` must widen in the same change as this predicate;
 *   widening one alone converts a frozen guard into a silent clobber, which is
 *   #2470's defect wearing this one's hat.
 *
 * A project that genuinely wants to hold its own version of one of these still
 * can: `.lisaignore` is filtered before any strategy runs, and an ignored path
 * is never a candidate here.
 * @module core/lisa-owned-templates
 */

/** Path-segment namespace Lisa reserves for artifacts it owns outright. */
const LISA_NAMESPACE_PREFIX = "lisa-";

/** The tree Lisa installs enforcement gates and their machinery into. */
const ENFORCEMENT_TREE = "scripts/";

/**
 * Whether a managed file is Lisa's own artifact rather than shared host content.
 * @param relativePath - Repo-relative destination path of the managed file
 * @returns True when Lisa owns the file outright and may refresh it unprompted
 */
export function isLisaOwnedTemplate(relativePath: string): boolean {
  const normalised = relativePath.replaceAll("\\", "/");
  return (
    normalised.startsWith(ENFORCEMENT_TREE) ||
    normalised
      .split("/")
      .some(segment => segment.startsWith(LISA_NAMESPACE_PREFIX))
  );
}
