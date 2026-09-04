/**
 * Why a declared path may be removed from a consumer's repository.
 *
 * `deletions.json` removes host files BY DESTINATION PATH ONLY. The path being
 * listed is the entire authorisation: nothing between the manifest and
 * `fse.remove` looks at the file's contents, its origin, or whether Lisa ever
 * installed it. CodySwannGT/lisa#3656 closed that for `.github/workflows/` by
 * reading each workflow's own ownership header, which covers 42 of 255 declared
 * paths. This module is about the other 213.
 *
 * ## Why the obvious gate is not the fix
 *
 * The natural rule — "only delete what Lisa currently ships" — was measured
 * against `main` and fails on 95% of the manifest: of the 213 non-workflow
 * paths, 11 are attributable to a lane Lisa still ships and 202 are not. The
 * 202 are not marginal. They are `.claude/skills/project-*`,
 * `.claude/skills/git:*`, `.claude/skills/jira:*` and friends — skill trees Lisa
 * renamed. Stranding them leaves every consumer carrying dead directories
 * forever, which is the harm the manifest exists to prevent. A gate that causes
 * the harm it was written to stop is the wrong gate.
 *
 * The reason it fails is structural rather than incidental: ownership is a
 * per-consumer fact and the manifest is a repo-side artifact. Lisa cannot see,
 * from its own tree, whether it put a given file in someone else's repository.
 * No amount of matching logic closes that gap, so this module stops trying to
 * infer ownership and requires it to be DECLARED.
 *
 * ## The grammar
 *
 * Every declared path carries a basis, and `force` counts as one:
 *
 * - `owned` — Lisa installs this path today; the lane is the evidence.
 * - `legacy: <reason>` — Lisa shipped it in an older version and no longer
 *   does. The reason names the version or ticket. The honest home for the 202.
 * - `needs-review` — declared before this field existed. Deletes exactly as it
 *   did before, so nothing changes for an existing consumer, but it is
 *   countable: debt kept visible rather than laundered as classified.
 * - a `force` entry — a ruling that overrides even the workflow ownership gate.
 *   Unchanged by this module; its five existing entries keep working verbatim.
 *
 * ## What an ABSENT basis means, and why it keeps
 *
 * Unclassified is not "not owned" — it is "I cannot tell", and the two must be
 * distinguishable or the uncertain case gets silently resolved as one of them.
 * The cheap error is to keep the file: a path wrongly kept is visible and
 * fixable, a path wrongly deleted is gone from someone else's repository with
 * no undo. So an unclassified path is kept and announced.
 *
 * Two rules this deliberately does NOT implement, both learned in #3656:
 *
 * 1. Ownership is never inferred from a filename. A probe of the form "does
 *    Lisa ship a file with this name anywhere?" marks the highest-risk paths
 *    SAFE precisely because Lisa knows those names.
 * 2. Ownership never keys on "was it modified". "The host has local work here"
 *    and "the host has re-armed the hazard" are the same observation on disk;
 *    only a declared reason separates them.
 * @module core/deletion-basis
 */
import type { DeletionsConfig } from "./config.js";

/** How a declared deletion path is authorised. */
export type DeletionBasisKind =
  | "owned"
  | "legacy"
  | "needs-review"
  | "force"
  | "unclassified";

/** The resolved basis for one declared path. */
export interface DeletionBasis {
  readonly kind: DeletionBasisKind;
  /** Prose accompanying a `legacy` or `force` basis; empty otherwise. */
  readonly reason: string;
}

const NEEDS_REVIEW = "needs-review";
const OWNED = "owned";
const LEGACY_PREFIX = "legacy:";

/**
 * Resolve why one declared path may be removed.
 *
 * `force` is checked first and wins: it is the strongest declaration in the
 * manifest, and a path carrying one is authorised whatever else says.
 * @param config - The parsed manifest.
 * @param relativePath - Declared path, spelled as the manifest spells it.
 * @returns The basis, or `unclassified` when the manifest does not say.
 */
export function resolveDeletionBasis(
  config: DeletionsConfig,
  relativePath: string
): DeletionBasis {
  const forced = config.force?.[relativePath];
  if (typeof forced === "string" && forced.trim() !== "")
    return { kind: "force", reason: forced };

  const declared = config.basis?.[relativePath];
  if (typeof declared !== "string" || declared.trim() === "")
    return { kind: "unclassified", reason: "" };

  const value = declared.trim();
  if (value === NEEDS_REVIEW) return { kind: NEEDS_REVIEW, reason: "" };
  if (value === OWNED) return { kind: OWNED, reason: "" };
  if (value.startsWith(LEGACY_PREFIX)) {
    const reason = value.slice(LEGACY_PREFIX.length).trim();
    // A `legacy` basis with no prose is unclassified in substance: the whole
    // point of the kind is that somebody wrote down WHY, and an empty reason
    // is the debt without the marker that makes it countable.
    if (reason === "") return { kind: "unclassified", reason: "" };
    return { kind: "legacy", reason };
  }
  return { kind: "unclassified", reason: "" };
}

/**
 * Whether a resolved basis authorises removal.
 *
 * `needs-review` authorises: this field lands with every existing path already
 * marked, so an existing consumer sees byte-identical behaviour. The gate binds
 * on paths added AFTER it, which is the whole point of shipping the mechanism
 * before the prose.
 * @param basis - A resolved basis.
 * @returns True when the path may be removed.
 */
export function basisAuthorisesDeletion(basis: DeletionBasis): boolean {
  return basis.kind !== "unclassified";
}

/**
 * Every declared path in one manifest that carries no basis.
 *
 * This is what the authoring gate refuses on. It is deliberately separate from
 * the runtime keep-decision above: the runtime rule is the fail-safe that
 * protects consumers whatever manifest they have, and this is the check that
 * stops an unclassified path being authored in the first place. A single
 * mechanism doing both would have to choose which to be.
 * @param config - The parsed manifest.
 * @returns Unclassified paths, in declaration order.
 */
export function unclassifiedDeletionPaths(
  config: DeletionsConfig
): readonly string[] {
  const keep = new Set(config.keep ?? []);
  return (config.paths ?? []).filter(
    p =>
      !keep.has(p) && !basisAuthorisesDeletion(resolveDeletionBasis(config, p))
  );
}

/**
 * Count declared paths by basis kind, for reporting the outstanding debt.
 * @param config - The parsed manifest.
 * @returns A count per kind, including zeroes.
 */
export function countDeletionBases(
  config: DeletionsConfig
): Readonly<Record<DeletionBasisKind, number>> {
  return (config.paths ?? []).reduce<Record<DeletionBasisKind, number>>(
    (counts, declaredPath) => {
      const { kind } = resolveDeletionBasis(config, declaredPath);
      return { ...counts, [kind]: counts[kind] + 1 };
    },
    {
      owned: 0,
      legacy: 0,
      [NEEDS_REVIEW]: 0,
      force: 0,
      unclassified: 0,
    }
  );
}
