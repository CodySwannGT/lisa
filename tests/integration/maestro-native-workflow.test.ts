/**
 * Contract tests for the Maestro native e2e reusable workflow and its expo
 * caller template. Locks in the regression-prone details learned in
 * production (frontend-v2): the one-line maestro command inside
 * android-emulator-runner, the !cancelled() guards so one platform's build
 * failure doesn't skip the other's tests, and graceful skipping while a
 * project hasn't wired its e2e prerequisites yet.
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);
const CALLER_YML = path.join(
  REPO_ROOT,
  "expo",
  "create-only",
  ".github",
  "workflows",
  "maestro-e2e.yml"
);

/** Shape of a single `workflow_call` input declaration. */
interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
}

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  name?: string;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  outputs?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown>; "fail-fast"?: boolean };
  steps?: WorkflowStep[];
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  on: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
      secrets?: Record<string, { required?: boolean }>;
    };
  };
  jobs: Record<string, WorkflowJob>;
}

/** Root shape of the parsed caller template. */
interface CallerWorkflow {
  on: {
    schedule?: Array<{ cron: string }>;
    workflow_dispatch?: {
      inputs?: Record<string, { type?: string; options?: string[] }>;
    };
  };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, WorkflowJob>;
}

describe("maestro-native-e2e reusable workflow", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  it("is callable with an optional EXPO_TOKEN secret (graceful skip, not hard requirement)", () => {
    const secrets = workflow.on.workflow_call?.secrets ?? {};
    expect(secrets.EXPO_TOKEN).toBeDefined();
    expect(secrets.EXPO_TOKEN.required ?? false).toBe(false);
  });

  it("accepts sensitive flow variables via an optional MAESTRO_SECRET_ENV secret", () => {
    const secrets = workflow.on.workflow_call?.secrets ?? {};
    expect(secrets.MAESTRO_SECRET_ENV).toBeDefined();
    expect(secrets.MAESTRO_SECRET_ENV.required ?? false).toBe(false);
  });

  it("does not depend on Maestro Cloud", () => {
    // The header comment may NAME the Cloud alternative; the workflow itself
    // must not require its secret or action.
    expect(workflow.on.workflow_call?.secrets?.MAESTRO_API_KEY).toBeUndefined();
    const allSteps = Object.values(workflow.jobs).flatMap(
      job => job.steps ?? []
    );
    expect(
      allSteps.some(step =>
        step.uses?.startsWith("mobile-dev-inc/action-maestro-cloud")
      )
    ).toBe(false);
  });

  it("exposes the generalized inputs with production defaults", () => {
    const inputs = workflow.on.workflow_call?.inputs ?? {};
    expect(inputs.platform?.default).toBe("all");
    expect(inputs.eas_profile?.default).toBe("dev-e2e");
    expect(inputs.flows_dir?.default).toBe(".maestro/flows");
    expect(inputs.android_exclude_tags?.default).toBe("ios-only");
    expect(inputs.ios_exclude_tags?.default).toBe("android-only");
    expect(inputs.android_include_tags?.default).toBe("");
    expect(inputs.ios_include_tags?.default).toBe("");
    expect(inputs.maestro_env).toBeDefined();
    expect(inputs.setup_command).toBeDefined();
    expect(inputs.android_app_id).toBeDefined();
    expect(inputs.ios_app_id).toBeDefined();
  });

  it("gates build and test jobs behind the preflight prerequisite check", () => {
    expect(workflow.jobs.preflight).toBeDefined();
    expect(workflow.jobs.build.if).toContain(
      "needs.preflight.outputs.should_run == 'true'"
    );
    expect(workflow.jobs.android.if).toContain(
      "needs.preflight.outputs.run_android == 'true'"
    );
    expect(workflow.jobs.ios.if).toContain(
      "needs.preflight.outputs.run_ios == 'true'"
    );
  });

  it("warns instead of failing when prerequisites are missing", () => {
    const check = (workflow.jobs.preflight.steps ?? []).find(
      step => step.id === "check"
    );
    expect(check?.run).toContain("::warning::");
    expect(check?.run).toContain("EXPO_TOKEN not configured");
    expect(check?.run).toContain("not found");
  });

  it("builds per-platform via an EAS matrix from the preflight platform output", () => {
    const build = workflow.jobs.build;
    expect(build.strategy?.["fail-fast"]).toBe(false);
    expect(build.strategy?.matrix?.platform).toBe(
      "${{ fromJSON(needs.preflight.outputs.platforms) }}"
    );
    const easStep = (build.steps ?? []).find(step =>
      step.run?.includes("eas build")
    );
    expect(easStep?.run).toContain("--profile ${{ inputs.eas_profile }}");
    expect(easStep?.run).toContain("--non-interactive");
    // The iOS simulator artifact is a tarball, not an .ipa.
    expect(easStep?.run).toContain("app-ios.tar.gz");
  });

  it("does not let one platform's build failure skip the other platform's tests", () => {
    expect(workflow.jobs.android.if).toContain("!cancelled()");
    expect(workflow.jobs.ios.if).toContain("!cancelled()");
  });

  it("runs Android on an emulator with the maestro command on a single line", () => {
    const android = workflow.jobs.android;
    expect(android["runs-on"]).toBe("ubuntu-latest");
    const kvm = (android.steps ?? []).find(step =>
      step.run?.includes("static_node=kvm")
    );
    expect(kvm).toBeDefined();
    const emulator = (android.steps ?? []).find(step =>
      step.uses?.startsWith("reactivecircus/android-emulator-runner")
    );
    expect(emulator).toBeDefined();
    const script = String(emulator?.with?.script ?? "");
    expect(script).toContain("adb install app-android.apk");
    // android-emulator-runner runs each line as its own `sh -c`; a
    // backslash-continued maestro command breaks. The whole invocation —
    // flags, report output, flows dir — must stay on one line.
    const maestroLines = script
      .split("\n")
      .filter(line => line.includes("maestro test"));
    expect(maestroLines).toHaveLength(1);
    expect(maestroLines[0]).toContain("$MAESTRO_E2E_ARGS");
    expect(maestroLines[0]).toContain("--format junit");
    expect(maestroLines[0]).toContain("${{ inputs.flows_dir }}");
    expect(maestroLines[0].trimEnd().endsWith("\\")).toBe(false);
  });

  it("runs iOS on a macos-15 simulator from the tarball artifact", () => {
    const ios = workflow.jobs.ios;
    expect(ios["runs-on"]).toBe("macos-15");
    const boot = (ios.steps ?? []).find(step =>
      step.run?.includes("xcrun simctl")
    );
    expect(boot?.run).toContain("tar -xzf app-ios.tar.gz");
    expect(boot?.run).toContain("simctl bootstatus");
  });

  it("uploads JUnit reports and debug output even when flows fail", () => {
    for (const job of [workflow.jobs.android, workflow.jobs.ios]) {
      const upload = (job.steps ?? []).find(step =>
        step.uses?.startsWith("actions/upload-artifact")
      );
      expect(upload?.if).toBe("always()");
    }
  });

  it("forwards declared env, secret env, MAESTRO_* vars, and per-platform app ids as -e flags", () => {
    for (const [job, appInput] of [
      [workflow.jobs.android, "android_app_id"],
      [workflow.jobs.ios, "ios_app_id"],
    ] as const) {
      const assemble = (job.steps ?? []).find(step =>
        step.run?.includes("MAESTRO_E2E_ARGS")
      );
      expect(assemble?.env?.MAESTRO_APP_ID).toBe(`\${{ inputs.${appInput} }}`);
      expect(assemble?.env?.E2E_ENV_INPUT).toBe("${{ inputs.maestro_env }}");
      expect(assemble?.env?.E2E_SECRET_ENV_INPUT).toBe(
        "${{ secrets.MAESTRO_SECRET_ENV }}"
      );
      expect(assemble?.run).toContain("grep -o '^MAESTRO_");
      expect(assemble?.run).toContain("--include-tags=$INCLUDE_TAGS");
    }
  });
});

describe("expo maestro-e2e caller template", () => {
  let workflow: CallerWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(CALLER_YML, "utf-8")
    ) as CallerWorkflow;
  });

  it("keeps the production cadence: nightly cron plus on-demand dispatch", () => {
    expect(workflow.on.schedule).toEqual([{ cron: "0 9 * * *" }]);
    const platform = workflow.on.workflow_dispatch?.inputs?.platform;
    expect(platform?.type).toBe("choice");
    expect(platform?.options).toEqual(["all", "android", "ios"]);
  });

  it("serializes runs without cancelling in-flight suites", () => {
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("delegates to the Lisa reusable workflow and forwards the platform picker", () => {
    const job = workflow.jobs.maestro;
    expect(job.uses).toBe(
      "CodySwannGT/lisa/.github/workflows/maestro-native-e2e.yml@main"
    );
    expect(job.with?.platform).toBe("${{ inputs.platform || 'all' }}");
    expect(job.secrets?.EXPO_TOKEN).toBe("${{ secrets.EXPO_TOKEN }}");
    expect(job.secrets?.MAESTRO_SECRET_ENV).toBe(
      "${{ secrets.MAESTRO_SECRET_ENV }}"
    );
  });
});
