/**
 * Computing a verdict over a small catalogue, for the suites that check what
 * each requirement and the Level 1 result come out as
 * (CodySwannGT/lisa#4998).
 * @module tests/unit/controls/support/verdict-run
 */
import type { EvidenceRecord } from "../../../../src/controls/evidence-types.js";
import type { ControlRegisterEntry } from "../../../../src/controls/register-types.js";
import { computeVerdict } from "../../../../src/controls/verdict.js";
import type {
  CriterionVerdict,
  Verdict,
} from "../../../../src/controls/verdict-types.js";
import {
  entryServing,
  evidenceOf,
  findingRecord,
  heldPair,
  registerOf,
  SMALL_CATALOGUE,
  SOON_AFTER,
} from "./evidence-samples.js";

/** The control for the folder `api`. */
export const API = "code-style@api";
/** The control for the folder `web`. */
export const WEB = "code-style@web";

/** Records that make every requirement but `SI7` conforming or not applicable. */
export const OTHERS_SETTLED: readonly EvidenceRecord[] = [
  ...heldPair("review@.", "AC1.3"),
  findingRecord("AC1.4", "held"),
  findingRecord("AC1.1", "not-applicable", {
    reason: "not-applicable",
    detail: "No agent acts in this repository.",
  }),
];

/** A control for the whole repository that serves `AC1.3`. */
export const REVIEW = entryServing("review@.", ["AC1.3"]);

/**
 * Compute a verdict over the small catalogue.
 * @param entries - The register's entries
 * @param records - The evidence on record
 * @param now - The current time
 * @returns The verdict
 */
export function verdictOf(
  entries: readonly ControlRegisterEntry[],
  records: readonly EvidenceRecord[],
  now: Date = SOON_AFTER
): Verdict {
  return computeVerdict({
    catalogue: SMALL_CATALOGUE,
    register: registerOf(...entries),
    evidence: evidenceOf(records),
    now,
  });
}

/**
 * One requirement's part of a verdict.
 * @param verdict - The verdict
 * @param criterion - The requirement
 * @returns Its entry
 */
export function of(verdict: Verdict, criterion = "SI7"): CriterionVerdict {
  const found = verdict.criteria.find(each => each.criterion === criterion);
  if (found === undefined) throw new Error(`no verdict for ${criterion}`);
  return found;
}

/**
 * The verdict of `SI7` when one control serves it.
 * @param records - The evidence on record
 * @param now - The current time
 * @returns Its entry
 */
export function si7(
  records: readonly EvidenceRecord[],
  now: Date = SOON_AFTER
): CriterionVerdict {
  return of(verdictOf([entryServing(API)], records, now));
}
