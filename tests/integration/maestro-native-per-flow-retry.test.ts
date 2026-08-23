/* eslint-disable max-lines -- one feature, and each guard is only proved by pairing a positive case with the negative case that dies when the guard is removed; splitting the pairs apart is what makes such a suite unreadable */
/**
 * Behavioral tests for per-flow retry, EXECUTED rather than asserted: both the
 * iOS suite step and the retry-budget gate are pulled verbatim out of the YAML
 * and run, with the suite stubbed through the workflow's own `flow_runner`
 * seam.
 *
 * ## What is broken today, which is what these tests pin
 *
 * The only retry this workflow has fires on the regex
 * `IOSDriverTimeoutException|iOS driver not ready in time` and re-runs the
 * WHOLE suite. Every per-flow environmental fault therefore reds a run with no
 * retry at all — measured twice on nights where one arm was fully green and the
 * other lost exactly one flow of forty-one, once to a CoreSimulator placeholder
 * the reinstall never promoted (`LaunchServicesDataMismatch`, then `NotFound
 * ("Application ... is unknown to FrontBoard")`) and once to a touch-UP event a
 * starved host never delivered. Neither has a code fix; neither matches that
 * regex.
 *
 * ## The bite controls
 *
 * Every guard here is proved in BOTH directions, because a test that cannot
 * fail is as broken as one that cannot pass:
 *
 *  - retry fires for a tagged flow AND does not fire for an untagged one;
 *  - the rate budget stands down at 9% AND fails the arm at 12%;
 *  - a re-run that passed is accepted AND a re-run that passed having executed
 *    ZERO flows is refused;
 *  - the gate passes a within-budget ledger AND fails a breached one.
 *
 * Delete the eligibility check and the untagged case starts retrying. Delete
 * the budget arithmetic and the 12% case goes green. Delete the zero-flow guard
 * on a re-run and a tag-filtered flow becomes a permanent false green.
 *
 * Sibling of maestro-native-driver-retry.test.ts, which pins the suite-level
 * retry this one deliberately leaves alone.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** The per-flow retry ledger the suite step writes and the gate reads. */
const LEDGER_FILE = "maestro-ios-retries.txt";

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
const byCodePoint = (left: string, right: string): number => {
  if (left < right) return -1;
  return left > right ? 1 : 0;
};

/** How many flows the fixture suite executes, matching the measured arm. */
const SUITE_SIZE = 41;

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  env?: Record<string, unknown>;
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, { default?: unknown; type?: string }>;
    };
  };
  jobs: Record<string, { steps?: WorkflowStep[] }>;
}

/** Outcome of executing a workflow step against a fixture. */
interface StepResult {
  status: number;
  attempts: number;
  output: string;
  ledger: string | null;
}

/** How the stubbed runner behaves once the suite has failed. */
type RetryMode = "retry-passes" | "retry-fails" | "retry-executes-nothing";

/** Knobs for one suite-step execution. */
interface RunOptions {
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
const FLOW_NAMES = Array.from(
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
const buildReport = (
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
const TAGGED_FLOW =
  "appId: ${MAESTRO_APP_ID}\ntags:\n  - retryable\n---\n- launchApp\n";

/** The ledger row a flow-07 first-attempt loss produces once it recovers. */
const FLOW_07_RECOVERED = "flow|.maestro/flows/flow-07.yaml|2|recovered";

/** The same, for flow-01. */
const FLOW_01_RECOVERED = "flow|.maestro/flows/flow-01.yaml|2|recovered";

/** A flow file carrying no tags at all. */
const PLAIN_FLOW = "appId: ${MAESTRO_APP_ID}\n---\n- launchApp\n";

describe("maestro-native-e2e per-flow retry (executed)", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  /**
   * The verbatim `run:` text of a named iOS step — never a copy of it.
   * @param namePart - Substring of the step's `name:`
   * @returns The step's shell script exactly as CI will run it
   */
  const iosStep = (namePart: string): string => {
    const step = (workflow.jobs.ios.steps ?? []).find(candidate =>
      candidate.name?.includes(namePart)
    );
    if (!step?.run) throw new Error(`no iOS step matching "${namePart}"`);
    // No `${{ }}` may survive into the script: an expansion is substituted into
    // the script TEXT before bash parses it, and executing the step verbatim is
    // only meaningful if nothing had to be rewritten to make it runnable.
    expect(step.run).not.toContain("${{");
    return step.run;
  };

  /**
   * Runs the real suite step against a fixture project.
   * @param options - Fixture and policy knobs
   * @returns Exit status, stub invocation count, output, and the ledger
   */
  const runSuiteStep = async (
    options: RunOptions = {}
  ): Promise<StepResult> => {
    const {
      mode = "retry-passes",
      failing = ["flow-07"],
      tagged = failing,
      tag = "retryable",
      attempts = "1",
      ratePercent = "10",
      reverseOrder = false,
      repeatFailing = false,
      suitePasses = false,
    } = options;

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-perflow-"));
    try {
      const flows = path.join(dir, ".maestro", "flows");
      await fs.ensureDir(flows);
      await Promise.all(
        FLOW_NAMES.map(name =>
          fs.writeFile(
            path.join(flows, `${name}.yaml`),
            tagged.includes(name) ? TAGGED_FLOW : PLAIN_FLOW
          )
        )
      );

      const bin = path.join(dir, "bin");
      await fs.ensureDir(bin);
      await fs.writeFile(
        path.join(bin, "xcrun"),
        "#!/usr/bin/env bash\nexit 0\n",
        {
          mode: 0o755,
        }
      );

      const counter = path.join(dir, "attempts");
      await fs.writeFile(counter, "0");
      const seedReport = path.join(dir, "seed-report.xml");
      await fs.writeFile(
        seedReport,
        buildReport(failing, reverseOrder, repeatFailing)
      );

      const stub = path.join(dir, "flow-runner.sh");
      await fs.writeFile(
        stub,
        [
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
          '  printf \'<testsuites><testsuite tests="1" failures="1"><testcase name="x" file="%s" status="ERROR"><failure>Unknown error</failure></testcase></testsuite></testsuites>\' "$target" > "$out"',
          "  exit 1",
          "fi",
          'if [ "$STUB_MODE" = "retry-executes-nothing" ]; then',
          '  printf \'<testsuites><testsuite tests="0" failures="0"></testsuite></testsuites>\' > "$out"',
          "  exit 0",
          "fi",
          'printf \'<testsuites><testsuite tests="1" failures="0"><testcase name="x" file="%s" status="SUCCESS"/></testsuite></testsuites>\' "$target" > "$out"',
          "exit 0",
        ].join("\n"),
        { mode: 0o755 }
      );

      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        FLOW_RUNNER: stub,
        FLOWS_DIR: ".maestro/flows",
        MAESTRO_E2E_ARGS: "",
        MAESTRO_DRIVER_STARTUP_TIMEOUT: "240000",
        IOS_SIM_UDID: "STUB-UDID",
        IOS_APP_PATH: dir,
        STUB_ATTEMPTS: counter,
        STUB_SEED: seedReport,
        STUB_MODE: mode,
        STUB_SUITE_PASSES: String(suitePasses),
        FLOW_RETRY_TAG: tag,
        FLOW_RETRY_ATTEMPTS: attempts,
        FLOW_RETRY_RATE_PERCENT: ratePercent,
      };

      let status = 0;
      let output = "";
      try {
        output = boundedExecFileSync({
          label: "the run-Maestro-flows step",
          command: BASH,
          args: [
            "-eo",
            "pipefail",
            "-c",
            iosStep("Run Maestro flows on simulator"),
          ],
          cwd: dir,
          env,
        });
      } catch (error) {
        const failure = error as { exitCode?: number | null; stdout?: string };
        status = failure.exitCode ?? -1;
        output = failure.stdout ?? "";
      }
      const ledgerPath = path.join(dir, LEDGER_FILE);
      return {
        status,
        attempts: Number((await fs.readFile(counter, "utf-8")).trim()),
        output,
        ledger: (await fs.pathExists(ledgerPath))
          ? await fs.readFile(ledgerPath, "utf-8")
          : null,
      };
    } finally {
      await fs.remove(dir);
    }
  };

  /**
   * Reads one `key=value` reading out of a ledger.
   * @param ledger - Ledger contents
   * @param key - Reading to fetch
   * @returns The value, or undefined when the key is absent
   */
  const reading = (ledger: string | null, key: string): string | undefined =>
    (ledger ?? "")
      .split("\n")
      .find(line => line.startsWith(`${key}=`))
      ?.slice(key.length + 1);

  /**
   * The ledger's per-flow rows as an ORDER-INSENSITIVE set.
   *
   * Compared as a set on purpose. Maestro's execution order is not a stable
   * key, and a caller that reorders its own list must not flip an assertion —
   * the failure mode a previous review caught in exactly this shape.
   * @param ledger - Ledger contents
   * @returns Sorted `flow|attempts|outcome` rows
   */
  const rows = (ledger: string | null): string[] =>
    (ledger ?? "")
      .split("\n")
      .filter(line => line.startsWith("flow|"))
      .sort(byCodePoint);

  /**
   * The ledger's per-flow rows IN FILE ORDER.
   *
   * The set comparison above is the right default, but the ledger also has to
   * be written in a canonical order — otherwise two runs that saw the same
   * flows produce different bytes and the night-to-night diff is noise. Only
   * this accessor can see that property, so only it may be used to assert it.
   * @param ledger - Ledger contents
   * @returns `flow|attempts|outcome` rows as written
   */
  const rowsInFileOrder = (ledger: string | null): string[] =>
    (ledger ?? "").split("\n").filter(line => line.startsWith("flow|"));

  describe("the eligibility guard (both directions)", () => {
    it("re-runs a TAGGED failed flow on its own and recovers the arm", async () => {
      const result = await runSuiteStep({ failing: ["flow-07"] });
      expect(result.attempts).toBe(2);
      expect(result.status).toBe(0);
      expect(rows(result.ledger)).toEqual([FLOW_07_RECOVERED]);
      expect(reading(result.ledger, "retried")).toBe("1");
      expect(reading(result.ledger, "recovered")).toBe("1");
      expect(result.output).toContain("Maestro flow retried (ios)");
      expect(result.output).toContain("green only after per-flow retry");
    });

    it("does NOT re-run an UNTAGGED failed flow", async () => {
      // The negative half. Delete the eligibility check in the workflow and
      // this starts failing with attempts === 2 — which is the only thing that
      // proves the guard is load-bearing rather than decorative. It also pins
      // the isolation contract: a flow that inherits session state or reads
      // another flow's fixtures would be re-run alone and fail falsely.
      const result = await runSuiteStep({ failing: ["flow-07"], tagged: [] });
      expect(result.attempts).toBe(1);
      expect(result.status).toBe(1);
      expect(rows(result.ledger)).toEqual([
        "flow|.maestro/flows/flow-07.yaml|1|not-eligible",
      ]);
      expect(result.output).toContain("not re-run");
    });

    it("re-runs nothing at all when no retry tag is configured", async () => {
      const result = await runSuiteStep({ failing: ["flow-07"], tag: "" });
      expect(result.attempts).toBe(1);
      expect(result.status).toBe(1);
      expect(reading(result.ledger, "retry_enabled")).toBe("false");
      expect(reading(result.ledger, "not_eligible")).toBe("1");
    });
  });

  describe("the rate budget (both directions)", () => {
    it("stands down and retries when the failure rate is inside the budget", async () => {
      // 4 of 41 == 9%, under the 10% default.
      const failing = ["flow-01", "flow-02", "flow-03", "flow-04"];
      const result = await runSuiteStep({ failing });
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(1 + failing.length);
      expect(reading(result.ledger, "rate_breach")).toBe("false");
      expect(reading(result.ledger, "retry_rate_percent")).toBe("9");
      expect(rows(result.ledger)).toEqual(
        failing
          .map(name => `flow|.maestro/flows/${name}.yaml|2|recovered`)
          .sort(byCodePoint)
      );
    });

    it("fails the arm and retries NOTHING when the rate is over the budget", async () => {
      // 5 of 41 == 12%, over the 10% default. Nothing is re-run: above the
      // budget the arm is degraded or the failures are real, and retrying
      // would spend the job's minutes hiding which.
      const failing = ["flow-01", "flow-02", "flow-03", "flow-04", "flow-05"];
      const result = await runSuiteStep({ failing });
      expect(result.status).toBe(1);
      expect(result.attempts).toBe(1);
      expect(reading(result.ledger, "rate_breach")).toBe("true");
      expect(reading(result.ledger, "retried")).toBe("0");
      expect(result.output).toContain("retry budget exceeded");
      expect(rows(result.ledger)).toEqual(
        failing
          .map(name => `flow|.maestro/flows/${name}.yaml|1|over-budget`)
          .sort(byCodePoint)
      );
    });
  });

  describe("what a retry is allowed to prove", () => {
    it("keeps the arm red when the isolated re-run fails again", async () => {
      const result = await runSuiteStep({ mode: "retry-fails" });
      expect(result.attempts).toBe(2);
      expect(result.status).toBe(1);
      expect(rows(result.ledger)).toEqual([
        "flow|.maestro/flows/flow-07.yaml|2|unrecovered",
      ]);
    });

    it("refuses a re-run that PASSED having executed zero flows", async () => {
      // A tag-filtered re-run exits 0 having run nothing. Trusting that status
      // would turn the flow into a permanent false green — the same fail-open
      // shape as a suite reporting success having tested nothing.
      const result = await runSuiteStep({ mode: "retry-executes-nothing" });
      expect(result.status).toBe(1);
      expect(rows(result.ledger)).toEqual([
        "flow|.maestro/flows/flow-07.yaml|2|vacuous",
      ]);
      expect(result.output).toContain("Retry executed nothing");
    });

    it("grants exactly the configured number of extra attempts", async () => {
      const result = await runSuiteStep({ mode: "retry-fails", attempts: "2" });
      expect(result.attempts).toBe(3);
      expect(rows(result.ledger)).toEqual([
        "flow|.maestro/flows/flow-07.yaml|3|unrecovered",
      ]);
    });
  });

  describe("visibility", () => {
    it("writes a ledger even for a suite that was green first time", async () => {
      // "0 retries" has to be a RECORDED READING, not an absence — otherwise
      // green-after-retry and green-first-time are indistinguishable from the
      // outside, which is the whole objection to retry.
      const result = await runSuiteStep({ suitePasses: true, failing: [] });
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(1);
      expect(reading(result.ledger, "retried")).toBe("0");
      expect(reading(result.ledger, "executed")).toBe(String(SUITE_SIZE));
      expect(rows(result.ledger)).toEqual([]);
    });

    it("produces a ledger that does not depend on the report's flow ORDER", async () => {
      const failing = ["flow-01", "flow-30"];
      const forward = await runSuiteStep({ failing });
      const reversed = await runSuiteStep({ failing, reverseOrder: true });
      // Byte-identical, not merely set-equal: the ledger is diffed between
      // nights, and a diff that lights up because Maestro reordered itself is
      // a diff nobody reads twice.
      expect(reversed.ledger).toBe(forward.ledger);
      expect(rows(forward.ledger)).toEqual([
        FLOW_01_RECOVERED,
        "flow|.maestro/flows/flow-30.yaml|2|recovered",
      ]);
    });

    it("writes rows ordered by FLOW, not by which loop produced them", async () => {
      // Ineligible flows are recorded by one loop and retried flows by
      // another, so the rows arrive grouped by KIND. Left that way, two nights
      // that saw the same flows in different roles produce different bytes.
      // flow-30 is written first and must appear second.
      const result = await runSuiteStep({
        failing: ["flow-01", "flow-30"],
        tagged: ["flow-01"],
      });
      expect(result.status).toBe(1);
      expect(rowsInFileOrder(result.ledger)).toEqual([
        FLOW_01_RECOVERED,
        "flow|.maestro/flows/flow-30.yaml|1|not-eligible",
      ]);
    });

    it("counts a flow the report names twice as ONE failed flow", async () => {
      // A flow can appear in more than one `<testsuite>`. Counted twice it
      // inflates the failure rate — the input that decides whether the arm is
      // failed outright — and it would be re-run twice for no reason.
      const result = await runSuiteStep({
        failing: ["flow-07"],
        repeatFailing: true,
      });
      expect(result.status).toBe(0);
      expect(reading(result.ledger, "failed_first_attempt")).toBe("1");
      expect(result.attempts).toBe(2);
      expect(rows(result.ledger)).toEqual([FLOW_07_RECOVERED]);
    });
  });

  describe("the retry-budget gate (both directions)", () => {
    /**
     * Executes the gate step against a hand-written ledger.
     * @param ledger - Ledger contents, or null to omit the file
     * @returns Exit status, step output, summary text, and step outputs
     */
    const gate = async (
      ledger: string | null
    ): Promise<{
      status: number;
      output: string;
      summary: string;
      outputs: string;
    }> => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-gate-"));
      try {
        if (ledger !== null) {
          await fs.writeFile(path.join(dir, LEDGER_FILE), ledger);
        }
        const outputs = path.join(dir, "outputs");
        const summary = path.join(dir, "summary");
        await fs.writeFile(outputs, "");
        await fs.writeFile(summary, "");
        let status = 0;
        let output = "";
        try {
          output = boundedExecFileSync({
            label: "the per-flow retry budget step",
            command: BASH,
            args: [
              "-eo",
              "pipefail",
              "-c",
              iosStep("Enforce the per-flow retry budget"),
            ],
            cwd: dir,
            env: {
              ...process.env,
              LEDGER: LEDGER_FILE,
              GITHUB_OUTPUT: outputs,
              GITHUB_STEP_SUMMARY: summary,
            },
          });
        } catch (error) {
          const failure = error as {
            exitCode?: number | null;
            stdout?: string;
          };
          status = failure.exitCode ?? -1;
          output = failure.stdout ?? "";
        }
        return {
          status,
          output,
          summary: await fs.readFile(summary, "utf-8"),
          outputs: await fs.readFile(outputs, "utf-8"),
        };
      } finally {
        await fs.remove(dir);
      }
    };

    /**
     * A ledger with the given readings over a healthy default.
     * @param overrides - Readings to replace
     * @param flowRows - Per-flow rows to append
     * @returns Ledger contents
     */
    const ledgerOf = (
      overrides: Record<string, string> = {},
      flowRows: readonly string[] = []
    ): string => {
      const base: Record<string, string> = {
        platform: "ios",
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

    it("passes a within-budget ledger, loudly", async () => {
      const result = await gate(ledgerOf({}, [FLOW_07_RECOVERED]));
      expect(result.status).toBe(0);
      expect(result.outputs).toContain("retried=1");
      expect(result.output).toContain("iOS flows needed a retry");
      expect(result.summary).toContain("per-flow retry ledger");
      expect(result.summary).toContain("flow-07.yaml");
      expect(result.summary).toContain("recovered");
    });

    it("fails a breached ledger", async () => {
      const result = await gate(
        ledgerOf({
          failed_first_attempt: "5",
          retried: "0",
          recovered: "0",
          retry_rate_percent: "12",
          rate_breach: "true",
          not_eligible: "5",
        })
      );
      expect(result.status).toBe(1);
      expect(result.output).toContain("retry budget exceeded");
    });

    it("fails when a flow failed again after its isolated re-run", async () => {
      const result = await gate(ledgerOf({ recovered: "0", unrecovered: "1" }));
      expect(result.status).toBe(1);
      expect(result.output).toContain("failed after retry");
    });

    it("fails when a failed flow was never eligible to be re-run", async () => {
      const result = await gate(
        ledgerOf({ retried: "0", recovered: "0", not_eligible: "1" })
      );
      expect(result.status).toBe(1);
      expect(result.output).toContain("were not retried");
    });

    it("stands down, reporting zero, when there is no ledger at all", async () => {
      const result = await gate(null);
      expect(result.status).toBe(0);
      expect(result.outputs).toContain("retried=0");
    });

    it("renders the same table whatever ORDER the rows arrive in", async () => {
      const flowRows = [
        FLOW_01_RECOVERED,
        "flow|.maestro/flows/flow-30.yaml|2|recovered",
      ];
      const forward = await gate(ledgerOf({ retried: "2" }, flowRows));
      const reversed = await gate(
        ledgerOf({ retried: "2" }, [...flowRows].reverse())
      );
      /**
       * The table's data rows as a set.
       * @param summary - Job-summary text
       * @returns Sorted rows naming a flow
       */
      const tableRows = (summary: string): string[] =>
        summary
          .split("\n")
          .filter(line => line.includes(".yaml"))
          .sort(byCodePoint);
      expect(tableRows(reversed.summary)).toEqual(tableRows(forward.summary));
    });
  });

  describe("the policy inputs", () => {
    it("ships inert, with conservative defaults", () => {
      const inputs = workflow.on.workflow_call?.inputs ?? {};
      // Empty tag = the feature is OFF. A reusable workflow is called by repos
      // that never asked for this, and no repo's behaviour may change until it
      // opts in — the same "default preserves prior behavior" rule the app-id
      // lint and the prerequisites guard follow.
      expect(inputs.ios_flow_retry_tag?.default).toBe("");
      expect(inputs.ios_flow_retry_attempts?.default).toBe(1);
      expect(inputs.ios_flow_retry_rate_percent?.default).toBe(10);
    });
  });
});
/* eslint-enable max-lines -- end of the paired-case suite */
