/**
 * Shared identifiers and limits for the dependencies/supply-chain readiness
 * producer.
 * @module cli/doctor-readiness-supply-chain-constants
 */

/** The dependencies/supply-chain readiness dimension id (readiness-rubric). */
export const DEPENDENCIES_SUPPLY_CHAIN_DIMENSION_ID =
  "dependencies-supply-chain";

/** The ship blocker for an owned surface with no confidence model. */
export const SUPPLY_CHAIN_BLOCKER_ID = "B5";

/** Most evidence lines carried into a single finding, to keep it readable. */
export const MAX_EVIDENCE_LINES = 12;
