/**
 * Producer-side grammar check for usage-entry `artifact_ref` values.
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
 * Only the shape is checked, not the value: the workspace must still equal the
 * `linear.workspace` key in `.lisa.config.json` exactly, including case.
 *
 * Only the `linear:` scheme is checked. Other providers' refs (`github:...`,
 * bare Jira `KEY-N`, `notion:...`, and so on) pass through unchanged.
 */

const LINEAR_PREFIX = "linear:";
const LINEAR_REST_PATTERN = /^[^/\s]+\/[A-Z][A-Z0-9_]*-\d+$/;
const LINEAR_REQUIRED_FORM = "linear:<workspace>/<KEY-N>";

/**
 * Whether the part after `linear:` is `<workspace>/<KEY-N>`.
 *
 * @param rest Ref text after the `linear:` prefix.
 * @returns True for a workspace without `/` or whitespace followed by exactly
 *   one uppercase `KEY-N`.
 */
function isQualifiedLinearRest(rest: string): boolean {
  return LINEAR_REST_PATTERN.test(rest);
}

/**
 * Refuse a usage `artifact_ref` that the completion-proof reader would never
 * recognise.
 *
 * @param ref Candidate `artifact_ref` about to be written.
 * @throws {Error} When `ref` starts with `linear:` but is not
 *   `linear:<workspace>/<KEY-N>` (no `/`, an empty workspace or one holding
 *   whitespace, or a key that is not an uppercase `KEY-N`).
 */
export function assertCanonicalArtifactRef(ref: string): void {
  if (!ref.startsWith(LINEAR_PREFIX)) {
    return;
  }
  if (isQualifiedLinearRest(ref.slice(LINEAR_PREFIX.length))) {
    return;
  }
  throw new Error(
    `Usage artifact_ref "${ref}" is not a canonical Linear reference. ` +
      `Write it as ${LINEAR_REQUIRED_FORM} (for example linear:acme/ENG-11), ` +
      `taking <workspace> from the linear.workspace key in .lisa.config.json. ` +
      `The completion proof never recognises a short linear:<KEY-N> or a ` +
      `lowercase key, so such an entry would later be refused as absent.`
  );
}
