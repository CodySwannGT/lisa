/**
 * Contract tests for the Maestro native reusable workflow's caller-owned flow
 * runner seam.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

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

  it("runs Android through the caller runner or the existing one-line Maestro command", () => {
    const emulator = (workflow.jobs.android.steps ?? []).find(step =>
      step.uses?.startsWith("reactivecircus/android-emulator-runner")
    );
    const script = String(emulator?.with?.script ?? "");
    const runnerLine =
      'if [ -n "$FLOW_RUNNER" ]; then bash "$FLOW_RUNNER" maestro-android-report.xml maestro-debug $MAESTRO_E2E_ARGS "$FLOWS_DIR"; else maestro test $MAESTRO_E2E_ARGS --format junit --output maestro-android-report.xml --debug-output maestro-debug "$FLOWS_DIR"; fi';

    expect(emulator?.env?.FLOW_RUNNER).toBe("${{ inputs.flow_runner }}");
    // The flows dir reaches the script as an env var, never as a `${{ }}`
    // expansion inside the script text — a template expansion is substituted
    // before bash parses the line, which is a shell-injection seam on a
    // reusable input a caller may wire to event-controlled data.
    expect(emulator?.env?.FLOWS_DIR).toBe(FLOWS_DIR_EXPANSION);
    expect(script).not.toContain(FLOWS_DIR_EXPANSION);
    expect(script).toContain(runnerLine);
    expect(
      script.split("\n").filter(line => line.includes("maestro test"))
    ).toHaveLength(1);
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
    // thing to run last — the contract is unchanged, only the two variable
    // positions are.
    expect(iosRun?.run).toContain(
      'bash "$FLOW_RUNNER" "$1" maestro-debug $MAESTRO_E2E_ARGS "$2"'
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
});
