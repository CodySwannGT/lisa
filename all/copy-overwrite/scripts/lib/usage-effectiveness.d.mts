// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Four independent clocks and their provenance for one usage row. */
export interface EffectivenessObservation {
  readonly schema: 1;
  readonly lisaVersion: string | null;
  readonly workerConfigRevision: string | null;
  readonly workerWallMs: number | null;
  readonly feedbackMs: readonly number[] | null;
  readonly workerSource: string | null;
  readonly attention:
    | readonly { readonly id: string; readonly source: string }[]
    | null;
  readonly readyAt: string | null;
  readonly acceptedAt: string | null;
  readonly lifecycleSources: readonly string[] | null;
  readonly reworkSources: readonly string[] | null;
}
export declare function isEvidenceString(value: unknown): value is string;
export declare function isEvidenceTime(value: unknown): value is string;
export declare function parseEffectiveness(
  value: unknown
): EffectivenessObservation;
export declare function parseEffectivenessTokens(
  section: string
): ReadonlyMap<string, EffectivenessObservation>;
