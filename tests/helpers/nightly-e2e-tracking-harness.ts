/**
 * Typed fixtures for the combined nightly-E2E tracking RED packet.
 *
 * The production module is loaded dynamically so this packet can compile
 * before the new copy-overwrite asset exists. The first RED therefore names
 * the missing production boundary, while every later row exercises its public
 * state-machine and provider-adapter contract.
 *
 * @module tests/helpers/nightly-e2e-tracking-harness
 */
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/** Public destinations accepted by `.lisa.config.json`. */
export const TRACKING_DESTINATIONS = Object.freeze([
  "github",
  "sentry",
  "jira",
  "linear",
  "none",
] as const);

/** Public nightly tracking destination. */
export type TrackingDestination = (typeof TRACKING_DESTINATIONS)[number];

/** Exact workflow identities which constitute the combined condition. */
export const TRACKED_SUITE_LABELS = Object.freeze([
  "🎭 Playwright Web E2E",
  "📱 Maestro Native E2E",
] as const);

/** One decisive suite observation consumed by the combined reconciler. */
export interface SuiteTrackingFinding {
  readonly label: string;
  readonly state: "pass" | "fail" | "unknown";
  readonly complete: boolean;
  readonly runUrl: string;
}

/** Existing condition tracker returned by a destination adapter. */
export interface ExistingConditionTracker {
  readonly id: string;
  readonly marker: string;
  readonly pinned: boolean;
}

/** Validated public tracking settings. */
export interface NightlyTrackingSettings {
  readonly destination: TrackingDestination;
  readonly provider: Readonly<Record<string, unknown>> | null;
}

/** A destination-neutral reconciliation plan. */
export interface CombinedTrackingPlan {
  readonly action: "create" | "refresh" | "close" | "none";
  readonly marker: string;
  readonly trackerId: string | null;
  readonly title: string | null;
  readonly body: string | null;
  readonly pin: boolean | null;
  readonly reason: string;
}

/** Input supplied to a destination adapter when a condition is red. */
export interface ConditionTrackerDraft {
  readonly marker: string;
  readonly title: string;
  readonly body: string;
}

/** Provider operations used by the common state machine. */
export interface TrackingProviderAdapter {
  list(marker: string): Promise<readonly ExistingConditionTracker[]>;
  create(draft: ConditionTrackerDraft): Promise<ExistingConditionTracker>;
  refresh(
    id: string,
    draft: ConditionTrackerDraft
  ): Promise<ExistingConditionTracker>;
  close(id: string): Promise<void>;
  pin?(id: string): Promise<void>;
  unpin?(id: string): Promise<void>;
}

/** Result of one combined reconciliation. */
export interface CombinedTrackingResult {
  readonly destination: TrackingDestination;
  readonly action: CombinedTrackingPlan["action"] | "skipped";
  readonly trackerId: string | null;
  readonly reason: string;
}

/** One bounded provider request issued by the shipped action module. */
export interface ProviderTransportRequest {
  readonly operation:
    | "list"
    | "create"
    | "refresh"
    | "pin"
    | "unpin"
    | "close"
    | "readback";
  readonly url: string;
  readonly options?: Readonly<Record<string, unknown>>;
}

/** Injectable JSON transport used to exercise the shipped provider boundary. */
export type ProviderTransport = (
  request: ProviderTransportRequest
) => Promise<unknown>;

/** Public execution seam of the installed provider-action script. */
export interface NightlyProviderActionModule {
  runProviderAction(input: {
    readonly config: unknown;
    readonly findings: readonly SuiteTrackingFinding[];
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly request: ProviderTransport;
  }): Promise<CombinedTrackingResult>;
}

/** Public exports of the provider-neutral authority helper. */
export interface NightlyProviderSupportModule {
  readback(
    destination: string,
    list: (
      operation?: "list" | "readback"
    ) => Promise<readonly ExistingConditionTracker[]>,
    id: string,
    present: boolean
  ): Promise<ExistingConditionTracker | null>;
}

/** Executable handoff from the common planner to one provider workflow. */
export interface ProviderDispatch {
  readonly destination: Exclude<TrackingDestination, "none">;
  readonly workflow: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];
}

/** Public exports the production reconciler must provide. */
export interface NightlyTrackingModule {
  resolveNightlyTrackingConfig(config: unknown): NightlyTrackingSettings;
  planCombinedTracking(
    findings: readonly SuiteTrackingFinding[],
    trackers: readonly ExistingConditionTracker[]
  ): CombinedTrackingPlan;
  buildProviderDispatch(
    settings: NightlyTrackingSettings,
    plan: CombinedTrackingPlan
  ): ProviderDispatch;
  reconcileCombinedTracking(input: {
    readonly config: unknown;
    readonly findings: readonly SuiteTrackingFinding[];
    readonly adapters: Partial<
      Record<Exclude<TrackingDestination, "none">, TrackingProviderAdapter>
    >;
  }): Promise<CombinedTrackingResult>;
}

/** Canonical copy-overwrite implementation path. */
export const TRACKING_MODULE_REL =
  "typescript/copy-overwrite/scripts/reconcile-nightly-e2e-tracking.mjs";

/** Canonical combined condition marker. */
export const CONDITION_MARKER = "<!-- lisa_nightly_e2e_condition:v1 -->";

/**
 * Loads the real canonical tracking module with an isolated module identity.
 *
 * @param repoRoot - Absolute Lisa repository root
 * @returns Production module exports
 */
export async function loadTrackingModule(
  repoRoot: string
): Promise<NightlyTrackingModule> {
  const url = pathToFileURL(path.join(repoRoot, TRACKING_MODULE_REL));
  url.searchParams.set("red", randomUUID());
  return (await import(url.href)) as NightlyTrackingModule;
}

/**
 * Loads the installed provider action without running its executable main.
 *
 * @param repoRoot - Absolute Lisa repository root
 * @returns Provider action exports
 */
export async function loadProviderActionModule(
  repoRoot: string
): Promise<NightlyProviderActionModule> {
  const relative =
    "typescript/copy-overwrite/scripts/nightly-e2e-provider-action.mjs";
  const url = pathToFileURL(path.join(repoRoot, relative));
  url.searchParams.set("red", randomUUID());
  return (await import(url.href)) as NightlyProviderActionModule;
}

/**
 * Loads the provider-neutral authority helper with an isolated identity.
 *
 * @param repoRoot - Absolute Lisa repository root
 * @returns Provider support exports
 */
export async function loadProviderSupportModule(
  repoRoot: string
): Promise<NightlyProviderSupportModule> {
  const relative =
    "typescript/copy-overwrite/scripts/nightly-e2e-provider-support.mjs";
  const url = pathToFileURL(path.join(repoRoot, relative));
  url.searchParams.set("red", randomUUID());
  return (await import(url.href)) as NightlyProviderSupportModule;
}

/**
 * Creates one complete decisive suite observation.
 *
 * @param label - Human-readable suite name
 * @param state - Decisive suite state
 * @returns Frozen observation
 */
export function finding(
  label: string,
  state: "pass" | "fail"
): SuiteTrackingFinding {
  return Object.freeze({
    label,
    state,
    complete: true,
    runUrl: `https://github.test/runs/${encodeURIComponent(label)}-${state}`,
  });
}

/**
 * Creates an existing combined condition tracker.
 *
 * @param id - Provider-native tracker identity
 * @param pinned - Whether the tracker is currently pinned
 * @returns Frozen tracker record
 */
export function existingTracker(
  id = "tracker-1",
  pinned = true
): ExistingConditionTracker {
  return Object.freeze({ id, marker: CONDITION_MARKER, pinned });
}
