/**
 * Child-graph fixtures for the rollup blocker classification suite (#3045).
 *
 * Kept beside the suite rather than inline so the assertions stay readable and
 * the lifecycle label strings have exactly one definition.
 * @module tests/unit/strategies/support/rollup-blocker-fixtures
 */

/** GitHub's held lifecycle label. */
export const BLOCKED = "status:blocked";

/** GitHub's in-flight lifecycle label. */
export const IN_PROGRESS = "status:in-progress";

/** GitHub's terminal lifecycle label. */
export const DONE = "status:done";

/** The marker a person applies when the item's own criteria are the problem. */
export const SPEC_DEFECT_MARKER = "blocked:spec-defect";

/** The container every fixture below hangs from. */
export const EPIC = { ref: "#1495", type: "Epic" } as const;

/** A leaf held because its acceptance criteria name a thing that cannot exist. */
export const specDefectLeaf = {
  ref: "#1547",
  state: BLOCKED,
  labels: [BLOCKED, SPEC_DEFECT_MARKER],
} as const;

/** A leaf held on tracked work that will close without anyone here acting. */
export const hardBlockerLeaf = {
  ref: "#1601",
  state: BLOCKED,
  labels: [BLOCKED],
  blockedBy: [{ ref: "#1700", open: true }],
} as const;

/** A leaf held with nothing recorded to say which kind of hold it is. */
export const unclassifiedLeaf = {
  ref: "#1610",
  state: BLOCKED,
  labels: [BLOCKED],
} as const;

/** The negative control: ordinary work in flight, held by nothing. */
export const inProgressLeaf = {
  ref: "#1500",
  state: IN_PROGRESS,
  labels: [IN_PROGRESS],
} as const;

/** The intermediate Story that is held only because its own child is. */
export const transparentParent = {
  ref: "#1515",
  state: BLOCKED,
  labels: [BLOCKED],
  children: [specDefectLeaf],
} as const;
