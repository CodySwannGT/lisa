/**
 * Whether a host's copy of a Lisa-owned artifact is *behind* Lisa's or *ahead*
 * of it — the question byte comparison cannot answer.
 *
 * Refresh (#2436) decided whether to overwrite a host's copy by comparing bytes.
 * Unequal bytes were read as "the host is out of date", which is one of two
 * possibilities and not the dangerous one. When the host copy is ahead —
 * a guard hardened downstream before upstream caught up — the same comparison
 * produces the same answer, and the overwrite silently deletes a security
 * control. `propswapllc/frontend` closed the `GIT_CONFIG_KEY_<n>` hooks-path
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
 * only protect a host that *declared*. propswap did not declare; they edited the
 * guard. A marker-only design would still have clobbered the very incident that
 * motivated this. The ledger protects undeclared hardening, retroactively, with
 * no host-side action required.
 *
 * A ledger beats a receipt file written at apply time for the same reason: a
 * receipt has to be written by a *prior* apply to arm the mechanism, so the first
 * apply after the change is the one that clobbers — it fails exactly once, on the
 * case that matters most.
 *
 * ## How the standoff ends
 *
 * Refusing forever is its own failure: genuine drift would accumulate and never
 * be fixed. Capability markers are the release valve. When the host declares
 * capabilities and Lisa's copy declares all of them, upstream has absorbed the
 * host's hardening, so overwriting restores parity instead of removing
 * protection — and refresh resumes automatically, with no operator action. A
 * host that hardened without declaring gets told to do one of the two things
 * that end the standoff: land it upstream, or declare it.
 * @module core/lisa-owned-provenance
 */
import { createHash } from "node:crypto";

import {
  capabilitiesOnlyOnHost,
  readGuardCapabilities,
} from "./guard-capabilities.js";
import { LISA_OWNED_HASH_LEDGER } from "./lisa-owned-hash-ledger.js";

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
  /** Content Lisa never shipped, with nothing declared. Preserve and report. */
  | { readonly kind: "host-modified" }
  /** Declared hardening that upstream now also has. Safe to refresh. */
  | { readonly kind: "absorbed-upstream" }
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
  if (hostCapabilities.size > 0) return { kind: "absorbed-upstream" };

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
    ? `${relativePath}: your copy guards against ${verdict.extraCapabilities.join(", ")}, which Lisa's copy does not. Kept yours. To take Lisa's copy later, contribute your hardening upstream — refresh resumes on its own once Lisa declares it too.`
    : `${relativePath}: this file was edited in your project — its contents match no Lisa release, so Lisa cannot tell whether it is out of date or deliberately stronger. Kept yours. Review the difference, then either contribute the change upstream or add a \`lisa-guard-capabilities:\` line naming what it defends.`;
}
