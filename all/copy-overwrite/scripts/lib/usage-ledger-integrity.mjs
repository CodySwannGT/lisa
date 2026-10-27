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
  const parsed = parseLisaUsageSection(storedDocument);
  const expectedEntryIds = expected?.entryIds ?? [];
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
  ];
  return { ok: issues.length === 0, issues };
}
