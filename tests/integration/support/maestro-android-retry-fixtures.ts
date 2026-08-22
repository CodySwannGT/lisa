/**
 * Fixtures and ledger vocabulary for the Android per-flow retry tests.
 *
 * The fixture project (flow files, a stubbed `flow_runner`, a seed JUnit
 * report) and the readings taken off the ledger the workflow writes. Kept apart
 * from the harness that EXECUTES workflow steps so neither file has to be read
 * to understand the other.
 *
 * The suite is 39 flows because that is the measured arm: its steady state was
 * one lost flow of thirty-nine, and the leg that set the rate budget lost four
 * of the same thirty-nine.
 *
 * @module tests/integration/support/maestro-android-retry-fixtures
 */

import * as fs from "fs-extra";
import * as path from "node:path";

/** The per-flow retry ledger the driver writes and the gate reads. */
export const LEDGER_FILE = "maestro-android-retries.txt";

/** How many flows the fixture suite executes, matching the measured arm. */
export const SUITE_SIZE = 39;

/** Flow basenames the fixture project contains. */
export const FLOW_NAMES = Array.from(
  { length: SUITE_SIZE },
  (_unused, index) => `flow-${String(index).padStart(2, "0")}`
);

/** Which flows fail, which are tagged, and how the report is emitted. */
export interface FixtureShape {
  failing: readonly string[];
  tagged: readonly string[];
  reverseOrder: boolean;
  repeatFailing: boolean;
}

/**
 * Byte order, matching the `LC_ALL=C sort` the workflow uses. Deliberately not
 * `localeCompare`, which would assert an order the artifact does not have.
 * @param left - First row
 * @param right - Second row
 * @returns Negative, zero, or positive per the usual sort contract
 */
export const byCodePoint = (left: string, right: string): number => {
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

/**
 * A JUnit report in Maestro's shape.
 *
 * Passing cases are SELF-CLOSING and failing ones are not, the exact pairing
 * that defeats a greedy `<testcase[^>]*>` match: it swallows the self-closing
 * slash and reports the passing flow's name against the next failing flow's
 * message. The failure body is EMPTY, which is what the measured
 * `DeviceServerDiedException` loss actually wrote, and it carries a decoy
 * `file="…"` attribute inside the element — the first proves retry may never be
 * gated on an error string, the second proves the flow path is read from the
 * open TAG rather than from anywhere in the record.
 * @param failing - Basenames of the flows that failed
 * @param reverseOrder - Emit failing cases last rather than first
 * @param repeatFailing - Emit each failing case twice, as two suites can
 * @returns JUnit XML
 */
export const buildReport = (
  failing: readonly string[],
  reverseOrder = false,
  repeatFailing = false
): string => {
  const ordered = reverseOrder ? [...FLOW_NAMES].reverse() : FLOW_NAMES;
  const cases = ordered.flatMap(name => {
    if (!failing.includes(name)) {
      return [
        `    <testcase name="${name}" file=".maestro/flows/${name}.yaml" status="SUCCESS" time="10"/>`,
      ];
    }
    const failed =
      `    <testcase name="${name}" file=".maestro/flows/${name}.yaml" status="ERROR" time="20">\n` +
      `      <failure file="debug/decoy.yaml"></failure>\n    </testcase>`;
    return repeatFailing ? [failed, failed] : [failed];
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<testsuites>",
    `  <testsuite name="suite" tests="${SUITE_SIZE}" failures="${failing.length}">`,
    ...cases,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
};

/** A flow file carrying the retry tag in block form. */
const TAGGED_FLOW =
  "appId: ${MAESTRO_APP_ID}\ntags:\n  - retryable\n---\n- launchApp\n";

/** A flow file carrying no tags at all. */
const PLAIN_FLOW = "appId: ${MAESTRO_APP_ID}\n---\n- launchApp\n";

/** The stubbed `flow_runner`: seeds the first report, then obeys `STUB_MODE`. */
const STUB_RUNNER = [
  "#!/usr/bin/env bash",
  'n=$(( $(cat "$STUB_ATTEMPTS") + 1 ))',
  'echo "$n" > "$STUB_ATTEMPTS"',
  'out="$1"; shift 2',
  'target="${@: -1}"',
  'if [ "$n" -eq 1 ]; then',
  '  cp "$STUB_SEED" "$out"',
  '  if [ "$STUB_SUITE_PASSES" = "true" ]; then exit 0; fi',
  '  echo "[FAILED] a flow reported a failure"',
  "  exit 1",
  "fi",
  'if [ "$STUB_MODE" = "retry-fails" ]; then',
  '  printf \'<testsuites><testsuite tests="1" failures="1"><testcase name="x" file="%s" status="ERROR"><failure></failure></testcase></testsuite></testsuites>\' "$target" > "$out"',
  "  exit 1",
  "fi",
  'if [ "$STUB_MODE" = "retry-executes-nothing" ]; then',
  '  printf \'<testsuites><testsuite tests="0" failures="0"></testsuite></testsuites>\' > "$out"',
  "  exit 0",
  "fi",
  'printf \'<testsuites><testsuite tests="1" failures="0"><testcase name="x" file="%s" status="SUCCESS"/></testsuite></testsuites>\' "$target" > "$out"',
  "exit 0",
].join("\n");

/**
 * Builds the fixture project: flow files, the stub runner, the seed report.
 * @param dir - Fixture directory
 * @param shape - Which flows fail, which are tagged, how the report is emitted
 * @returns Paths of the stub runner, the attempt counter, and the seed report
 */
export const seedFixture = async (
  dir: string,
  shape: FixtureShape
): Promise<{ stub: string; counter: string; seed: string }> => {
  const flows = path.join(dir, ".maestro", "flows");
  await fs.ensureDir(flows);
  await Promise.all(
    FLOW_NAMES.map(name =>
      fs.writeFile(
        path.join(flows, `${name}.yaml`),
        shape.tagged.includes(name) ? TAGGED_FLOW : PLAIN_FLOW
      )
    )
  );
  const counter = path.join(dir, "attempts");
  await fs.writeFile(counter, "0");
  const seed = path.join(dir, "seed-report.xml");
  await fs.writeFile(
    seed,
    buildReport(shape.failing, shape.reverseOrder, shape.repeatFailing)
  );
  const stub = path.join(dir, "flow-runner.sh");
  await fs.writeFile(stub, STUB_RUNNER, { mode: 0o755 });
  return { stub, counter, seed };
};

/**
 * Reads one `key=value` reading out of a ledger.
 * @param ledger - Ledger contents
 * @param key - Reading to fetch
 * @returns The value, or undefined when the key is absent
 */
export const reading = (
  ledger: string | null,
  key: string
): string | undefined =>
  (ledger ?? "")
    .split("\n")
    .find(line => line.startsWith(`${key}=`))
    ?.slice(key.length + 1);

/**
 * The ledger's per-flow rows as an ORDER-INSENSITIVE set. Maestro's execution
 * order is not a stable key, and a caller reordering its own list must not flip
 * an assertion.
 * @param ledger - Ledger contents
 * @returns Sorted `flow|attempts|outcome` rows
 */
export const rows = (ledger: string | null): string[] =>
  (ledger ?? "")
    .split("\n")
    .filter(line => line.startsWith("flow|"))
    .sort(byCodePoint);

/**
 * The ledger's per-flow rows IN FILE ORDER.
 *
 * The set comparison above is the right default, but the ledger also has to be
 * written in a canonical order — otherwise two runs that saw the same flows
 * produce different bytes and the night-to-night diff is noise. Only this
 * accessor can see that property, so only it may be used to assert it.
 * @param ledger - Ledger contents
 * @returns `flow|attempts|outcome` rows as written
 */
export const rowsInFileOrder = (ledger: string | null): string[] =>
  (ledger ?? "").split("\n").filter(line => line.startsWith("flow|"));

/**
 * A ledger with the given readings over a healthy default.
 * @param overrides - Readings to replace
 * @param flowRows - Per-flow rows to append
 * @returns Ledger contents
 */
export const ledgerOf = (
  overrides: Record<string, string> = {},
  flowRows: readonly string[] = []
): string => {
  const base: Record<string, string> = {
    platform: "android",
    retry_enabled: "true",
    retry_tag: "retryable",
    retry_attempts_allowed: "1",
    retry_rate_threshold_percent: "10",
    executed: String(SUITE_SIZE),
    failed_first_attempt: "1",
    retried: "1",
    recovered: "1",
    unrecovered: "0",
    not_eligible: "0",
    retry_rate_percent: "2",
    rate_breach: "false",
    ...overrides,
  };
  return [
    ...Object.entries(base).map(([key, value]) => `${key}=${value}`),
    ...flowRows,
  ].join("\n");
};
