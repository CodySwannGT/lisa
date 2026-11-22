/**
 * The suites that run the genuine pinned history scanner (#4618).
 *
 * `vitest.config.local.ts` puts them in the `history-scanner` project, whose
 * global setup downloads and verifies the pinned scanner once per Vitest
 * invocation that selects one of them. The integration shard planner
 * (`scripts/plan-integration-shards.mjs`, #4599) keeps them in ONE leg, so a
 * sharded run downloads the scanner at most once. One list, read by both, so a
 * suite added to the project cannot be missed by the planner.
 * @module history-scanner-suites
 */

/** Repository-relative paths, in no meaningful order. */
export const HISTORY_SCANNER_SUITES = Object.freeze([
  "tests/integration/history-secret-evidence.test.ts",
  "tests/integration/history-secret-private-report.test.ts",
  "tests/integration/history-secret-scanner-path.test.ts",
  "tests/integration/history-secret-scanner-preparation.test.ts",
]);
