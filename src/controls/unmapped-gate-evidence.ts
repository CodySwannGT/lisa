/** The catalogue's evidence guidance when Lisa has no registered gate. */
import type { InScopeCriterion } from "./catalogue.js";
import { minimumRungOf } from "./verdict.js";

/**
 * Explain why no gate is available and what rung the requirement needs.
 * @param criterion - The requirement whose evidence is missing
 * @returns Guidance, or no guidance if the catalogue records no gap
 */
export function unmappedGateEvidence(
  criterion: InScopeCriterion
): string | null {
  const reason = criterion.no_gate_reason;
  if (
    criterion.kind !== "gate" ||
    typeof reason !== "string" ||
    reason.trim() === ""
  ) {
    return null;
  }
  return `${reason} The minimum evidence rung is ${minimumRungOf(criterion)}.`;
}
