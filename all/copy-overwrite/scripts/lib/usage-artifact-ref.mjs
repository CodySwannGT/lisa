// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The one `artifact_ref` grammar shared by the usage writer and the usage
 * read-back integrity check.
 *
 * Writers must produce a Linear ref as `linear:<workspace>/<KEY-N>`. The
 * completion-proof reader (`isVerifyEntryFor` in
 * `scripts/lib/completion-proof-content.mjs`) matches that form exactly,
 * case-sensitively, against an uppercase issue identifier; it also tolerates a
 * bare `KEY-N`, but it never recognises the short `linear:<KEY-N>`. The writer
 * is a pure utility with no config or workspace context, so it cannot
 * normalise a short ref reliably. It refuses it instead, so producer and
 * consumer agree on one grammar and a bad ref fails loudly at write time
 * rather than silently later (CodySwannGT/lisa#4699).
 *
 * An agent that writes the `lisa:usage-entry` token by hand never passes
 * through the writer, so the read-back integrity check
 * (`usage-ledger-integrity.mjs`) reports the same violation from this same
 * module (CodySwannGT/lisa#4846). Keeping the grammar here, rather than in the
 * TypeScript writer, is what stops the two from drifting apart.
 *
 * Only the shape is checked, not the value: the workspace must still equal the
 * `linear.workspace` key in `.lisa.config.json` exactly, including case.
 *
 * Only the `linear:` scheme is checked. Other providers' refs (`github:...`,
 * bare Jira `KEY-N`, `notion:...`, and so on) pass through unchanged.
 */

const LINEAR_PREFIX = "linear:";
const LINEAR_REST_PATTERN = /^[^/\s]+\/[A-Z][A-Z0-9_]*-\d+$/;

/** Operator-facing name of the only Linear form the reader recognises. */
export const LINEAR_REQUIRED_FORM = "linear:<workspace>/<KEY-N>";

/**
 * Describe why an `artifact_ref` would never be recognised by the
 * completion-proof reader.
 *
 * @param {string} ref Candidate or stored `artifact_ref`.
 * @returns {string | null} An operator-readable explanation naming the
 *   required form, or null when the ref is acceptable (any non-Linear ref, or
 *   a Linear ref already in `linear:<workspace>/<KEY-N>` form).
 */
export function canonicalArtifactRefViolation(ref) {
  if (!ref.startsWith(LINEAR_PREFIX)) {
    return null;
  }
  if (LINEAR_REST_PATTERN.test(ref.slice(LINEAR_PREFIX.length))) {
    return null;
  }
  return (
    `Usage artifact_ref "${ref}" is not a canonical Linear reference. ` +
    `Write it as ${LINEAR_REQUIRED_FORM} (for example linear:acme/ENG-11), ` +
    `taking <workspace> from the linear.workspace key in .lisa.config.json. ` +
    `The completion proof never recognises a short linear:<KEY-N> or a ` +
    `lowercase key, so such an entry would later be refused as absent.`
  );
}

/**
 * Refuse a usage `artifact_ref` that the completion-proof reader would never
 * recognise.
 *
 * @param {string} ref Candidate `artifact_ref` about to be written.
 * @returns {void}
 * @throws {Error} When `ref` starts with `linear:` but is not
 *   `linear:<workspace>/<KEY-N>` (no `/`, an empty workspace or one holding
 *   whitespace, or a key that is not an uppercase `KEY-N`).
 */
export function assertCanonicalArtifactRef(ref) {
  const violation = canonicalArtifactRefViolation(ref);
  if (violation !== null) {
    throw new Error(violation);
  }
}
