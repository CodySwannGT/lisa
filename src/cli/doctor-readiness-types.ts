/**
 * The shared readiness record vocabulary (PRD #1739, #1896).
 *
 * Every readiness producer — the journey wiring, the delivery/authority
 * producers, and the collector's own reasoned-SKIP fallback — returns the same
 * per-dimension record. Defining that shape once here is what keeps the
 * collector able to dispatch to any producer by dimension id: a second, drifting
 * copy of this type would make one producer's record silently incompatible with
 * the report the collector persists.
 * @module cli/doctor-readiness-types
 */

/** Per-dimension status, mirroring the shared doctor `DOCTOR_STATUSES`. */
export type ReadinessStatus = "PASS" | "WARN" | "FAIL" | "SKIP";

/** A persisted per-dimension record inside `.lisa/readiness.json`. */
export interface ReadinessDimensionRecord {
  readonly id: string;
  readonly status: ReadinessStatus;
  /**
   * Findings are intentionally untyped: they are persisted as JSON and read
   * back by the blocker engine, which coerces them itself. Producers may attach
   * extra rubric fields without a schema bump.
   */
  readonly findings: readonly unknown[];
}
