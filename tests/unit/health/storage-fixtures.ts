/**
 * Shared fixtures for the Health result storage suites (`storage*.test.ts`).
 * Each suite owns its own isolated temporary project root.
 * @module tests/unit/health/storage-fixtures
 */

/** A completion timestamp strictly later than the default fixture result. */
export const NEWER_COMPLETED_AT = "2026-07-20T12:02:00.000Z";

/**
 * Build a valid deterministic Health v1 result whose runId derives from its
 * completion time, so distinct timestamps yield distinct run identities.
 * @param completedAt - Completion timestamp of the result
 * @returns Mutable valid Health result candidate
 */
export const validResult = (completedAt = "2026-07-20T12:01:00.000Z") => ({
  schemaVersion: 1,
  runId: `health-${completedAt.slice(11, 19).replaceAll(":", "")}`,
  mode: "deterministic",
  startedAt: "2026-07-20T12:00:00.000Z",
  completedAt,
  findings: [
    {
      check: "config.sync",
      layer: "deterministic",
      status: "pass",
      reason: "Configuration is synchronized.",
    },
  ],
  summary: { verdict: "in band", counts: { pass: 1, warn: 0, fail: 0 } },
});
