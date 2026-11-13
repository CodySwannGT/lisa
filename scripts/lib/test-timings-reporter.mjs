/**
 * Where Lisa's own CI writes per-file test timings (CodySwannGT/lisa#4592).
 *
 * Lisa-only: `vitest.config.local.ts` appends Vitest's built-in `json`
 * reporter beside whatever reporters a run already resolved, and
 * `scripts/test-timing-report.mjs` reads the files it writes. Both sides take
 * the scope and the directory from here so they cannot disagree.
 *
 * The reporter is appended in a `configureVitest` hook rather than declared in
 * `reporters`, because a declared list is replaced outright by a CLI
 * `--reporter`, and every unit-test shard leg runs with `--reporter=blob`
 * (`src/cli/lisa-test-run-shard.ts`). Appending after resolution keeps the
 * blob a shard leg needs, the default and `github-actions` reporters a normal
 * run gets, and adds the timings file to all of them.
 * @module test-timings-reporter
 */
import * as path from "node:path";

/** Directory, relative to the Vitest root, the timing files land in. */
export const TEST_TIMINGS_DIRECTORY = "tmp/test-timings";

/** Every scope a timing file can carry; the report requires each one. */
export const TEST_TIMINGS_SCOPES = Object.freeze(["unit", "integration"]);

/**
 * Whether `CI` is set to something that means "yes".
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @returns {boolean} True on a CI runner
 */
function onCi(env) {
  const value = env["CI"];
  return (
    value !== undefined && value !== "" && value !== "0" && value !== "false"
  );
}

/**
 * The timing scope of this run, or `undefined` when it records none.
 *
 * Only on CI, and never in a Vitest process a test spawned (a worker exports
 * `VITEST_WORKER_ID` to its children): a nested run would otherwise write over
 * the outer run's file with a fixture's results.
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @returns {string | undefined} `unit`, `integration`, or undefined
 */
export function testTimingsScope(env) {
  if (!onCi(env) || env["VITEST_WORKER_ID"] !== undefined) return undefined;
  return declaredTestScope(env);
}

/**
 * The scope a run declares, whether or not anything records it:
 * `LISA_TEST_TIMINGS_SCOPE` when set, else `unit` for the unit coverage
 * scope. The test access map (#4593) keys its files on the same scope.
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @returns {string | undefined} `unit`, `integration`, or undefined
 */
export function declaredTestScope(env) {
  const declared = env["LISA_TEST_TIMINGS_SCOPE"];
  if (declared !== undefined && declared !== "")
    return TEST_TIMINGS_SCOPES.includes(declared) ? declared : undefined;
  return env["LISA_COVERAGE_SCOPE"] === "unit" ? "unit" : undefined;
}

/**
 * The `json` reporter entry this run adds, or `undefined` when it adds none.
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @param {string} root - Vitest root directory
 * @returns {readonly ["json", { readonly outputFile: string }] | undefined} Reporter entry
 */
export function testTimingsReporter(env, root) {
  const scope = testTimingsScope(env);
  if (scope === undefined) return undefined;
  return [
    "json",
    { outputFile: path.join(root, TEST_TIMINGS_DIRECTORY, `${scope}.json`) },
  ];
}

/**
 * The resolved reporters with the timing reporter appended once. Idempotent,
 * because the hook runs once per Vitest project and every project shares one
 * resolved list.
 * @param {ReadonlyArray<unknown>} reporters - Resolved reporters
 * @param {Readonly<Record<string, string | undefined>>} env - Process environment
 * @param {string} root - Vitest root directory
 * @returns {ReadonlyArray<unknown>} Reporters, with the timing reporter at most once
 */
export function withTestTimingsReporter(reporters, env, root) {
  const reporter = testTimingsReporter(env, root);
  if (reporter === undefined) return reporters;
  const present = reporters.some(
    entry =>
      Array.isArray(entry) &&
      entry[0] === "json" &&
      entry[1]?.outputFile === reporter[1].outputFile
  );
  return present ? reporters : [...reporters, reporter];
}
