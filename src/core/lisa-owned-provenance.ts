/**
 * Whether a host's copy of a Lisa-owned artifact is *behind* Lisa's or *ahead*
 * of it — the question byte comparison cannot answer.
 *
 * Refresh (#2436) decided whether to overwrite a host's copy by comparing bytes.
 * Unequal bytes were read as "the host is out of date", which is one of two
 * possibilities and not the dangerous one. When the host copy is ahead —
 * a guard hardened downstream before upstream caught up — the same comparison
 * produces the same answer, and the overwrite silently deletes a security
 * control. `acmeorga/frontend` closed the `GIT_CONFIG_KEY_<n>` hooks-path
 * bypass before Lisa did; a `bun install` regenerated the file and reverted the
 * hardening with no warning and no failure. Their own tests caught it. Nothing
 * in Lisa would have.
 *
 * ## How "behind" gets proved
 *
 * The primary signal is provenance by content hash. Lisa ships a ledger of every
 * sha256 it has ever published at each Lisa-owned destination path (see
 * `scripts/generate-lisa-owned-hash-ledger.mjs`). A host's copy came from some
 * past Lisa, so if its hash is in the ledger it is *provably* an older Lisa
 * artifact and refreshing it is correct. If the hash appears nowhere in Lisa's
 * shipping history, somebody downstream edited it, and refresh has no basis to
 * call that stale.
 *
 * Hashes are the primary signal rather than capability markers because markers
 * only protect a host that *declared*. acmeorga did not declare; they edited the
 * guard. A marker-only design would still have clobbered the very incident that
 * motivated this. The ledger protects undeclared hardening, retroactively, with
 * no host-side action required.
 *
 * A ledger beats a receipt file written at apply time for the same reason: a
 * receipt has to be written by a *prior* apply to arm the mechanism, so the first
 * apply after the change is the one that clobbers — it fails exactly once, on the
 * case that matters most.
 *
 * ## Why the ledger is the *only* proof of staleness
 *
 * An earlier draft let capability markers authorise an overwrite too: if the
 * host declared capabilities and Lisa declared all of them, upstream had
 * "absorbed" the hardening, so refreshing was assumed safe. Running it against
 * the real ledger and a real guard showed that this reintroduces the original
 * bug outright.
 *
 * A host hardening a Lisa guard edits a *copy of Lisa's file*, so it keeps
 * Lisa's marker line. Its declared set therefore equals Lisa's while its bytes
 * carry undeclared changes — and the shortcut overwrote them without ever
 * consulting the ledger. That is precisely the acmeorga case, silently reverted
 * again by the mechanism meant to prevent it.
 *
 * So capabilities may only ever justify *keeping* the host's copy. Declaring
 * nothing is not evidence of having changed nothing, and no marker comparison
 * can account for bytes nobody declared. Overwriting requires positive proof
 * from the ledger, and nothing else.
 *
 * ## How the standoff ends
 *
 * Refusing forever would be its own failure, so the exits are explicit rather
 * than automatic. A `provably-stale` copy always refreshes, which is the common
 * case and keeps upgrades flowing. A `host-modified` copy is reported on every
 * apply and by `lisa doctor` until someone resolves it — by landing the change
 * upstream, or by taking Lisa's copy via `--refresh-templates`. Lisa does not
 * end that standoff on its own, because every way of doing so amounts to
 * deleting work it cannot account for.
 * @module core/lisa-owned-provenance
 */
import { createHash } from "node:crypto";

import {
  capabilitiesOnlyOnHost,
  readGuardCapabilities,
} from "./guard-capabilities.js";
import {
  LISA_OWNED_HASH_HISTORY_DERIVED,
  LISA_OWNED_HASH_LEDGER,
} from "./lisa-owned-hash-ledger.js";

/** Known-good hashes per Lisa-owned destination path. */
export type HashLedger = Readonly<Record<string, readonly string[]>>;

/** The verdict for content Lisa has no record of ever having shipped. */
const HOST_MODIFIED = "host-modified" as const;

/** The verdict for a copy declaring hardening Lisa's copy does not. */
const HOST_AHEAD = "host-ahead" as const;

/** What refresh concluded about a host's copy of a Lisa-owned artifact. */
export type ProvenanceVerdict =
  /** Byte-identical to Lisa's copy; there is nothing to decide. */
  | { readonly kind: "identical" }
  /** Declares hardening Lisa lacks. Preserve, and name what would be lost. */
  | {
      readonly kind: "host-ahead";
      readonly extraCapabilities: readonly string[];
    }
  /** Content Lisa never shipped. Preserve and report. */
  | { readonly kind: "host-modified" }
  /** Hash matches a Lisa release. Genuinely stale, so refresh it. */
  | { readonly kind: "provably-stale" }
  /** Artifact carries no provenance yet; behave exactly as before this change. */
  | { readonly kind: "unenrolled" };

/**
 * The verdicts under which the host's copy is kept.
 *
 * Derived from `ProvenanceVerdict` rather than restated, so a verdict added
 * later cannot quietly go unhandled: `mayRefreshLisaOwned` must classify it, and
 * anything it declines to refresh has to be describable here.
 */
export type PreservedVerdict = Extract<
  ProvenanceVerdict,
  { readonly kind: "host-ahead" | "host-modified" }
>;

/**
 * Hex sha256 of a file's contents.
 * @param bytes - File contents
 * @returns Lower-case hex digest
 */
function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Decide whether a host's copy of a Lisa-owned artifact may be overwritten.
 *
 * Order matters. Capabilities are consulted before the ledger because a
 * declaration is an explicit statement of intent by whoever edited the file, and
 * an explicit statement outranks an inference drawn from a hash table.
 * @param relativePath - Repo-relative destination path of the artifact
 * @param hostBytes - Contents currently installed in the host project
 * @param lisaBytes - Contents Lisa ships for that path
 * @param ledger - Known-good hash ledger (injected by tests)
 * @returns The verdict describing which side is ahead
 */
export function classifyHostCopy(
  relativePath: string,
  hostBytes: Buffer,
  lisaBytes: Buffer,
  ledger: HashLedger = LISA_OWNED_HASH_LEDGER
): ProvenanceVerdict {
  if (hostBytes.equals(lisaBytes)) return { kind: "identical" };

  const hostCapabilities = readGuardCapabilities(hostBytes);
  const extraCapabilities = capabilitiesOnlyOnHost(
    hostCapabilities,
    readGuardCapabilities(lisaBytes)
  );
  if (extraCapabilities.length > 0) {
    return { kind: HOST_AHEAD, extraCapabilities };
  }

  const known = ledger[normalise(relativePath)];
  if (known === undefined || known.length === 0) return { kind: "unenrolled" };
  return known.includes(digest(hostBytes))
    ? { kind: "provably-stale" }
    : { kind: HOST_MODIFIED };
}

/**
 * Normalise a destination path to the ledger's key form.
 * @param relativePath - Repo-relative destination path
 * @returns The path with forward slashes
 */
function normalise(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

/**
 * Where a recorded digest came from, or that nothing recorded it.
 *
 * `history` — some run of the generator derived it from the repository's own
 * history or working tree. `carry-forward` — it was already in a checked-in
 * ledger and no run has derived it since, which is the expected state for a
 * hash first recorded by a deeper clone. `unrecorded` — the ledger does not
 * vouch for these bytes at this path at all.
 */
export type DigestOrigin = "carry-forward" | "history" | "unrecorded";

/**
 * Name the source that put a digest in the ledger (CodySwannGT/lisa#3115).
 *
 * The two recorded origins have opposite correct responses — a carried-forward
 * digest must be KEPT, because a clone that cannot derive it is not evidence
 * that Lisa never shipped it, while a digest nothing accounts for is worth
 * asking about — and before this they were indistinguishable. Settling one
 * digest cost a walk of every reachable revision of two candidate paths plus
 * the reflog, then a delete-and-regenerate to find out which source had
 * produced it. This is that answer in one call.
 *
 * A `carry-forward` result is **not** a finding on its own. It is the honest
 * statement that this repository's history does not reach those bytes.
 * @param relativePath - Repo-relative destination path of the artifact
 * @param hash - Lower-case hex sha256 of the bytes in question
 * @param ledger - Known-good hash ledger (injected by tests)
 * @param historyDerived - History-attested digests (injected by tests)
 * @returns Which source recorded the digest
 */
export function digestOrigin(
  relativePath: string,
  hash: string,
  ledger: HashLedger = LISA_OWNED_HASH_LEDGER,
  historyDerived: HashLedger = LISA_OWNED_HASH_HISTORY_DERIVED
): DigestOrigin {
  const destination = normalise(relativePath);
  if (!(ledger[destination] ?? []).includes(hash)) return "unrecorded";
  return (historyDerived[destination] ?? []).includes(hash)
    ? "history"
    : "carry-forward";
}

/**
 * Whether refresh is allowed to replace the host's copy.
 *
 * The default is deliberately asymmetric. Failing closed leaves a stale file in
 * place and tells somebody about it; failing open deletes a security control and
 * tells nobody. Those costs are not comparable, so anything short of proof that
 * the host is behind means the host's copy stays.
 * @param verdict - Result of `classifyHostCopy`
 * @returns True when the host copy is provably not ahead
 */
export function mayRefreshLisaOwned(
  verdict: ProvenanceVerdict
): verdict is Exclude<ProvenanceVerdict, PreservedVerdict> {
  return verdict.kind !== HOST_AHEAD && verdict.kind !== HOST_MODIFIED;
}

/**
 * Explain a Lisa-owned file that could not be classified at all.
 *
 * Distinct from `describePreserved`, which reports a verdict. There is no
 * verdict here: one side's bytes could not be read, so nothing is known about
 * which copy is ahead. Saying "your copy is stronger" would be inventing a
 * finding, and saying "out of date" would be inventing the opposite one — so
 * this names the unreadable side and the one action that resolves it.
 * @param relativePath - Repo-relative destination path of the artifact
 * @param hostUnreadable - True when the project's copy is the unreadable side
 * @returns One operator-readable sentence
 */
export function describeUnclassifiable(
  relativePath: string,
  hostUnreadable: boolean
): string {
  const which = hostUnreadable
    ? "your project's copy of this file"
    : "its own packaged copy of this file";
  return `${relativePath}: Lisa could not read ${which}, so it could not tell whether yours is out of date or deliberately stronger. Kept yours and changed nothing. Check the file is readable, then run \`lisa apply\` again.`;
}

/**
 * Explain a preserved file to whoever is reading the apply output.
 *
 * Written for an operator who did not make the change and may not be an
 * engineer: it names the file, says plainly that theirs is the stronger copy,
 * and gives the two actions that end the standoff.
 * @param relativePath - Repo-relative destination path of the artifact
 * @param verdict - Result of `classifyHostCopy`
 * @returns One operator-readable sentence, or undefined when nothing was held back
 */
export function describePreserved(
  relativePath: string,
  verdict: PreservedVerdict
): string {
  return verdict.kind === HOST_AHEAD
    ? `${relativePath}: your copy guards against ${verdict.extraCapabilities.join(", ")}, which Lisa's copy does not. Kept yours. Nothing to do unless you want Lisa's version instead — contributing your hardening upstream is the way to get both, or run \`lisa apply\` with \`--refresh-templates\` to take Lisa's copy and drop yours.`
    : `${relativePath}: this file was edited in your project — its contents match no Lisa release, so Lisa cannot tell whether it is out of date or deliberately stronger. Kept yours. Review the difference, then either contribute the change upstream or add a \`lisa-guard-capabilities:\` line naming what it defends.`;
}
