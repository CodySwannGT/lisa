/**
 * The committed key set behind a `.each` table, so cases cannot leave in
 * silence.
 *
 * @remarks
 * `describe.each([])` registers nothing and the file reports green. That is
 * correct behaviour and it is exactly what makes it dangerous: when the table
 * is DERIVED from something the test does not own — a shipped export, a
 * filesystem probe, a filter — an arbitrary amount of coverage can leave
 * without a single red tick. Measured (CodySwannGT/lisa#3043): emptying
 * `UNGATED_QUALITY_JOBS` took `quality-ungated-jobs.test.ts` from 15 cases to
 * 12, and the only signal was three fewer green ticks in output nobody diffs.
 *
 * The trap that hides it is the pair of assertions such a suite already
 * carries. `expect(derivedA).toEqual(derivedB)` is satisfied by both sides
 * being empty, so the invariant guarding the table passes at its loudest
 * exactly when the table has nothing left in it.
 *
 * So the expectation is COMMITTED rather than derived: a literal key set in the
 * test, compared against the live table. That choice, rather than a non-empty
 * assertion, is deliberate. For `UNGATED_QUALITY_JOBS` an empty table is the
 * GOAL — every exemption retired — so `toBeGreaterThan(0)` would assert the
 * opposite of what the project wants and redden a healthy repository. A
 * committed key set lets empty be legitimate while making any CHANGE to it
 * loud, in both directions: an entry that leaves fails naming what left, and an
 * entry that arrives fails naming what arrived and must now be reviewed.
 *
 * This is one implementation of a shape the repository had already written by
 * hand — `quality-script-presence-jobs.test.ts` carries a deliberate
 * `expect(PRESENCE_JOBS.filter(...)).toEqual([])` whose comment says an empty
 * `it.each` is "a suite that reports passed having asserted nothing". Sharing
 * it means the next derived table gets the property without anyone
 * rediscovering the argument.
 * @module tests/helpers/committed-case-table
 */
import { expect, it } from "vitest";

/**
 * Alphabetical order both sides of the comparison are put into.
 * @param left - One key.
 * @param right - The other.
 * @returns Negative, zero or positive, per `localeCompare`.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/**
 * The failure text, naming what left and what arrived rather than diffing.
 *
 * Exported and pure so the guard's own bite is pinned by
 * `tests/unit/helpers/committed-case-table.test.ts` rather than assumed. A
 * guard whose failure path nothing exercises is the defect this file closes,
 * one level down.
 * @param subject - What the table drives, for the reader.
 * @param present - Keys the live table holds.
 * @param committed - Keys the test file commits to.
 * @returns A message an operator can act on, or `null` when nothing drifted.
 */
export function caseTableDrift(
  subject: string,
  present: readonly string[],
  committed: readonly string[]
): string | null {
  const gone = committed.filter(key => !present.includes(key));
  const arrived = present.filter(key => !committed.includes(key));

  if (gone.length === 0 && arrived.length === 0) return null;

  const parts = [
    gone.length > 0
      ? `Cases that DISAPPEARED (their assertions no longer run): ${gone.join(", ")}.`
      : "",
    arrived.length > 0
      ? `Cases that APPEARED (never reviewed): ${arrived.join(", ")}.`
      : "",
  ].filter(part => part !== "");

  return (
    `The ${subject} case table no longer matches the key set this file ` +
    `commits to. ${parts.join(" ")} A .each over an emptied table registers ` +
    `ZERO cases and the file still reports green, so the change has to be ` +
    `made here as well: update the committed key set in this test if the ` +
    `change is intended, or restore the table if it is not.`
  );
}

/**
 * Registers the guard that fails when a derived case table drifts.
 *
 * Use where the cases come from an array — a filesystem probe, a filter over a
 * roster — rather than a keyed record.
 * @param subject - What the table drives, named in the test title.
 * @param present - Keys the live table produces cases for.
 * @param committed - The key set this file commits to. `[]` is legitimate.
 */
export function committedCaseKeys(
  subject: string,
  present: readonly string[],
  committed: readonly string[]
): void {
  it(`registers a case for exactly the committed ${subject} keys`, () => {
    const live = [...present].sort(byName);
    const expected = [...committed].sort(byName);

    expect(live, caseTableDrift(subject, live, expected) ?? "").toEqual(
      expected
    );
  });
}

/**
 * The entries of a keyed table, with the drift guard registered beside them.
 *
 * Returned rather than asserted in place so the call reads as the table itself:
 * `describe.each(committedCaseTable("exemption", EXEMPT, []))`. The guard is a
 * separate `it`, so a drifted table fails BY NAME instead of throwing during
 * collection, where the failure would be attributed to the file rather than to
 * the cases that went missing.
 * @param subject - What the table drives, named in the test title.
 * @param table - The live table, usually a shipped `Object.freeze` export.
 * @param committed - The key set this file commits to. `[]` is legitimate.
 * @returns `Object.entries(table)`, ready for `.each`.
 */
export function committedCaseTable<T>(
  subject: string,
  table: Readonly<Record<string, T>>,
  committed: readonly string[]
): [string, T][] {
  const entries = Object.entries(table);

  committedCaseKeys(
    subject,
    entries.map(([key]) => key),
    committed
  );

  return entries;
}
