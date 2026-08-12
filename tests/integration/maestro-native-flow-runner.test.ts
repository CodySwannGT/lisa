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
      'if [ -n "$FLOW_RUNNER" ]; then bash "$FLOW_RUNNER" maestro-android-report.xml maestro-debug $MAESTRO_E2E_ARGS ${{ inputs.flows_dir }}; else maestro test $MAESTRO_E2E_ARGS --format junit --output maestro-android-report.xml --debug-output maestro-debug ${{ inputs.flows_dir }}; fi';

    expect(emulator?.env?.FLOW_RUNNER).toBe("${{ inputs.flow_runner }}");
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
    expect(iosRun?.run).toContain(
      'bash "$FLOW_RUNNER" maestro-ios-report.xml maestro-debug $MAESTRO_E2E_ARGS ${{ inputs.flows_dir }}'
    );
    // Indentation-agnostic on purpose: the invocation now lives inside a
    // `run_suite()` function so the driver-startup retry can call it twice,
    // which shifts it two columns. What matters is that the flows dir and the
    // assembled args still reach the same command, not how deep it sits.
    expect(iosRun?.run.replace(/\n\s+/g, " ")).toContain(
      "maestro test ${{ inputs.flows_dir }} \\ $MAESTRO_E2E_ARGS"
    );
  });
});
