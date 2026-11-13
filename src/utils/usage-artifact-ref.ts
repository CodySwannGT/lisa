/**
 * Producer-side grammar check for usage-entry `artifact_ref` values.
 *
 * The completion-proof reader (`isVerifyEntryFor` in
 * `scripts/lib/completion-proof-content.mjs`) recognises a Linear Verify entry
 * only when its `artifact_ref` is the workspace-qualified
 * `linear:<workspace>/<KEY-N>`. The writer is a pure utility with no config or
 * workspace context, so it cannot normalise a short `linear:<KEY-N>` reliably.
 * It refuses it instead, so producer and consumer agree on one grammar and a
 * bad ref fails loudly at write time rather than silently later
 * (CodySwannGT/lisa#4699).
 *
 * Only the `linear:` scheme is checked. Other providers' refs (`github:...`,
 * bare Jira `KEY-N`, `notion:...`, and so on) pass through unchanged.
 */

const LINEAR_PREFIX = "linear:";
const LINEAR_KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/i;
const LINEAR_REQUIRED_FORM = "linear:<workspace>/<KEY-N>";

/**
 * Whether the part after `linear:` is `<workspace>/<KEY-N>`.
 *
 * @param rest Ref text after the `linear:` prefix.
 * @returns True for a non-empty workspace followed by exactly one `KEY-N`.
 */
function isQualifiedLinearRest(rest: string): boolean {
  const slash = rest.indexOf("/");
  return slash > 0 && LINEAR_KEY_PATTERN.test(rest.slice(slash + 1));
}

/**
 * Refuse a usage `artifact_ref` that the completion-proof reader would never
 * recognise.
 *
 * @param ref Candidate `artifact_ref` about to be written.
 * @throws {Error} When `ref` starts with `linear:` but is not
 *   `linear:<workspace>/<KEY-N>` (no `/`, an empty workspace, or a key that is
 *   not `KEY-N`).
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
      `The completion proof only recognises that form, so a short ` +
      `linear:<KEY-N> entry would later be refused as absent.`
  );
}
