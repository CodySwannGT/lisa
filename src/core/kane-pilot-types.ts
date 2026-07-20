/** Durable manifest, record, and report types for the Kane pilot. */
import type { KaneOutcome } from "./kane-cli.js";

/** One repeatable pilot journey. */
export interface KanePilotCase {
  readonly id: string;
  readonly objective: string;
  readonly url: string;
  readonly baselineSeconds?: number;
}

/** One disposable downstream application participating in the pilot. */
export interface KanePilotApplication {
  readonly name: string;
  readonly projectRoot: string;
  readonly environment: string;
  readonly cases: readonly KanePilotCase[];
}

/** Exterior review of security, privacy, and policy incidents. */
export interface KanePilotPolicyReview {
  readonly reviewedAt: string;
  readonly incidents: number;
}

/** Checked-in pilot manifest. */
export interface KanePilotManifest {
  readonly version: 1;
  readonly startedAt: string;
  readonly applications: readonly KanePilotApplication[];
  readonly resultsFile: string;
  readonly maximumCreditsPerRun?: number;
  readonly policyReview?: KanePilotPolicyReview;
}

/** Append-only record for one case execution. */
export interface KanePilotRecord {
  readonly timestamp: string;
  readonly application: string;
  readonly caseId: string;
  readonly outcome: KaneOutcome;
  readonly durationSeconds?: number;
  readonly baselineSeconds?: number;
  readonly credits?: number;
  readonly evidenceCaptured?: boolean;
  readonly evidenceComplete: boolean;
  readonly policyIncident: boolean;
}

/** Pilot adoption status. */
export type KanePilotVerdict = "collecting" | "adopt" | "reject";

/** Aggregated metrics and gate verdict. */
export interface KanePilotReport {
  readonly verdict: KanePilotVerdict;
  readonly reasons: readonly string[];
  readonly daysElapsed: number;
  readonly totalRuns: number;
  readonly evidenceCapturePercent: number;
  readonly providerFailurePercent: number;
  readonly inconsistentVerdictPercent: number;
  readonly timeReductionPercent?: number;
  readonly evidenceCompletenessPercent: number;
  readonly policyIncidents: number;
  readonly averageCreditsPerRun?: number;
}
