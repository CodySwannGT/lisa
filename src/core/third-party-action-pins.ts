/**
 * Finding and rewriting mutable third-party `uses:` refs in a workflow file.
 *
 * Pure text in, pure text out — no filesystem, no network, no policy. The
 * migration that owns those concerns is
 * `migrations/ensure-third-party-action-pins`; everything here is the part that
 * can be tested against a string.
 *
 * **Why a consumer needs this at all.** #3585 pinned every third-party action
 * in this repository and in the `create-only` workflow templates. A
 * `create-only` file is written once, at repository creation, and is never
 * overwritten on a later run — that is the contract and it is correct. So the
 * template correction changed what FUTURE repositories are seeded with and
 * changed nothing about any repository seeded before it. Every already-seeded
 * consumer still resolves those actions through a branch or a floating tag at
 * job start, including the ones whose entire function is to place repository
 * secrets into the job environment (#3588).
 *
 * **Why the rewrite is line-scoped rather than file-scoped.** A seeded workflow
 * belongs to the host, who may have edited it. Replacing the file would be an
 * overwrite of somebody else's work; replacing only the matched `uses:` refs
 * leaves every other edit intact, which is what lets this run against a
 * diverged file at all.
 * @module core/third-party-action-pins
 */

/**
 * The owner of Lisa's own reusable workflows.
 *
 * A first-party `uses:` is a different threat model — a stability question
 * about an upstream we own and can read (#3488) — and pinning it here would
 * freeze consumers at whatever Lisa release happened to be current, which is
 * the opposite of what those refs are for. Compared case-insensitively because
 * GitHub owners are.
 */
const FIRST_PARTY_OWNERS = ["codyswanngt"];

/**
 * GitHub's own action namespaces.
 *
 * These are published by the same party that runs the job, so pinning them
 * moves no trust boundary. The exemption is an OWNER allowlist, never a
 * substring match, so `actions-rs/toolchain` is still third-party.
 */
const GITHUB_OWNED_OWNERS = ["actions", "github"];

/** A ref that is already an immutable full commit SHA. */
const PINNED_REF = /^[0-9a-f]{40}$/;

/**
 * One `uses:` line carrying a mutable third-party ref.
 */
export interface UnpinnedRef {
  /** Zero-based line index within the source. */
  readonly line: number;
  /** Owner segment, e.g. `noliran`. */
  readonly owner: string;
  /** Repository segment, e.g. `branch-based-secrets`. */
  readonly repo: string;
  /** Full action path as written, e.g. `snyk/actions/node`. */
  readonly action: string;
  /** The mutable ref as written, e.g. `v1` or `master`. */
  readonly ref: string;
}

/** A resolved pin: the SHA a ref pointed at, for one action path. */
export interface ResolvedPin {
  readonly action: string;
  readonly ref: string;
  readonly sha: string;
}

/**
 * `uses:` lines, with or without the list dash.
 *
 * The value is captured as one run of non-space, non-comment characters and
 * split afterwards rather than being described in the pattern. Spelling the
 * `owner/repo/path@ref` shape as adjacent character classes gives the engine
 * two ways to divide the same text, which is super-linear on a long line; one
 * greedy run has only one.
 */
const USES_LINE = /^(?<lead>\s*(?:-\s+)?uses:\s*)(?<slug>[^\s#]+)/;

/** A parsed `owner/repo[/path]@ref` value. */
interface ParsedSlug {
  readonly owner: string;
  readonly repo: string;
  readonly action: string;
  readonly ref: string;
}

/**
 * Split a `uses:` value into its action path and ref.
 *
 * The ref is taken from the LAST `@`, because an action path may not contain
 * one but a ref legitimately can.
 * @param slug - The raw value of a `uses:` line
 * @returns The parsed parts, or null when this is not an owner/repo reference
 */
function parseSlug(slug: string): ParsedSlug | null {
  const at = slug.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  const action = slug.slice(0, at);
  const [owner, repo] = action.split("/");
  if (owner === undefined || repo === undefined || repo === "") {
    return null;
  }
  return { owner, repo, action, ref: slug.slice(at + 1) };
}

/**
 * Whether an owner is exempt from pinning.
 * @param owner - The owner segment of a `uses:` path
 * @returns True for first-party and GitHub-owned actions
 */
function isExemptOwner(owner: string): boolean {
  const lower = owner.toLowerCase();
  return (
    FIRST_PARTY_OWNERS.includes(lower) || GITHUB_OWNED_OWNERS.includes(lower)
  );
}

/**
 * Find every mutable third-party `uses:` ref in one workflow source.
 *
 * A ref that is already a 40-character SHA is not returned even when it carries
 * no version comment. That is a real finding for the detector, which reports
 * it, but it is not something this migration can repair: recovering the
 * human-readable version behind an existing pin needs a judgement the migration
 * cannot make, and rewriting the pin would risk moving it.
 * @param source - Workflow file contents
 * @returns Every unpinned third-party reference, in file order
 */
export function findUnpinnedRefs(source: string): readonly UnpinnedRef[] {
  return source.split("\n").flatMap((text, line) => {
    const slug = USES_LINE.exec(text)?.groups?.slug;
    const parsed = slug === undefined ? null : parseSlug(slug);
    if (parsed === null || isExemptOwner(parsed.owner)) {
      return [];
    }
    return PINNED_REF.test(parsed.ref) ? [] : [{ line, ...parsed }];
  });
}

/**
 * Rewrite the matched refs to their resolved SHAs.
 *
 * The original ref becomes the trailing comment, so the line still says what is
 * installed. A pin without that is immutable but unreadable: nobody can tell
 * what it carries, so nobody upgrades it, so it rots at whatever commit it was
 * frozen at — the same reason #3585's own gate treats a bare SHA as a finding.
 *
 * Any pre-existing trailing comment on the line is replaced rather than
 * appended to, because it described the ref that is being pinned away.
 * @param source - Workflow file contents
 * @param pins - Resolutions to apply, keyed by action path and ref
 * @returns The rewritten source, or the original when nothing matched
 */
export function applyPins(
  source: string,
  pins: readonly ResolvedPin[]
): string {
  if (pins.length === 0) {
    return source;
  }
  const bySlug = new Map(pins.map(pin => [`${pin.action}@${pin.ref}`, pin]));
  return source
    .split("\n")
    .map(text => {
      const groups = USES_LINE.exec(text)?.groups;
      const slug = groups?.slug;
      if (slug === undefined) {
        return text;
      }
      const pin = bySlug.get(slug);
      return pin === undefined
        ? text
        : `${groups?.lead as string}${pin.action}@${pin.sha} # ${pin.ref}`;
    })
    .join("\n");
}

/**
 * Collapse findings to the distinct `action@ref` pairs that need resolving.
 *
 * One workflow can reference the same action five times — the seeded NestJS
 * deploy workflow references `noliran/branch-based-secrets@v1` exactly that
 * often — and each must resolve to the same SHA, so they are resolved once.
 * @param refs - Findings from one or more files
 * @returns Distinct references, in first-seen order
 */
export function distinctRefs(
  refs: readonly UnpinnedRef[]
): readonly UnpinnedRef[] {
  const slugs = refs.map(ref => `${ref.action}@${ref.ref}`);
  return refs.filter(
    (_ref, index) => slugs.indexOf(slugs[index] ?? "") === index
  );
}
