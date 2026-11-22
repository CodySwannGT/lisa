// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import {
  LINEAR_REQUIRED_FORM,
  canonicalArtifactRefViolation,
} from "./usage-artifact-ref.mjs";
import { LISA_USAGE_HEADING, parseLisaUsageSection } from "./usage-ledger.mjs";
/**
 * Sort ids so an integrity report is deterministic regardless of document order.
 *
 * @param ids Entry ids to normalize.
 * @returns The ids in stable sorted order.
 */
function sortedIds(ids) {
  return [...ids].sort((left, right) =>
    left > right ? 1 : left < right ? -1 : 0
  );
}
/**
 * Emit an issue only when it actually names something, so callers can compose
 * checks by concatenation instead of conditional accumulation.
 *
 * @param code Stable issue code.
 * @param entryIds Entry ids the issue is about.
 * @param message Operator-readable description.
 * @returns A zero- or one-element issue list.
 */
function reportIssue(code, entryIds, message) {
  return entryIds.length === 0 ? [] : [{ code, entryIds, message }];
}
/**
 * Report entries the caller just wrote that the stored surface cannot produce.
 *
 * @param expectedEntryIds Entry ids the caller believes it persisted.
 * @param parsedEntryIds Entry ids actually parseable from the stored section.
 * @returns Zero or one `missing-entry-token` issue.
 */
function findDroppedExpectedEntries(expectedEntryIds, parsedEntryIds) {
  const missing = sortedIds(
    expectedEntryIds.filter(entryId => !parsedEntryIds.has(entryId))
  );
  return reportIssue(
    "missing-entry-token",
    missing,
    `Stored section does not contain a parseable lisa:usage-entry token for: ${missing.join(", ")}. The write surface dropped them.`
  );
}
/**
 * Report rollup references that resolve to no direct entry in the same section.
 *
 * @param rollupEntryIds Entry ids named by the stored rollup token.
 * @param parsedEntryIds Entry ids actually parseable from the stored section.
 * @param alreadyReported Ids already reported as dropped caller expectations.
 * @returns Zero or one `missing-entry-token` issue.
 */
function findUnresolvableRollupReferences(
  rollupEntryIds,
  parsedEntryIds,
  alreadyReported
) {
  const unresolvable = sortedIds(
    rollupEntryIds.filter(
      entryId =>
        !parsedEntryIds.has(entryId) && !alreadyReported.includes(entryId)
    )
  );
  return reportIssue(
    "missing-entry-token",
    unresolvable,
    `Rollup direct_entry_ids names entries that cannot be parsed from the same section: ${unresolvable.join(", ")}.`
  );
}
/**
 * Report direct entries the stored rollup token fails to account for.
 *
 * @param rollup Stored rollup token, or null when the section carries none.
 * @param parsedEntryIds Entry ids actually parseable from the stored section.
 * @returns Zero or one issue describing the disagreement.
 */
function findRollupCoverageGaps(rollup, parsedEntryIds) {
  const entryIds = sortedIds(parsedEntryIds);
  if (rollup === null) {
    // Every section Lisa writes carries a rollup token, even a child-only or
    // fully empty ledger, so a missing token is always corruption -- report
    // it unconditionally rather than routing through reportIssue(), which
    // suppresses issues that name zero entries.
    return [
      {
        code: "missing-rollup-token",
        entryIds,
        message: `Stored section has ${entryIds.length} direct entr${entryIds.length === 1 ? "y" : "ies"} but no lisa:usage-rollup token.`,
      },
    ];
  }
  const recorded = new Set(rollup.directEntryIds);
  const unrecorded = entryIds.filter(entryId => !recorded.has(entryId));
  return reportIssue(
    "unrecorded-entry",
    unrecorded,
    `Stored section contains direct entries absent from rollup direct_entry_ids: ${unrecorded.join(", ")}.`
  );
}
/**
 * Report direct entries whose `artifact_ref` the completion-proof reader would
 * never recognise. The writer refuses such a ref, but a token written by hand
 * never passes through the writer, and the entry would otherwise be refused
 * only later, at completion, as "absent" (CodySwannGT/lisa#4846). The grammar
 * comes from the module the writer uses, so the two cannot drift apart.
 *
 * When the caller names the entries it just wrote, only those are checked: a
 * legacy short-ref row written before the grammar existed must not block every
 * later write to the same artifact, including the qualified entry that
 * replaces it. With no ids every entry is checked.
 *
 * @param {readonly { entryId: string, artifactRef: string }[]} entries Direct
 *   entries parsed from the stored section.
 * @param {readonly string[]} expectedEntryIds Entry ids the caller just wrote;
 *   empty to check every entry.
 * @returns Zero or one `non-canonical-artifact-ref` issue.
 */
function findNonCanonicalArtifactRefs(entries, expectedEntryIds) {
  const inScope =
    expectedEntryIds.length === 0
      ? entries
      : entries.filter(entry => expectedEntryIds.includes(entry.entryId));
  const offending = inScope
    .filter(entry => canonicalArtifactRefViolation(entry.artifactRef) !== null)
    .sort((left, right) =>
      left.entryId > right.entryId ? 1 : left.entryId < right.entryId ? -1 : 0
    );
  const refs = offending.map(
    entry => `${entry.entryId} (${entry.artifactRef})`
  );
  return reportIssue(
    "non-canonical-artifact-ref",
    offending.map(entry => entry.entryId),
    `Stored section has entries whose artifact_ref the completion proof will never recognise: ${refs.join(", ")}. Rewrite each Linear ref as ${LINEAR_REQUIRED_FORM}, taking <workspace> from the linear.workspace key in .lisa.config.json.`
  );
}
/**
 * Verify that a STORED managed usage section is still a readable ledger.
 *
 * This exists because a write surface can accept a section, report success, and
 * silently destroy part of it. Callers must run this against the bytes read back
 * from the host, never against the payload they sent and never against the
 * mutation's return value — trusting the mutation result is precisely what let a
 * Linear description strip every entry token while reporting `success: true`.
 *
 * @param storedDocument Artifact body or comment body as read back from the host.
 * @param expected Optional expectations from the write that was just performed.
 * @param expected.entryIds Entry ids the caller believes it just persisted.
 * @returns Whether the stored ledger is enumerable, plus every issue found.
 */
export function verifyLisaUsageSectionIntegrity(storedDocument, expected) {
  const expectedEntryIds = expected?.entryIds ?? [];
  let parsed;
  try {
    parsed = parseLisaUsageSection(storedDocument);
  } catch {
    // Keep the parser strict; this reporting boundary must fail closed without
    // echoing remote-controlled accounting tokens from the parser's error.
    return {
      ok: false,
      issues: [
        {
          code: "malformed-usage-section",
          entryIds: sortedIds(expectedEntryIds),
          message:
            "Stored Lisa Usage section cannot be parsed. Repair its managed accounting tokens before relying on the ledger.",
        },
      ],
    };
  }
  if (parsed.range === null) {
    const missing = sortedIds(expectedEntryIds);
    const issues = reportIssue(
      "missing-section",
      missing,
      `Stored artifact has no ${LISA_USAGE_HEADING} section, but ${missing.length} usage entr${missing.length === 1 ? "y was" : "ies were"} written to it.`
    );
    return { ok: issues.length === 0, issues };
  }
  const parsedEntryIds = new Set(parsed.entries.map(entry => entry.entryId));
  const droppedExpected = findDroppedExpectedEntries(
    expectedEntryIds,
    parsedEntryIds
  );
  const issues = [
    ...droppedExpected,
    ...findUnresolvableRollupReferences(
      parsed.rollup?.directEntryIds ?? [],
      parsedEntryIds,
      droppedExpected.flatMap(issue => issue.entryIds)
    ),
    ...findRollupCoverageGaps(parsed.rollup, parsedEntryIds),
    ...findNonCanonicalArtifactRefs(parsed.entries, expectedEntryIds),
  ];
  return { ok: issues.length === 0, issues };
}
/**
 * Whether a stored managed usage section is an intact, enumerable ledger,
 * ignoring `artifact_ref` grammar.
 *
 * The completion proof applies the reader's own grammar (`isVerifyEntryFor`)
 * per expected Verify entry, and before CodySwannGT/lisa#4846 a section whose
 * entries carried a short Linear ref was still an intact ledger to it. A legacy
 * row with a short ref on some OTHER flow is harmless to that reader, so the
 * write-time grammar issue must not turn such a body into a fatal integrity
 * failure at completion. This keeps completion behaviour exactly as it was:
 * nothing newly accepted, nothing newly refused.
 *
 * @param {string} storedDocument Artifact body or comment body as read back.
 * @returns {boolean} True when every reported issue is an artifact_ref
 *   grammar issue (or there are none).
 */
export function isLisaUsageLedgerIntact(storedDocument) {
  return verifyLisaUsageSectionIntegrity(storedDocument).issues.every(
    issue => issue.code === "non-canonical-artifact-ref"
  );
}
