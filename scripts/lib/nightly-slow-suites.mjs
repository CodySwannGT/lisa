/**
 * The test files that run only on the nightly lane (CodySwannGT/lisa#4896).
 *
 * A 2026-11-14 audit set each test file's CI runtime against 71 days of CI
 * catch history. These six cost about 380 s per run between them and caught
 * nothing confirmed in that window, so they leave every pull-request and push
 * path and run once a night in `.github/workflows/nightly-slow-tests.yml`
 * instead. Nothing about what they assert changes; only when they run does.
 *
 * ONE list, read by everything that decides a file set:
 *
 * - `vitest.config.local.ts` excludes them from every run, so every package
 *   script (`test`, `test:unit`, `test:cov:unit`, `test:cov:unit:push`,
 *   `test:integration`, `test:integration:push`) and every CI shard leg drops
 *   them without a flag of its own to keep in step.
 * - `scripts/plan-integration-shards.mjs` leaves them out of the plan, so a
 *   leg is not weighed for files it will not run.
 * - The nightly workflow sets {@link NIGHTLY_SLOW_SUITES_ENV} and names exactly
 *   these files; `tests/unit/config/nightly-slow-suites.test.ts` pins that the
 *   names match this list.
 *
 * Paths are exact repository-relative paths, never any-directory basename globs:
 * `history-secret-private-report.test.ts` also names a cheap UNIT suite under
 * `tests/unit/scripts/`, which must keep running on every pull request.
 *
 * To run one by hand, set the variable: `LISA_NIGHTLY_SLOW_SUITES=run bun run
 * lisa-test-run -- --adapter vitest -- vitest run <file>`. Without it Vitest
 * answers "No test files found", because the file is excluded.
 * @module nightly-slow-suites
 */

/** Repository-relative paths of the nightly-only suites. */
export const NIGHTLY_SLOW_SUITES = Object.freeze([
  "tests/unit/config/test-run-supervision-wiring.test.ts",
  "tests/integration/mutation-gate-bite.test.ts",
  "tests/integration/history-secret-evidence.test.ts",
  "tests/integration/history-secret-private-report.test.ts",
  "tests/integration/vitest-nodenext-local-config.test.ts",
  "tests/integration/staged-module-formatting.test.ts",
]);

/** The variable that lifts the exclusion, set by the nightly lane. */
export const NIGHTLY_SLOW_SUITES_ENV = "LISA_NIGHTLY_SLOW_SUITES";

/** The one value of {@link NIGHTLY_SLOW_SUITES_ENV} that lifts it. */
export const NIGHTLY_SLOW_SUITES_RUN = "run";

/**
 * The Vitest `exclude` entries for this run: the nightly list, unless the
 * environment asks for those suites to run.
 * @param {Readonly<Record<string, string | undefined>>} env - Environment
 * @returns {string[]} Exclusion patterns (exact paths)
 */
export function nightlySlowSuiteExclusions(env) {
  return env[NIGHTLY_SLOW_SUITES_ENV] === NIGHTLY_SLOW_SUITES_RUN
    ? []
    : [...NIGHTLY_SLOW_SUITES];
}
