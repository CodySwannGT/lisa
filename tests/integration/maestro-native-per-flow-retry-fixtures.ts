/**
 * Shared fixtures for the executed maestro-native-e2e per-flow retry suites:
 * the workflow path and shapes, ledger constants, and the accessor that pulls
 * a named iOS step's `run:` script verbatim out of the YAML.
 * @module tests/integration/maestro-native-per-flow-retry-fixtures
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/**
 * Read one keyed entry, failing the test when it is absent.
 * @param record Entries by name.
 * @param name Name to read.
 * @returns The entry under that name.
 */
const key = <T>(record: Readonly<Record<string, T>>, name: string): T => {
  const entry = record[name];
  if (entry === undefined) {
    throw new Error(`expected an entry named ${name}`);
  }
  return entry;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
export const BASH = "/bin/bash";

/** The per-flow retry ledger the suite step writes and the gate reads. */
export const LEDGER_FILE = "maestro-ios-retries.txt";

/**
 * Byte order, matching the `LC_ALL=C sort` the workflow uses.
 *
 * Deliberately NOT `localeCompare`: the ledger is sorted by a C-locale sort
 * on the runner, and a comparator that disagreed with it would make this
 * suite assert an order the artifact does not have.
 * @param left - First row
 * @param right - Second row
 * @returns Negative, zero, or positive per the usual sort contract
 */
export const byCodePoint = (left: string, right: string): number => {
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

/** How many flows the fixture suite executes, matching the measured arm. */
export const SUITE_SIZE = 41;

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  env?: Record<string, unknown>;
}

/** Root shape of the parsed reusable workflow. */
export interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, { default?: unknown; type?: string }>;
    };
  };
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** The ledger row a flow-07 first-attempt loss produces once it recovers. */
export const FLOW_07_RECOVERED = "flow|.maestro/flows/flow-07.yaml|2|recovered";

/** The same, for flow-01. */
export const FLOW_01_RECOVERED = "flow|.maestro/flows/flow-01.yaml|2|recovered";

/** Outcome of executing a workflow step against a fixture. */
export interface StepResult {
  status: number;
  attempts: number;
  output: string;
  ledger: string | null;
}

/** How the stubbed runner behaves once the suite has failed. */
type RetryMode = "retry-passes" | "retry-fails" | "retry-executes-nothing";

/** Knobs for one suite-step execution. */
export interface RunOptions {
  mode?: RetryMode;
  /** Flow basenames the fixture report marks as failed. */
  failing?: readonly string[];
  /** Flow basenames whose file carries the retry tag. */
  tagged?: readonly string[];
  /** Value of the `ios_flow_retry_tag` input. */
  tag?: string;
  attempts?: string;
  ratePercent?: string;
  /** Emit the failing test cases last rather than first. */
  reverseOrder?: boolean;
  /** Emit every failing test case twice. */
  repeatFailing?: boolean;
  /** Make the first suite attempt succeed. */
  suitePasses?: boolean;
}

/** Flow basenames the fixture project contains. */
export const FLOW_NAMES = Array.from(
  { length: SUITE_SIZE },
  (_unused, index) => `flow-${String(index).padStart(2, "0")}`
);

/**
 * A JUnit report in Maestro's shape.
 *
 * The passing cases are SELF-CLOSING and the failing ones are not, which is the
 * exact pairing that defeats a greedy `<testcase[^>]*>` match: it swallows the
 * self-closing slash and reports the passing flow's name against the next
 * failing flow's message.
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
  const rows = ordered.flatMap(name => {
    if (!failing.includes(name)) {
      return [
        `    <testcase name="${name}" file=".maestro/flows/${name}.yaml" status="SUCCESS" time="10"/>`,
      ];
    }
    // The failure BODY carries a decoy `file="…"` and is otherwise the exact
    // text one of the measured faults produced: `Unknown error`, with the real
    // cause only in the debug bundle. Both halves are deliberate. The decoy
    // proves the flow path is read from the open TAG rather than from anywhere
    // in the record; `Unknown error` is why this retry may never be gated on
    // matching an error string.
    const failed =
      `    <testcase name="${name}" file=".maestro/flows/${name}.yaml" status="ERROR" time="20">\n` +
      `      <failure>Unknown error (see file="debug/decoy.yaml")</failure>\n    </testcase>`;
    return repeatFailing ? [failed, failed] : [failed];
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<testsuites>",
    `  <testsuite name="suite" tests="${SUITE_SIZE}" failures="${failing.length}">`,
    ...rows,
    "  </testsuite>",
    "</testsuites>",
    "",
  ].join("\n");
};

/** A flow file carrying the retry tag in block form. */
export const TAGGED_FLOW =
  "appId: ${MAESTRO_APP_ID}\ntags:\n  - retryable\n---\n- launchApp\n";

/** A flow file carrying no tags at all. */
export const PLAIN_FLOW = "appId: ${MAESTRO_APP_ID}\n---\n- launchApp\n";

/**
 * Load and parse the reusable maestro-native-e2e workflow.
 * @returns The parsed workflow
 */
export const loadWorkflow = async (): Promise<ReusableWorkflow> =>
  yaml.load(await fs.readFile(REUSABLE_YML, "utf-8")) as ReusableWorkflow;

/**
 * The verbatim `run:` text of a named iOS step — never a copy of it.
 * @param workflow - The parsed reusable workflow
 * @param namePart - Substring of the step's `name:`
 * @returns The step's shell script exactly as CI will run it
 */
export const iosStepRun = (
  workflow: ReusableWorkflow,
  namePart: string
): string => {
  const step = (key(workflow.jobs, "ios").steps ?? []).find(candidate =>
    candidate.name?.includes(namePart)
  );
  if (!step?.run) throw new Error(`no iOS step matching "${namePart}"`);
  // No `${{ }}` may survive into the script: an expansion is substituted into
  // the script TEXT before bash parses it, and executing the step verbatim is
  // only meaningful if nothing had to be rewritten to make it runnable.
  expect(step.run).not.toContain("${{");
  return step.run;
};
