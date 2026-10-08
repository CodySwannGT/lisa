import * as fs from "fs-extra";
import * as path from "node:path";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { seedClock } from "./maestro-android-retry-fixtures.js";
import { commandEvidence } from "./maestro-command-evidence.js";
import { androidRun, driverInvocation } from "./maestro-retry-workflow.js";
import type { ReusableWorkflow, RunOptions } from "./maestro-retry-types.js";

const BASH = "/bin/bash";

/**
 * Customize the selected flow source and observed report name.
 * @param dir - Owned fixture directory.
 * @param seed - Original report fixture path.
 * @param options - Fixture controls.
 */
async function seedNamedFlow(dir: string, seed: string, options: RunOptions) {
  if (!options.flowName) return;
  const flow = path.join(dir, ".maestro", "flows", "flow-07.yaml");
  const body = await fs.readFile(flow, "utf-8");
  const nested = options.nestedEnvName
    ? `env:\n  name: ${JSON.stringify(options.nestedEnvName)}\n`
    : "";
  const named = `name: ${JSON.stringify(options.rawHeaderName ?? options.flowName)}\n${nested}${body}`;
  await fs.writeFile(flow, named);
  const xmlName = options.flowName
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const originalReport = (await fs.readFile(seed, "utf-8")).replace(
    'name="flow-07"',
    `name="${xmlName}"`
  );
  if (options.flowNameCollision) {
    await fs.writeFile(
      path.join(dir, ".maestro", "flows", "foreign.yaml"),
      named
    );
  }
  const report = options.flowNameCollision
    ? originalReport.replace(
        "</testsuite>",
        `<testcase name="${xmlName}" file=".maestro/flows/foreign.yaml" status="SUCCESS" time="10"/></testsuite>`
      )
    : originalReport;
  await fs.writeFile(seed, report);
}

/**
 * Prepare the real platform driver and its isolated reporting environment.
 * @param workflow - Parsed reusable workflow.
 * @param dir - Owned fixture directory.
 * @param seed - Original JUnit report fixture.
 * @param options - Timing and platform controls.
 * @returns Driver invocation and environment.
 */
export async function prepareDriver(
  workflow: ReusableWorkflow,
  dir: string,
  seed: string,
  options: RunOptions
) {
  const {
    platform = "android",
    missingDuration = false,
    clockAdvanceSeconds = 0,
  } = options;
  const summary = path.join(dir, "summary");
  await fs.writeFile(summary, "");
  if (options.report) await fs.writeFile(seed, options.report);
  if (missingDuration) {
    await fs.writeFile(
      seed,
      (await fs.readFile(seed, "utf-8")).replaceAll(' time="20"', "")
    );
  }
  const fixtureEnv = await seedClock(dir, summary, clockAdvanceSeconds);
  await seedNamedFlow(dir, seed, options);
  // The driver-writing step, executed verbatim, in the working directory the
  // emulator action then runs from.
  if (platform === "android")
    boundedExecFileSync({
      label: "the write-the-Android-suite-driver step",
      command: BASH,
      args: [
        "-eo",
        "pipefail",
        "-c",
        androidRun(workflow, "Write the Android suite driver"),
      ],
      cwd: dir,
      env: fixtureEnv,
    });
  const invocation =
    platform === "android" ? driverInvocation(workflow) : "bash ios-driver.sh";
  if (platform === "ios") {
    const step = workflow.jobs.ios?.steps?.find(
      candidate => candidate.env?.FLOW_RETRY_TAG
    );
    if (!step?.run) throw new Error("Missing iOS suite step");
    const script = path.join(dir, "ios-driver.sh");
    await fs.writeFile(script, `set -eo pipefail\n${step.run}`);
  }

  return { summary, fixtureEnv, invocation };
}

/**
 * Build the isolated fixture environment without changing retry policy.
 * @returns Environment passed to the actual driver.
 * @param fixtureEnv - Isolated clock and process environment.
 * @param dir - Owned fixture directory.
 * @param stub - Fixture runner path.
 * @param counter - Runner invocation counter path.
 * @param seed - Original report fixture path.
 * @param debugRoots - Debug root trace path.
 * @param options - Fixture controls.
 */
export function driverEnvironment(
  fixtureEnv: NodeJS.ProcessEnv,
  dir: string,
  stub: string,
  counter: string,
  seed: string,
  debugRoots: string,
  options: RunOptions
): NodeJS.ProcessEnv {
  return {
    ...fixtureEnv,
    LISA_MAESTRO_SUITE_DEADLINE:
      options.deadlineSeconds === null
        ? ""
        : String(
            Math.floor(Date.now() / 1000) + (options.deadlineSeconds ?? 3600)
          ),
    FLOW_RUNNER: stub,
    FLOWS_DIR: ".maestro/flows",
    MAESTRO_E2E_ARGS: "",
    STUB_ATTEMPTS: counter,
    STUB_SEED: seed,
    STUB_MODE: options.mode ?? "retry-passes",
    STUB_SUITE_PASSES: String(options.suitePasses ?? false),
    STUB_COMMAND_EVIDENCE: options.commandEvidence ?? "executed",
    STUB_COMMAND_JSON: commandEvidence(options.commandEvidence ?? "executed"),
    STUB_DEBUG_LAYOUT: options.debugLayout ?? "modern",
    STUB_WRONG_TARGET: String(options.wrongTarget ?? false),
    STUB_STALE_SUITE: String(options.staleSuiteEvidence ?? false),
    STUB_EVIDENCE_ONLY_FIRST: String(options.evidenceOnlyFirstRetry ?? false),
    STUB_INTERRUPT_NEXT: String(options.interruptNextRetry ?? false),
    STUB_RECOVER_NEXT: String(options.recoverNextRetry ?? false),
    STUB_FLOW_NAME: options.flowName ?? "",
    STUB_FOREIGN_NAME: options.nestedEnvName ?? "Foreign flow",
    STUB_NAME_ONLY: String(options.nameOnlyReport ?? false),
    STUB_SHARD_DIR: String(options.shardDirectory ?? false),
    STUB_DEBUG_ROOTS: debugRoots,
    STUB_SUITE_DEBUG: path.join(dir, "suite-debug-root"),
    FLOW_RETRY_TAG: options.tag ?? "retryable",
    FLOW_RETRY_ATTEMPTS: options.attempts ?? "1",
    FLOW_RETRY_RATE_PERCENT: options.ratePercent ?? "10",
  };
}
