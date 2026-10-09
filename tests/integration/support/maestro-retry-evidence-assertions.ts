/** Shared ledger vocabulary and assertions; execution always comes from YAML. */
import { expect } from "vitest";
import { reading, rows } from "./maestro-android-retry-fixtures.js";
import {
  loadWorkflow,
  runGate,
  runSuiteDriver,
  type RunOptions,
} from "./maestro-android-retry-harness.js";

export const FAILED_MODE = "retry-fails" as const;
export const NO_DEVICE_MODE = "retry-no-device" as const;
export const NO_REPORT_MODE = "retry-no-report" as const;
export const FAILED_AGAIN_MESSAGE = "failed again" as const;

export const FAILED = "unrecovered";
export const UNKNOWN = "retry-unknown";
export const NOT_EXECUTED = "retry-not-executed";
export const UNKNOWN_COUNTER = "retry_unknown";
export const NOT_EXECUTED_COUNTER = "retry_not_executed";
export const EXECUTED_MESSAGE = "executed again and failed";
export const UNKNOWN_MESSAGE = "execution could not be verified";
export const NO_EVIDENCE_MESSAGE = "no new flow-failure evidence";
export const CUSTOM_NAME = "Custom retry flow";
export const SELECTED_NAME = "Selected flow";
export const FOREIGN_NAME = "Foreign flow";

/**
 * Expected final selected-flow row.
 * @returns Final flow ledger row.
 * @param attempt - Actual suite-inclusive attempt number.
 * @param category - Observed retry category.
 */
export const flowRow = (attempt: number, category: string) =>
  `flow|.maestro/flows/flow-07.yaml|${attempt}|${category}`;
/**
 * Expected completed selected-flow attempt row.
 * @returns Completed attempt ledger row.
 * @param attempt - Actual suite-inclusive attempt number.
 * @param category - Observed retry category.
 */
export const attemptRow = (attempt: number, category: string) =>
  `attempt|.maestro/flows/flow-07.yaml|${attempt}|${category}`;
/**
 * Read actual completed-attempt rows.
 * @returns Durable completed-attempt rows.
 * @param ledger - Actual workflow ledger, or null if absent.
 */
export const attempts = (ledger: string | null) =>
  (ledger ?? "").split("\n").filter(line => line.startsWith("attempt|"));

/**
 * Load once per arm and execute the actual driver followed by its actual gate.
 * @returns Actual driver/gate runner and unknown-category assertion.
 * @param platform - Native workflow arm to execute.
 */
export function evidenceHarness(platform: "android" | "ios") {
  const workflow = loadWorkflow();
  const run = async (options: RunOptions) => {
    const native = await workflow;
    const driver = await runSuiteDriver(native, { platform, ...options });
    return { driver, gate: await runGate(native, driver.ledger, platform) };
  };
  const expectUnknown = async (options: RunOptions) => {
    const { driver, gate } = await run(options);
    expect(driver.status).toBe(1);
    expect(reading(driver.ledger, FAILED)).toBe("0");
    expect(reading(driver.ledger, UNKNOWN_COUNTER)).toBe("1");
    expect(rows(driver.ledger)).toEqual([flowRow(2, UNKNOWN)]);
    expect(gate.status).toBe(1);
    expect(gate.output).toContain(UNKNOWN_MESSAGE);
    expect(gate.output).not.toContain("failed again");
    return { driver, gate };
  };
  return { run, expectUnknown };
}
