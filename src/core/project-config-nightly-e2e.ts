/** Validation contract for configurable nightly-E2E condition tracking. */

/** Public destinations for the combined nightly-E2E condition tracker. */
export type NightlyE2ETrackingDestination =
  | "github"
  | "sentry"
  | "jira"
  | "linear"
  | "none";

/** Provider selection for combined nightly-E2E condition tracking. */
export interface NightlyE2ETrackingConfig {
  /** Existing project destination adapter, or `none` to disable tracking. */
  readonly destination: NightlyE2ETrackingDestination;
}

/** Nightly-E2E project behavior persisted across full applies. */
export interface NightlyE2EConfig {
  /** Optional combined condition tracking selection. */
  readonly tracking?: NightlyE2ETrackingConfig;
}

const DESTINATIONS: readonly NightlyE2ETrackingDestination[] = [
  "github",
  "sentry",
  "jira",
  "linear",
  "none",
];

/**
 * Validate the optional combined nightly-E2E tracking selector.
 * @param value - Untrusted nightly-E2E configuration
 * @param configPath - Config source shown in errors
 * @returns Valid nightly-E2E configuration or undefined
 */
export function validateNightlyE2EConfig(
  value: unknown,
  configPath: string
): NightlyE2EConfig | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid nightlyE2E in ${configPath}: expected object`);
  }
  const nightly = value as Record<string, unknown>;
  if (nightly.tracking === undefined) return {};
  if (
    nightly.tracking === null ||
    typeof nightly.tracking !== "object" ||
    Array.isArray(nightly.tracking)
  ) {
    throw new Error(
      `Invalid nightlyE2E.tracking in ${configPath}: expected object`
    );
  }
  const tracking = nightly.tracking as Record<string, unknown>;
  if (tracking.destination === undefined) {
    return { tracking: { destination: "none" } };
  }
  if (!DESTINATIONS.includes(tracking.destination as never)) {
    throw new Error(
      "Invalid nightlyE2E.tracking.destination in " +
        `${configPath}: expected github, sentry, jira, linear, none`
    );
  }
  return {
    tracking: {
      destination: tracking.destination as NightlyE2ETrackingDestination,
    },
  };
}
