/**
 * The retry-budget gate half of the executed maestro-native-e2e per-flow retry
 * suite: the gate step is pulled verbatim out of the YAML and run against
 * hand-written ledgers, each guard proved in both directions. Also pins the
 * feature's inert policy-input defaults.
 *
 * Sibling of maestro-native-per-flow-retry.test.ts, which executes the suite
 * step that writes the ledger this gate reads.
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import {
  BASH,
  byCodePoint,
  FLOW_01_RECOVERED,
  FLOW_07_RECOVERED,
  iosStepRun,
  LEDGER_FILE,
  loadWorkflow,
  type ReusableWorkflow,
  SUITE_SIZE,
} from "./maestro-native-per-flow-retry-fixtures.js";

describe("maestro-native-e2e per-flow retry (executed)", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = await loadWorkflow();
  });

  /**
   * The verbatim `run:` text of a named iOS step — never a copy of it.
   * @param namePart - Substring of the step's `name:`
   * @returns The step's shell script exactly as CI will run it
   */
  const iosStep = (namePart: string): string => iosStepRun(workflow, namePart);

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
