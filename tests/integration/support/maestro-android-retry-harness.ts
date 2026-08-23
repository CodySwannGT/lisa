/**
 * Harness for the Android per-flow retry tests.
 *
 * What the assertions need and may never re-implement: the driver-writing step
 * and the retry-budget gate executed VERBATIM out of the YAML, and the suite
 * driver invoked through the same emulator-script line CI runs, under `sh -c`
 * as `android-emulator-runner` does it. A test that copied the retry loop into
 * itself would agree with itself rather than with the workflow.
 *
 * The fixture project and the ledger readings live next door in
 * maestro-android-retry-fixtures.ts.
 *
 * @module tests/integration/support/maestro-android-retry-harness
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { LEDGER_FILE, seedFixture } from "./maestro-android-retry-fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REUSABLE_YML = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** `sh` by absolute path, matching the action's `exec.exec('sh', ['-c', …])`. */
const SH = "/bin/sh";

/** Shape of a single step inside a workflow job's `steps:` list. */
export interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
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

/** Outcome of executing the suite driver against a fixture. */
export interface StepResult {
  status: number;
  attempts: number;
  output: string;
  ledger: string | null;
}

/** Outcome of executing the retry-budget gate against a ledger. */
export interface GateResult {
  status: number;
  output: string;
  summary: string;
  outputs: string;
}

/** How the stubbed runner behaves once the suite has failed. */
export type RetryMode =
  | "retry-passes"
  | "retry-fails"
  | "retry-executes-nothing";

/** Knobs for one suite-driver execution. */
export interface RunOptions {
  mode?: RetryMode;
  /** Flow basenames the fixture report marks as failed. */
  failing?: readonly string[];
  /** Flow basenames whose file carries the retry tag. */
  tagged?: readonly string[];
  /** Value of the `android_flow_retry_tag` input. */
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

/**
 * The reusable workflow, parsed.
 * @returns The parsed workflow
 */
export const loadWorkflow = async (): Promise<ReusableWorkflow> =>
  yaml.load(await fs.readFile(REUSABLE_YML, "utf-8")) as ReusableWorkflow;

/**
 * A named step of the android job — never a copy of one.
 * @param workflow - The parsed workflow
 * @param namePart - Substring of the step's `name:`
 * @returns The step as parsed from the workflow
 */
export const androidStep = (
  workflow: ReusableWorkflow,
  namePart: string
): WorkflowStep => {
  const step = (workflow.jobs.android.steps ?? []).find(candidate =>
    candidate.name?.includes(namePart)
  );
  if (!step) throw new Error(`no android step matching "${namePart}"`);
  return step;
};

/**
 * The verbatim `run:` text of a named android step.
 *
 * No `${{ }}` may survive into the script: an expansion is substituted into the
 * script TEXT before bash parses it, and executing a step verbatim is only
 * meaningful if nothing had to be rewritten to make it runnable.
 * @param workflow - The parsed workflow
 * @param namePart - Substring of the step's `name:`
 * @returns The step's shell script exactly as CI will run it
 */
export const androidRun = (
  workflow: ReusableWorkflow,
  namePart: string
): string => {
  const step = androidStep(workflow, namePart);
  if (!step.run) throw new Error(`android step "${namePart}" has no run:`);
  if (step.run.includes("${{")) {
    throw new Error(`android step "${namePart}" carries a template expansion`);
  }
  return step.run;
};

/**
 * The emulator action's `script:` as the action itself sees it — trimmed, split
 * on newlines, blanks and comment lines dropped, exactly as `parseScript` in
 * `android-emulator-runner` does it.
 * @param workflow - The parsed workflow
 * @returns One entry per `sh -c` invocation the action will make
 */
export const emulatorScriptLines = (workflow: ReusableWorkflow): string[] =>
  String(
    androidStep(workflow, "Run Maestro flows on emulator").with?.script ?? ""
  )
    .trim()
    .split(/\r\n|\n|\r/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"));

/**
 * The path the driver-writing step writes its script to.
 * @param workflow - The parsed workflow
 * @returns The driver's filename, as the workflow spells it
 */
export const driverPath = (workflow: ReusableWorkflow): string => {
  const match = /cat > (\S+) <</.exec(
    androidRun(workflow, "Write the Android suite driver")
  );
  if (!match) throw new Error("the driver-writing step writes no file");
  return match[1];
};

/**
 * The single emulator-script line that invokes the driver.
 *
 * Resolved from the YAML rather than hard-coded, so a change that stops the
 * action invoking the driver cannot leave these tests passing against a script
 * CI no longer runs.
 * @param workflow - The parsed workflow
 * @returns The command line, verbatim
 */
export const driverInvocation = (workflow: ReusableWorkflow): string => {
  const driver = driverPath(workflow);
  const lines = emulatorScriptLines(workflow).filter(line =>
    line.includes(driver)
  );
  if (lines.length !== 1) {
    throw new Error(
      `expected exactly one emulator script line invoking ${driver}, found ${lines.length}`
    );
  }
  return lines[0];
};

/**
 * Runs a command and reports its status and stdout instead of throwing.
 *
 * The subject under test is a script whose EXIT STATUS is half the assertion,
 * so a non-zero status is a reading here, never an error.
 * @param file - Executable to run
 * @param args - Its arguments
 * @param options - Child-process options
 * @param options.cwd - Working directory for the child
 * @param options.env - Environment for the child
 * @returns The exit status and whatever the child printed
 */
const runCapturing = (
  file: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): { status: number; output: string } => {
  try {
    return {
      status: 0,
      output: boundedExecFileSync({
        label: `${file} ${args.join(" ")}`,
        command: file,
        args,
        ...options,
      }),
    };
  } catch (error) {
    const failure = error as { exitCode?: number | null; stdout?: string };
    return { status: failure.exitCode ?? -1, output: failure.stdout ?? "" };
  }
};

/**
 * Runs the real driver against a fixture project, through the real
 * emulator-script line, under `sh -c` as the action does.
 * @param workflow - The parsed workflow
 * @param options - Fixture and policy knobs
 * @returns Exit status, stub invocation count, output, and the ledger
 */
export const runSuiteDriver = async (
  workflow: ReusableWorkflow,
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

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-android-"));
  try {
    const { stub, counter, seed } = await seedFixture(dir, {
      failing,
      tagged,
      reverseOrder,
      repeatFailing,
    });

    // The driver-writing step, executed verbatim, in the working directory the
    // emulator action then runs from.
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
      env: process.env,
    });

    const { status, output } = runCapturing(
      SH,
      ["-c", driverInvocation(workflow)],
      {
        cwd: dir,
        env: {
          ...process.env,
          FLOW_RUNNER: stub,
          FLOWS_DIR: ".maestro/flows",
          MAESTRO_E2E_ARGS: "",
          STUB_ATTEMPTS: counter,
          STUB_SEED: seed,
          STUB_MODE: mode,
          STUB_SUITE_PASSES: String(suitePasses),
          FLOW_RETRY_TAG: tag,
          FLOW_RETRY_ATTEMPTS: attempts,
          FLOW_RETRY_RATE_PERCENT: ratePercent,
        },
      }
    );
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
 * Executes the retry-budget gate step against a hand-written ledger.
 * @param workflow - The parsed workflow
 * @param ledger - Ledger contents, or null to omit the file
 * @returns Exit status, step output, summary text, and step outputs
 */
export const runGate = async (
  workflow: ReusableWorkflow,
  ledger: string | null
): Promise<GateResult> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-agate-"));
  try {
    if (ledger !== null) {
      await fs.writeFile(path.join(dir, LEDGER_FILE), ledger);
    }
    const outputs = path.join(dir, "outputs");
    const summary = path.join(dir, "summary");
    await fs.writeFile(outputs, "");
    await fs.writeFile(summary, "");
    const { status, output } = runCapturing(
      BASH,
      [
        "-eo",
        "pipefail",
        "-c",
        androidRun(workflow, "Enforce the per-flow retry budget"),
      ],
      {
        cwd: dir,
        env: {
          ...process.env,
          LEDGER: LEDGER_FILE,
          GITHUB_OUTPUT: outputs,
          GITHUB_STEP_SUMMARY: summary,
        },
      }
    );
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
