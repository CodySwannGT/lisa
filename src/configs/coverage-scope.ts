/**
 * Which population of tests a coverage run is measuring.
 *
 * `test:cov` and `test:cov:unit` run the same instrumentation over the same
 * source, and differ only in which tests are DISCOVERED — the unit script
 * excludes the integration tree. Nothing excludes the source that those
 * integration tests were the only cover for, so the denominator is unchanged
 * while the numerator shrinks, and the two runs report different percentages
 * about identical code.
 *
 * Both were then checked against one `global` threshold block. The defect that
 * causes is not a wrong number, it is a missing lever: a project whose unit run
 * legitimately cannot reach the full-suite floor could only lower the one block,
 * which lowered the floor its CI `test:cov` run answers to as well. Making a
 * push stop failing on unchanged code meant weakening the gate everywhere.
 *
 * This is the marker that lets the threshold factories tell the two runs apart.
 * It is set by the pinned `test:cov:unit` script, and it is what the push hook
 * looks for before selecting that script — a unit run with no marker has no
 * floor of its own, so the honest command for that project is still `test:cov`,
 * whose floor was written for what it actually runs.
 * @module configs/coverage-scope
 */

/** The variable the unit-scoped coverage script sets. */
export const COVERAGE_SCOPE_ENV = "LISA_COVERAGE_SCOPE";

/** The one scope value that changes which threshold block is enforced. */
export const UNIT_COVERAGE_SCOPE = "unit";

/**
 * Whether this process is a unit-scoped coverage run.
 *
 * Exact match on the one recognised value, never a truthiness test. An
 * unrecognised scope must inherit the full-suite floor rather than pick up a
 * narrower one — the failure direction that matters here is a run measured
 * against a floor lower than the one written for it, and a truthiness test
 * hands that to every typo.
 * @returns True when the unit scope is in force.
 */
export const isUnitCoverageScope = (): boolean =>
  // eslint-disable-next-line no-restricted-syntax -- a test-runner config factory loads before any config service and the scope arrives only as an env var
  process.env[COVERAGE_SCOPE_ENV]?.trim() === UNIT_COVERAGE_SCOPE;
