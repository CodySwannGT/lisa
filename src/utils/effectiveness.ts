import {
  isEvidenceString,
  isEvidenceTime,
  parseEffectiveness,
  parseEffectivenessTokens,
} from "../../all/copy-overwrite/scripts/lib/usage-effectiveness.mjs";
import type { EffectivenessObservation } from "../../all/copy-overwrite/scripts/lib/usage-effectiveness.mjs";
export {
  isEvidenceString,
  isEvidenceTime,
  parseEffectiveness,
  parseEffectivenessTokens,
};
export type { EffectivenessObservation };
/** Observations, not scores. Unknown clocks stay null and evidence stays explicit. */
import { createHash } from "node:crypto";

/**
 * Normalize and hash exactly as the gardener does, independent of ledger entry versions.
 * @param invariant - Rule whose recurrence is being measured
 * @returns Twelve-character SHA-256 prefix
 */
export function invariantFingerprint(invariant: string): string {
  return createHash("sha256")
    .update(invariant.trim().replace(/\s+/gu, " ").toLowerCase())
    .digest("hex")
    .slice(0, 12);
}

/**
 * Summarize a run without combining distinct clocks or extrapolating missing evidence.
 * @param observation - Validated run observations
 * @returns Clock summaries and observed human event count
 */
export function summarizeEffectiveness(observation: EffectivenessObservation) {
  const row = parseEffectiveness(observation);
  const samples =
    row.feedbackMs === null ? null : [...row.feedbackMs].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    samples?.[Math.max(0, Math.ceil(samples.length * fraction) - 1)] ?? null;
  return {
    feedback:
      samples === null
        ? null
        : {
            count: samples.length,
            minMs: samples[0] ?? null,
            medianMs:
              samples.length === 0
                ? null
                : ((samples[Math.floor((samples.length - 1) / 2)] ?? 0) +
                    (samples[Math.floor(samples.length / 2)] ?? 0)) /
                  2,
            p95Ms: percentile(0.95),
            maxMs: samples.at(-1) ?? null,
          },
    workerWallMs: row.workerWallMs,
    humanInterventions:
      row.attention === null
        ? null
        : new Set(row.attention.map(event => event.id)).size,
    readyToAcceptedMs:
      row.readyAt === null || row.acceptedAt === null
        ? null
        : Date.parse(row.acceptedAt) - Date.parse(row.readyAt),
  };
}

/**
 * Render an adjacent extension; the released primary usage token never changes.
 * @param entryId - Correlated usage entry identity
 * @param observation - Optional effectiveness observation
 * @returns Extension token or empty text for legacy entries
 */
export function renderEffectivenessToken(
  entryId: string,
  observation?: EffectivenessObservation
): string {
  if (observation === undefined) return "";
  return ` <!-- lisa:usage-effectiveness entry_id=${encodeURIComponent(entryId)} data=${encodeURIComponent(JSON.stringify(parseEffectiveness(observation)))} -->`;
}
