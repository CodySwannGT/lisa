/**
 * Behavioral tests for per-flow retry on the ANDROID arm, EXECUTED rather than
 * asserted: the step that writes the suite driver, the driver itself, and the
 * retry-budget gate are all pulled verbatim out of the YAML and run, with the
 * suite stubbed through the workflow's own `flow_runner` seam.
 *
 * ## What is broken today, which is what these tests pin
 *
 * The Android arm carried no retry of any kind, so a single environmental
 * fault in one flow of forty reddened the whole leg. Measured on a consumer's
 * nightly: six consecutive runs, each failing exactly ONE flow, a different
 * flow every time, every fix holding and none regressing. Two of those losses
 * were diagnosed to the device — a `maestro.android.DeviceServerDiedException`
 * raised during `eraseText` whose JUnit `<failure>` element was BLANK, and a
 * stuck IME-insets animation that starved UiAutomator's `waitForIdle` until
 * every backspace timed out at 10s. Neither has a fix in flow YAML, and the
 * blank failure body is why retry may never be gated on an error string.
 *
 * ## Why the wiring is asserted and not just the behaviour
 *
 * `android-emulator-runner` runs each LINE of `script:` as its own `sh -c`, so
 * the retry loop cannot live there. It lives in a driver file the workflow
 * writes and a single script line invokes. That indirection is load-bearing and
 * invisible to a test that only executes the driver, so the line the emulator
 * runs is the line these tests run.
 *
 * ## The bite controls
 *
 * Every guard is proved in BOTH directions, because a test that cannot fail is
 * as broken as one that cannot pass:
 *
 *  - retry fires for a tagged flow AND does not fire for an untagged one;
 *  - the rate budget stands down at 3 of 39 AND fails the arm at 4 of 39,
 *    which is the measured leg that set the threshold;
 *  - a re-run that passed is accepted AND a re-run that passed having executed
 *    ZERO flows is refused;
 *  - the gate passes a within-budget ledger AND fails a breached one;
 *  - the emulator script invokes the driver AND runs the suite no other way.
 *
 * Sibling of maestro-native-per-flow-retry.test.ts, which pins the same feature
 * on the arm it shipped on first.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  byCodePoint,
  ledgerOf,
  reading,
  rows,
  rowsInFileOrder,
  SUITE_SIZE,
} from "./support/maestro-android-retry-fixtures";
import {
  androidStep,
  driverInvocation,
  driverPath,
  emulatorScriptLines,
  loadWorkflow,
  runGate,
  runSuiteDriver,
  type ReusableWorkflow,
  type RunOptions,
} from "./support/maestro-android-retry-harness";

/** The ledger row a flow-07 first-attempt loss produces once it recovers. */
const FLOW_07_RECOVERED = "flow|.maestro/flows/flow-07.yaml|2|recovered";

/** The same, for flow-01. */
const FLOW_01_RECOVERED = "flow|.maestro/flows/flow-01.yaml|2|recovered";

describe("maestro-native-e2e Android per-flow retry (executed)", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = await loadWorkflow();
  });

  /**
   * Runs the real driver through the real emulator-script line.
   * @param options - Fixture and policy knobs
   * @returns Exit status, stub invocation count, output, and the ledger
   */
  const run = (options: RunOptions = {}) => runSuiteDriver(workflow, options);

  describe("the wiring that makes retry reachable on this arm", () => {
    it("invokes the driver the workflow writes, from the emulator script", () => {
      // The indirection IS the feature here: `android-emulator-runner` runs
      // each script line as its own `sh -c`, so a retry loop can only exist
      // inside a file one line invokes. Break this link and the driver is dead
      // code that every other test in this file would still exercise happily.
      expect(driverInvocation(workflow)).toBe(`bash ${driverPath(workflow)}`);
    });

    it("runs the suite NO other way from the emulator script", () => {
      // A leftover inline invocation would run the suite once with no retry and
      // once through the driver, and the first would decide the exit status.
      const suiteLines = emulatorScriptLines(workflow).filter(
        line => line.includes("maestro test") || line.includes("FLOW_RUNNER")
      );
      expect(suiteLines).toEqual([]);
    });

    it("passes the ANDROID retry inputs to the step that runs the suite", () => {
      // Cross-wiring `ios_flow_retry_*` here would compile, ship, and hand this
      // arm the other arm's policy — invisible to every behavioural test,
      // because the driver only ever sees the values, never their source.
      const env = androidStep(workflow, "Run Maestro flows on emulator").env;
      expect(env?.FLOW_RETRY_TAG).toBe("${{ inputs.android_flow_retry_tag }}");
      expect(env?.FLOW_RETRY_ATTEMPTS).toBe(
        "${{ inputs.android_flow_retry_attempts }}"
      );
      expect(env?.FLOW_RETRY_RATE_PERCENT).toBe(
        "${{ inputs.android_flow_retry_rate_percent }}"
      );
    });
  });

  describe("the eligibility guard (both directions)", () => {
    it("re-runs a TAGGED failed flow on its own and recovers the arm", async () => {
      const result = await run({ failing: ["flow-07"] });
      expect(result.attempts).toBe(2);
      expect(result.status).toBe(0);
      expect(rows(result.ledger)).toEqual([FLOW_07_RECOVERED]);
      expect(reading(result.ledger, "platform")).toBe("android");
      expect(reading(result.ledger, "retried")).toBe("1");
      expect(reading(result.ledger, "recovered")).toBe("1");
      expect(result.output).toContain("Maestro flow retried (android)");
      expect(result.output).toContain("green only after per-flow retry");
    });

    it("does NOT re-run an UNTAGGED failed flow", async () => {
      // The negative half. Delete the eligibility check in the workflow and
      // this starts failing with attempts === 2 — the only thing that proves
      // the guard is load-bearing rather than decorative. It also pins the
      // isolation contract: a flow that inherits session state or reads
      // another flow's fixtures would be re-run alone and fail falsely.
      const result = await run({ failing: ["flow-07"], tagged: [] });
      expect(result.attempts).toBe(1);
      expect(result.status).toBe(1);
      expect(rows(result.ledger)).toEqual([
        "flow|.maestro/flows/flow-07.yaml|1|not-eligible",
      ]);
      expect(result.output).toContain("not re-run");
    });

    it("re-runs nothing at all when no retry tag is configured", async () => {
      const result = await run({ failing: ["flow-07"], tag: "" });
      expect(result.attempts).toBe(1);
      expect(result.status).toBe(1);
      expect(reading(result.ledger, "retry_enabled")).toBe("false");
      expect(reading(result.ledger, "not_eligible")).toBe("1");
      expect(result.output).toContain("android_flow_retry_tag is empty");
    });
  });

  describe("the rate budget (both directions)", () => {
    it("stands down and retries when the failure rate is inside the budget", async () => {
      // 3 of 39 == 7%, under the 10% default: three times the arm's measured
      // steady state of one lost flow a night, and still comfortably inside.
      const failing = ["flow-01", "flow-02", "flow-03"];
      const result = await run({ failing });
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(1 + failing.length);
      expect(reading(result.ledger, "rate_breach")).toBe("false");
      expect(reading(result.ledger, "retry_rate_percent")).toBe("7");
      expect(rows(result.ledger)).toEqual(
        failing
          .map(name => `flow|.maestro/flows/${name}.yaml|2|recovered`)
          .sort(byCodePoint)
      );
    });

    it("fails the arm and retries NOTHING at the measured 4-of-39 leg", async () => {
      // The real leg that set this threshold: 4 of 39 is 10.3%, a quarter of a
      // point over the 10% budget and four times the arm's steady-state loss.
      // Nothing is re-run — above the budget the arm is degraded or the
      // failures are real, and retrying would spend the job's minutes hiding
      // which. Compare truncated percentages instead of the cross-multiplied
      // integers and this case reads as exactly 10% and goes green.
      const failing = ["flow-01", "flow-02", "flow-03", "flow-04"];
      const result = await run({ failing });
      expect(result.status).toBe(1);
      expect(result.attempts).toBe(1);
      expect(reading(result.ledger, "rate_breach")).toBe("true");
      expect(reading(result.ledger, "retried")).toBe("0");
      expect(result.output).toContain("retry budget exceeded (android)");
      expect(rows(result.ledger)).toEqual(
        failing
          .map(name => `flow|.maestro/flows/${name}.yaml|1|over-budget`)
          .sort(byCodePoint)
      );
    });
  });

  describe("what a retry is allowed to prove", () => {
    it("keeps the arm red when the isolated re-run fails again", async () => {
      const result = await run({ mode: "retry-fails" });
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
      const result = await run({ mode: "retry-executes-nothing" });
      expect(result.status).toBe(1);
      expect(rows(result.ledger)).toEqual([
        "flow|.maestro/flows/flow-07.yaml|2|vacuous",
      ]);
      expect(result.output).toContain("Retry executed nothing (android)");
    });

    it("grants exactly the configured number of extra attempts", async () => {
      const result = await run({ mode: "retry-fails", attempts: "2" });
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
      const result = await run({ suitePasses: true, failing: [] });
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(1);
      expect(reading(result.ledger, "retried")).toBe("0");
      expect(reading(result.ledger, "executed")).toBe(String(SUITE_SIZE));
      expect(rows(result.ledger)).toEqual([]);
    });

    it("produces a ledger that does not depend on the report's flow ORDER", async () => {
      const failing = ["flow-01", "flow-30"];
      const forward = await run({ failing });
      const reversed = await run({ failing, reverseOrder: true });
      // Byte-identical, not merely set-equal: the ledger is diffed between
      // nights, and a diff that lights up because Maestro reordered itself is
      // a diff nobody reads twice.
      expect(reversed.ledger).toBe(forward.ledger);
      expect(rows(forward.ledger)).toEqual([
        FLOW_01_RECOVERED,
        "flow|.maestro/flows/flow-30.yaml|2|recovered",
      ]);
    });

    it("announces retried flows in a stable order, whatever the report's", async () => {
      // The ledger is the artifact, but the run LOG is what a human reads
      // first, and the same night-to-night comparison argument applies to it:
      // two runs that retried the same flows must narrate them in the same
      // order. That property is what makes the failed-flow list's sort
      // load-bearing rather than decorative — take the sort out and this
      // narration follows Maestro's execution order instead.
      const failing = ["flow-01", "flow-30"];
      /**
       * The flows named by the retry warnings, in the order announced.
       * @param output - The step's stdout
       * @returns Flow paths, in narration order
       */
      const announced = (output: string): string[] =>
        [
          ...output.matchAll(/Maestro flow retried \(android\)::(\S+) failed/g),
        ].map(match => match[1]);
      const forward = await run({ failing });
      const reversed = await run({ failing, reverseOrder: true });
      expect(announced(forward.output)).toEqual([
        ".maestro/flows/flow-01.yaml",
        ".maestro/flows/flow-30.yaml",
      ]);
      expect(announced(reversed.output)).toEqual(announced(forward.output));
    });

    it("writes rows ordered by FLOW, not by which loop produced them", async () => {
      // Ineligible flows are recorded by one loop and retried flows by another,
      // so the rows arrive grouped by KIND. Left that way, two nights that saw
      // the same flows in different roles produce different bytes. flow-30 is
      // written first and must appear second.
      const result = await run({
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
      const result = await run({ failing: ["flow-07"], repeatFailing: true });
      expect(result.status).toBe(0);
      expect(reading(result.ledger, "failed_first_attempt")).toBe("1");
      expect(result.attempts).toBe(2);
      expect(rows(result.ledger)).toEqual([FLOW_07_RECOVERED]);
    });
  });

  describe("the retry-budget gate (both directions)", () => {
    it("passes a within-budget ledger, loudly", async () => {
      const result = await runGate(workflow, ledgerOf({}, [FLOW_07_RECOVERED]));
      expect(result.status).toBe(0);
      expect(result.outputs).toContain("retried=1");
      expect(result.output).toContain("Android flows needed a retry");
      expect(result.summary).toContain("per-flow retry ledger");
      expect(result.summary).toContain("flow-07.yaml");
      expect(result.summary).toContain("recovered");
    });

    it("fails a breached ledger", async () => {
      const result = await runGate(
        workflow,
        ledgerOf({
          failed_first_attempt: "4",
          retried: "0",
          recovered: "0",
          retry_rate_percent: "10",
          rate_breach: "true",
          not_eligible: "4",
        })
      );
      expect(result.status).toBe(1);
      expect(result.output).toContain("retry budget exceeded");
    });

    it("fails when a flow failed again after its isolated re-run", async () => {
      const result = await runGate(
        workflow,
        ledgerOf({ recovered: "0", unrecovered: "1" })
      );
      expect(result.status).toBe(1);
      expect(result.output).toContain("failed after retry");
    });

    it("fails when a failed flow was never eligible to be re-run", async () => {
      const result = await runGate(
        workflow,
        ledgerOf({ retried: "0", recovered: "0", not_eligible: "1" })
      );
      expect(result.status).toBe(1);
      expect(result.output).toContain("were not retried");
    });

    it("stands down, reporting zero, when there is no ledger at all", async () => {
      const result = await runGate(workflow, null);
      expect(result.status).toBe(0);
      expect(result.outputs).toContain("retried=0");
    });

    it("renders the same table whatever ORDER the rows arrive in", async () => {
      const flowRows = [
        FLOW_01_RECOVERED,
        "flow|.maestro/flows/flow-30.yaml|2|recovered",
      ];
      const forward = await runGate(
        workflow,
        ledgerOf({ retried: "2" }, flowRows)
      );
      const reversed = await runGate(
        workflow,
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
      expect(inputs.android_flow_retry_tag?.default).toBe("");
      expect(inputs.android_flow_retry_attempts?.default).toBe(1);
      expect(inputs.android_flow_retry_rate_percent?.default).toBe(10);
    });
  });
});
