/** Stable, bounded deterministic health finding helpers. */
import type { HealthFinding, HealthStatus } from "./contract.js";

/**
 * Create one deterministic finding.
 * @param check - Stable check identifier
 * @param status - Outcome of the check
 * @param reason - Bounded human-readable explanation
 * @returns The finding, tagged with the deterministic layer
 */
export function deterministicFinding(
  check: string,
  status: HealthStatus,
  reason: string
): HealthFinding {
  return { check, layer: "deterministic", status, reason };
}

/**
 * Format a bounded sorted identifier list without exposing values.
 * @param label - Stable human prefix
 * @param names - Safe relative paths, keys, or public contract names
 * @returns Bounded reason
 */
export function namedReason(label: string, names: readonly string[]): string {
  const sorted = [...new Set(names)].sort((left, right) =>
    left.localeCompare(right)
  );
  const shown = sorted.slice(0, 12);
  const suffix =
    sorted.length > shown.length
      ? ` (+${sorted.length - shown.length} more)`
      : "";
  return `${label}: ${shown.join(", ")}${suffix}`;
}
