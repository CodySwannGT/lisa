/**
 * Contract tests for the Maestro native reusable workflow's caller-owned flow
 * runner seam.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  loadWorkflow,
  runSuiteDriver,
} from "./support/maestro-android-retry-harness.js";
import { runCapturing } from "./support/maestro-retry-execution.js";
import { runnerCalls } from "./support/maestro-runner-arguments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REUSABLE_YML = path.join(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/**
 * The template expansion for the flows directory. It must appear ONLY in a
 * step's `env:` map — never inside a script body, where GitHub substitutes it
 * into the text before bash parses it and a caller-supplied value becomes
 * executable shell.
 */
const FLOWS_DIR_EXPANSION = "${{ inputs.flows_dir }}";

/** Shape of a single `workflow_call` input declaration. */
interface WorkflowInput {
  default?: unknown;
  required?: boolean;
  type?: string;
}

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  run?: string;
  uses?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  steps?: WorkflowStep[];
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
    };
  };
  jobs: Record<string, WorkflowJob>;
}

describe("maestro-native flow_runner seam", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  it("exposes an opt-in runner input with today's default behavior", () => {
    const flowRunner = workflow.on.workflow_call?.inputs?.flow_runner;
    expect(flowRunner?.default).toBe("");
    expect(flowRunner?.required ?? false).toBe(false);
    expect(flowRunner?.type).toBe("string");
  });

  it("runs Android through the caller runner or the existing Maestro command", () => {
    const emulator = (workflow.jobs.android.steps ?? []).find(step =>
      step.uses?.startsWith("reactivecircus/android-emulator-runner")
    );
    const script = String(emulator?.with?.script ?? "");
    // The suite invocation moved out of `script:` and into a driver file the
    // job writes, because `android-emulator-runner` runs each script LINE as
    // its own `sh -c` and per-flow retry needs one process to hold its state.
    // The seam itself is unchanged: the caller's runner still receives the
    // report path first, the debug dir second, the assembled args, and the
    // thing to run last.
    const driver = (workflow.jobs.android.steps ?? []).find(step =>
      step.run?.includes("maestro-android-report.xml")
    );

    expect(emulator?.env?.FLOW_RUNNER).toBe("${{ inputs.flow_runner }}");
    // The flows dir reaches the script as an env var, never as a `${{ }}`
    // expansion inside the script text — a template expansion is substituted
    // before bash parses the line, which is a shell-injection seam on a
    // reusable input a caller may wire to event-controlled data.
    expect(emulator?.env?.FLOWS_DIR).toBe(FLOWS_DIR_EXPANSION);
    expect(script).not.toContain(FLOWS_DIR_EXPANSION);
    expect(driver?.run).not.toContain(FLOWS_DIR_EXPANSION);
    expect(driver?.run).toContain(
      'bash "$FLOW_RUNNER" "$1" "${3:-maestro-debug}" $MAESTRO_E2E_ARGS "$2"'
    );
    expect(driver?.run).toContain(
      'run_target maestro-android-report.xml "$FLOWS_DIR"'
    );
    // Indentation-agnostic for the same reason the iOS assertion below is: the
    // invocation lives inside a function so the suite and each per-flow retry
    // can both call it.
    expect(driver?.run.replace(/\n\s+/g, " ")).toContain(
      'maestro test "$2" \\ $MAESTRO_E2E_ARGS'
    );
    expect(
      String(driver?.run ?? "")
        .split("\n")
        .filter(line => line.includes("maestro test"))
    ).toHaveLength(1);
    // …and nothing runs the suite from `script:` any more, which would
    // otherwise run it once with no retry and decide the step's exit status.
    expect(script).not.toContain("maestro test");
  });

  it("runs iOS through the caller runner or the existing Maestro command", () => {
    const iosRun = (workflow.jobs.ios.steps ?? []).find(step =>
      step.run?.includes("maestro-ios-report.xml")
    );

    expect(iosRun?.env?.FLOW_RUNNER).toBe("${{ inputs.flow_runner }}");
    // Same injection seam as the Android arm: env var in, no `${{ }}` in the
    // script text.
    expect(iosRun?.env?.FLOWS_DIR).toBe(FLOWS_DIR_EXPANSION);
    expect(iosRun?.run).not.toContain(FLOWS_DIR_EXPANSION);
    // The invocation is now parameterised by REPORT PATH and TARGET, because
    // per-flow retry re-runs one flow file through the same seam and writes it
    // to its own report. The caller's runner therefore still receives the
    // report path first, the debug dir second, the assembled args, and the
    // thing to run last. The internal third parameter chooses a fresh debug
    // root for a selected retry; the original suite keeps maestro-debug.
    expect(iosRun?.run).toContain(
      'bash "$FLOW_RUNNER" "$1" "${3:-maestro-debug}" $MAESTRO_E2E_ARGS "$2"'
    );
    // …and the suite call still supplies exactly the pair the assertion above
    // used to spell out inline.
    expect(iosRun?.run).toContain(
      'run_target maestro-ios-report.xml "$FLOWS_DIR"'
    );
    // Indentation-agnostic on purpose: the invocation lives inside functions
    // so the driver-startup retry and the per-flow retry can both call it,
    // which shifts it two columns. What matters is that the target and the
    // assembled args still reach the same command, not how deep it sits.
    expect(iosRun?.run.replace(/\n\s+/g, " ")).toContain(
      'maestro test "$2" \\ $MAESTRO_E2E_ARGS'
    );
  });

  it.each(["android", "ios"] as const)(
    "passes report, debug directory, exact flags, and target in order for the %s suite and selected retry",
    async platform => {
      const flags = [
        "--include-tags",
        "smoke",
        "--exclude-tags",
        "quarantined",
        "--env",
        "FIXTURE_TOKEN=value",
      ];
      const result = await runSuiteDriver(await loadWorkflow(), {
        platform,
        maestroArgs: flags.join(" "),
      });
      expect(result.status).toBe(0);
      expect(result.attempts).toBe(2);
      expect(result.runnerCalls).toHaveLength(2);
      expect(result.runnerCalls[0]).toEqual([
        `maestro-${platform}-report.xml`,
        "maestro-debug",
        ...flags,
        ".maestro/flows",
      ]);
      const retry = result.runnerCalls[1];
      expect(retry).toEqual([
        expect.stringMatching(
          new RegExp(`^maestro-${platform}-retry-.+-1\\.xml$`)
        ),
        result.debugRoots[1],
        ...flags,
        ".maestro/flows/flow-07.yaml",
      ]);
      expect(result.debugRoots[1]).toMatch(
        new RegExp(`^maestro-debug/retry-${platform}-.+-1-[A-Za-z0-9]+$`)
      );
      expect(result.debugRoots[1]).not.toBe(result.debugRoots[0]);
    }
  );

  it("retains empty arguments and embedded delimiters in the shell's argc-framed trace", () => {
    const argumentsWithDelimiters = [
      "",
      "line\nbreak",
      "tab\tvalue",
      "pipe|value",
    ];
    const captured = runCapturing(
      "/bin/bash",
      [
        "-c",
        'printf "%s\\0" "$#" "$@"; printf "%s\\0" 0',
        "runner-trace",
        ...argumentsWithDelimiters,
      ],
      { cwd: process.cwd(), env: process.env }
    );
    expect(captured.status).toBe(0);
    expect(runnerCalls(captured.output)).toEqual([argumentsWithDelimiters, []]);
    expect(() => runnerCalls("2\0only-one\0")).toThrow(
      "Invalid runner argument count"
    );
    expect(() => runnerCalls("1\0unterminated")).toThrow(
      "Unterminated runner argument trace"
    );
  });
});
