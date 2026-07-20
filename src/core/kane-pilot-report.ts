/** Quantitative adoption-gate evaluator for the Kane longitudinal pilot. */
import type { KaneOutcome } from "./kane-cli.js";
import type {
  KanePilotManifest,
  KanePilotRecord,
  KanePilotReport,
} from "./kane-pilot-types.js";

/** Default thresholds from Lisa's approved Kane integration plan. */
export const DEFAULT_KANE_PILOT_THRESHOLDS = Object.freeze({
  minimumRuns: 50,
  minimumDays: 30,
  evidenceCapturePercent: 90,
  maximumProviderFailurePercent: 5,
  maximumInconsistentVerdictPercent: 5,
  minimumTimeReductionPercent: 30,
  evidenceCompletenessPercent: 95,
  maximumPolicyIncidents: 0,
});

/** Internal aggregate metrics, including pilot-maturity state. */
interface PilotMetrics {
  readonly evidenceCapturePercent: number;
  readonly providerFailurePercent: number;
  readonly inconsistentVerdictPercent: number;
  readonly evidenceCompletenessPercent: number;
  readonly policyIncidents: number;
  readonly timeReductionPercent?: number;
  readonly averageCreditsPerRun?: number;
  readonly hasRepeatedCaseObservation: boolean;
}

/**
 * Calculate a count as a bounded percentage.
 * @param count - Matching record count
 * @param total - Total record count
 * @returns Percentage rounded to two decimals
 */
function percentage(count: number, total: number): number {
  return total === 0 ? 0 : Number(((count / total) * 100).toFixed(2));
}

/**
 * Calculate the median of an ordered or unordered numeric sample.
 * @param values - Numeric sample
 * @returns Median or undefined for an empty sample
 */
function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

/**
 * Group records by application and case without mutable accumulator state.
 * @param records - Pilot records
 * @returns Outcome/count observations per case
 */
function caseObservations(records: readonly KanePilotRecord[]): readonly {
  readonly outcomes: ReadonlySet<KaneOutcome>;
  readonly count: number;
}[] {
  const keys = [
    ...new Set(
      records.map(record => `${record.application}\u0000${record.caseId}`)
    ),
  ];
  return keys.map(key => {
    const matching = records.filter(
      record => `${record.application}\u0000${record.caseId}` === key
    );
    return {
      outcomes: new Set(matching.map(record => record.outcome)),
      count: matching.length,
    };
  });
}

/**
 * Calculate every quantitative pilot metric.
 * @param records - Append-only pilot records
 * @param manifest - Pilot policy-review and budget configuration
 * @returns Aggregate metrics
 */
function calculateMetrics(
  records: readonly KanePilotRecord[],
  manifest: KanePilotManifest
): PilotMetrics {
  const total = records.length;
  const observations = caseObservations(records);
  const reductions = records
    .filter(
      record =>
        record.durationSeconds !== undefined &&
        record.baselineSeconds !== undefined
    )
    .map(
      record =>
        (1 -
          (record.durationSeconds as number) /
            (record.baselineSeconds as number)) *
        100
    );
  const credits = records
    .map(record => record.credits)
    .filter((credit): credit is number => credit !== undefined);
  const medianReduction = median(reductions);
  return {
    evidenceCapturePercent: percentage(
      records.filter(
        record => record.evidenceCaptured ?? record.evidenceComplete
      ).length,
      total
    ),
    providerFailurePercent: percentage(
      records.filter(record =>
        ["tool_failed", "timed_out"].includes(record.outcome)
      ).length,
      total
    ),
    inconsistentVerdictPercent: percentage(
      observations.filter(observation => observation.outcomes.size > 1).length,
      observations.length
    ),
    evidenceCompletenessPercent: percentage(
      records.filter(record => record.evidenceComplete).length,
      total
    ),
    policyIncidents: Math.max(
      records.filter(record => record.policyIncident).length,
      manifest.policyReview?.incidents ?? 0
    ),
    ...(medianReduction === undefined
      ? {}
      : { timeReductionPercent: Number(medianReduction.toFixed(2)) }),
    ...(credits.length === 0
      ? {}
      : {
          averageCreditsPerRun: Number(
            (
              credits.reduce((sum, credit) => sum + credit, 0) / credits.length
            ).toFixed(2)
          ),
        }),
    hasRepeatedCaseObservation:
      observations.length > 0 &&
      observations.every(observation => observation.count >= 2),
  };
}

/**
 * List failed adoption thresholds.
 * @param manifest - Pilot budget configuration
 * @param metrics - Calculated metrics
 * @returns Human-readable failed gates
 */
function failureReasons(
  manifest: KanePilotManifest,
  metrics: PilotMetrics
): readonly string[] {
  return [
    metrics.evidenceCapturePercent < 90
      ? "evidence capture below 90%"
      : undefined,
    metrics.providerFailurePercent > 5
      ? "provider failure rate above 5%"
      : undefined,
    metrics.inconsistentVerdictPercent > 5
      ? "inconsistent verdict rate above 5%"
      : undefined,
    metrics.timeReductionPercent !== undefined &&
    metrics.timeReductionPercent < 30
      ? "median workflow time reduction below 30%"
      : undefined,
    metrics.evidenceCompletenessPercent < 95
      ? "evidence completeness below 95%"
      : undefined,
    metrics.policyIncidents > 0 ? "policy incidents detected" : undefined,
    metrics.averageCreditsPerRun !== undefined &&
    manifest.maximumCreditsPerRun !== undefined &&
    metrics.averageCreditsPerRun > manifest.maximumCreditsPerRun
      ? "average credit usage exceeds the manifest budget"
      : undefined,
  ].filter((reason): reason is string => reason !== undefined);
}

/**
 * Compute the collecting, adopt, or reject pilot verdict.
 * @param manifest - Validated pilot manifest
 * @param records - Validated accumulated records
 * @param now - Evaluation time
 * @returns Pilot report
 */
export function buildKanePilotReport(
  manifest: KanePilotManifest,
  records: readonly KanePilotRecord[],
  now: Date
): KanePilotReport {
  const daysElapsed = Math.max(
    0,
    Math.floor(
      (now.getTime() - Date.parse(manifest.startedAt)) / (24 * 60 * 60 * 1000)
    )
  );
  const metrics = calculateMetrics(records, manifest);
  const failures = failureReasons(manifest, metrics);
  const policyReviewMature =
    manifest.policyReview !== undefined &&
    Date.parse(manifest.policyReview.reviewedAt) <= now.getTime() &&
    Date.parse(manifest.policyReview.reviewedAt) -
      Date.parse(manifest.startedAt) >=
      DEFAULT_KANE_PILOT_THRESHOLDS.minimumDays * 24 * 60 * 60 * 1000;
  const collecting =
    daysElapsed < DEFAULT_KANE_PILOT_THRESHOLDS.minimumDays ||
    records.length < DEFAULT_KANE_PILOT_THRESHOLDS.minimumRuns ||
    !metrics.hasRepeatedCaseObservation ||
    !policyReviewMature;
  return {
    verdict: collecting
      ? "collecting"
      : failures.length === 0
        ? "adopt"
        : "reject",
    reasons: collecting
      ? [
          `collect until at least ${String(DEFAULT_KANE_PILOT_THRESHOLDS.minimumDays)} days, ${String(DEFAULT_KANE_PILOT_THRESHOLDS.minimumRuns)} runs, two observations per case, and a mature exterior policy review`,
          ...failures,
        ]
      : failures,
    daysElapsed,
    totalRuns: records.length,
    evidenceCapturePercent: metrics.evidenceCapturePercent,
    providerFailurePercent: metrics.providerFailurePercent,
    inconsistentVerdictPercent: metrics.inconsistentVerdictPercent,
    evidenceCompletenessPercent: metrics.evidenceCompletenessPercent,
    policyIncidents: metrics.policyIncidents,
    ...(metrics.timeReductionPercent === undefined
      ? {}
      : { timeReductionPercent: metrics.timeReductionPercent }),
    ...(metrics.averageCreditsPerRun === undefined
      ? {}
      : { averageCreditsPerRun: metrics.averageCreditsPerRun }),
  };
}
