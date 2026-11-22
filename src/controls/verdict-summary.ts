/**
 * Saying a verdict's Level 1 result in one line.
 *
 * The line is what an operator reads at the end of an attest run and of a
 * check. It gives the result, how many requirements stand in its way, and
 * the first few of them by id; the reason for each is in the verdict file.
 * @module controls/verdict-summary
 */
import { VERDICT_PATH, type Verdict } from "./verdict-types.js";
import { inScopeCriteria, type CriterionCatalogue } from "./catalogue.js";
import { unmappedGateEvidence } from "./unmapped-gate-evidence.js";

/** How many requirement ids the line names before it counts the rest. */
const NAMED_LIMIT = 10;

/**
 * Name the first few requirements of a list and count the rest.
 * @param ids - The requirement ids
 * @returns For example `AC1.1, AC1.2 and 40 more`
 */
function firstFew(ids: readonly string[]): string {
  const named = ids.slice(0, NAMED_LIMIT).join(", ");
  const rest = ids.length - NAMED_LIMIT;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

/**
 * Say a verdict's Level 1 result in one line.
 * @param verdict - The verdict
 * @returns The line
 */
export function levelSummary(verdict: Verdict): string {
  const total = verdict.criteria.length;
  const { counts, prevented_by: prevented } = verdict;
  if (verdict.result === "conforming") {
    const until =
      verdict.current_until === null
        ? ""
        : ` The evidence stays current until ${verdict.current_until}.`;
    return `Level 1 result: conforming. Conforming or not applicable: all ${total} requirements.${until}`;
  }
  const met = counts.conforming + counts["not-applicable"];
  return `Level 1 result: non-conforming. Conforming or not applicable: ${met} of ${total} requirements. Preventing a conforming result: ${prevented.length} (${counts["non-conforming"]} non-conforming, ${counts.unknown} unknown): ${firstFew(prevented)}. The reason for each is in ${VERDICT_PATH}.`;
}

/**
 * Explain catalogue gaps for requirements that still lack evidence.
 * @param catalogue - The criteria used to produce the verdict
 * @param verdict - The result from the register and evidence
 * @returns The gaps in catalogue order
 */
export function unmappedEvidenceLines(
  catalogue: CriterionCatalogue,
  verdict: Verdict
): readonly string[] {
  const missing = new Set(
    verdict.criteria
      .filter(
        entry =>
          entry.entries.length === 0 &&
          (entry.verdict === "unknown" || entry.reason === "nothing-found")
      )
      .map(entry => entry.criterion)
  );
  return inScopeCriteria(catalogue).flatMap(criterion => {
    const guidance = missing.has(criterion.id)
      ? unmappedGateEvidence(criterion)
      : null;
    return guidance === null
      ? []
      : [`${criterion.id} needs evidence. ${guidance}`];
  });
}
