/**
 * Behavioral tests — these EXECUTE the workflow's own shell, pulled verbatim
 * out of the YAML, rather than asserting that certain strings appear in it.
 *
 * A detector that is only asserted to exist is a detector nobody has ever seen
 * fire. Each block below therefore runs the same script twice under conditions
 * that must produce OPPOSITE outcomes: the zero-flow assertion must fire on a
 * run that tested nothing AND stand down on a run with twenty flow failures;
 * the driver retry must re-run the suite after a driver timeout AND refuse to
 * re-run it after an ordinary flow failure. Delete either guard and the
 * matching negative case starts failing — which is the only thing that proves
 * the guard is load-bearing.
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

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  shell?: string;
  uses?: string;
  if?: string;
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
      inputs?: Record<string, { default?: unknown; type?: string }>;
    };
  };
  jobs: Record<string, WorkflowJob>;
}

describe("maestro-native-e2e zero-flow detector (executed)", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  /**
   * The verbatim `run:` text of a named step — never a copy of it.
   * @param jobName - Which platform job to read the step from
   * @param namePart - Substring of the step's `name:`
   * @returns The step's shell script exactly as CI will run it
   */
  const stepScript = (jobName: "android" | "ios", namePart: string): string => {
    const step = (workflow.jobs[jobName].steps ?? []).find(candidate =>
      candidate.name?.includes(namePart)
    );
    if (!step?.run) {
      throw new Error(`no step matching "${namePart}" in job ${jobName}`);
    }
    return step.run;
  };

  /**
   * Runs the real Count + Assert steps back to back against a fixture report,
   * exactly as the job chains them through `steps.flows.outputs`.
   * @param platform - Which arm's steps to execute
   * @param report - JUnit report contents, or null to omit the file entirely
   * @returns The counted flows, the assertion's exit status, and its output
   */
  const detect = async (
    platform: "android" | "ios",
    report: string | null
  ): Promise<{ executed: string; status: number; output: string }> => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-zeroflow-"));
    try {
      if (report !== null) {
        await fs.writeFile(
          path.join(dir, `maestro-${platform}-report.xml`),
          report
        );
      }
      const outputs = path.join(dir, "outputs");
      const summary = path.join(dir, "summary");
      await fs.writeFile(outputs, "");
      await fs.writeFile(summary, "");

      const env = {
        ...process.env,
        GITHUB_OUTPUT: outputs,
        GITHUB_STEP_SUMMARY: summary,
      };
      boundedExecFileSync({
        label: "the count-executed-flows step",
        command: BASH,
        args: [
          "-eo",
          "pipefail",
          "-c",
          stepScript(platform, "Count executed flows"),
        ],
        cwd: dir,
        env,
      });
      const parsed = Object.fromEntries(
        (await fs.readFile(outputs, "utf-8"))
          .split("\n")
          .filter(Boolean)
          .map(line => line.split("=") as [string, string])
      );

      try {
        const stdout = boundedExecFileSync({
          label: "the assert-flows-executed step",
          command: BASH,
          args: [
            "-eo",
            "pipefail",
            "-c",
            stepScript(platform, "Assert flows executed"),
          ],
          cwd: dir,
          env: {
            ...env,
            REPORT_PRESENT: parsed.report_present,
            EXECUTED: parsed.executed,
          },
        });
        return { executed: parsed.executed, status: 0, output: stdout };
      } catch (error) {
        const failure = error as { exitCode?: number | null; stdout?: string };
        return {
          executed: parsed.executed,
          status: failure.exitCode ?? -1,
          output: failure.stdout ?? "",
        };
      }
    } finally {
      await fs.remove(dir);
    }
  };

  /**
   * A JUnit report fixture.
   * @param count - How many `<testcase` elements to emit
   * @param failures - The `failures=` attribute to record
   * @returns The report XML
   */
  const junit = (count: number, failures: number): string =>
    [
      `<testsuites>`,
      `  <testsuite name="Test Suite" tests="${count}" failures="${failures}">`,
      ...Array.from(
        { length: count },
        (_unused, index) => `    <testcase name="flow-${index}" />`
      ),
      `  </testsuite>`,
      `</testsuites>`,
    ].join("\n");

  for (const platform of ["android", "ios"] as const) {
    it(`${platform}: FIRES when the report is absent — the TUN-572 shape`, async () => {
      const result = await detect(platform, null);
      expect(result.executed).toBe("0");
      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `::error title=ZERO FLOWS EXECUTED (${platform})::`
      );
      expect(result.output).toContain("TESTED NOTHING");
    });

    it(`${platform}: FIRES when a report exists but records no testcase`, async () => {
      const result = await detect(platform, junit(0, 0));
      expect(result.executed).toBe("0");
      expect(result.status).toBe(1);
      expect(result.output).toContain("ZERO FLOWS EXECUTED");
    });

    it(`${platform}: STANDS DOWN on an ordinary red — 83 flows, 20 failures`, async () => {
      // The discrimination this whole ticket is about: a night with genuine
      // flow failures must NOT be reported as a night that tested nothing.
      const result = await detect(platform, junit(83, 20));
      expect(result.executed).toBe("83");
      expect(result.status).toBe(0);
      expect(result.output).not.toContain("ZERO FLOWS");
      expect(result.output).toContain("executed 83 flow(s)");
    });

    it(`${platform}: STANDS DOWN on a fully green run`, async () => {
      const result = await detect(platform, junit(83, 0));
      expect(result.executed).toBe("83");
      expect(result.status).toBe(0);
    });
  }
});

describe("maestro-native-e2e zero-flow contract", () => {
  let workflow: ReusableWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  it("makes an ABSENT JUnit report an error instead of a quiet upload", () => {
    for (const [job, platform] of [
      [workflow.jobs.android, "android"],
      [workflow.jobs.ios, "ios"],
    ] as const) {
      const reportUpload = (job.steps ?? []).find(
        step => step.with?.name === `maestro-${platform}-report`
      );
      // Report-only path. Pointing `if-no-files-found: error` at the COMBINED
      // report+debug path would be a placebo: `error` fires only when nothing
      // in the path matched, and the failure this guards against
      // (AcmeOrgD/frontend run 31584986248) had a populated `maestro-debug/`
      // and only the report missing.
      expect(reportUpload?.with?.path).toBe(`maestro-${platform}-report.xml`);
      expect(reportUpload?.with?.["if-no-files-found"]).toBe("error");
      expect(reportUpload?.if).toBe("${{ !cancelled() }}");

      const debugUpload = (job.steps ?? []).find(
        step => step.with?.name === `maestro-${platform}-results`
      );
      const debugPath = String(debugUpload?.with?.path ?? "");
      expect(debugPath).toContain(`maestro-${platform}-report.xml`);
      expect(debugPath).toContain("maestro-debug");
    }
  });

  it("fails an arm that executed ZERO flows with a message naming zero-flow execution", () => {
    for (const [job, platform] of [
      [workflow.jobs.android, "android"],
      [workflow.jobs.ios, "ios"],
    ] as const) {
      const assert = (job.steps ?? []).find(step =>
        step.name?.includes("Assert flows executed")
      );
      expect(assert, `${platform} arm has no zero-flow assertion`).toBeTruthy();
      // A suite CANCELLED at the job timeout has usually run many flows and
      // simply never wrote its report; calling that "tested nothing" would be
      // a lie, so the assertion deliberately stands down on cancellation.
      expect(assert?.if).toBe("${{ !cancelled() }}");
      expect(assert?.run).toContain(
        `::error title=ZERO FLOWS EXECUTED (${platform})::`
      );
      expect(assert?.run).toContain("TESTED NOTHING");
      expect(assert?.run).toContain("NOT an ordinary flow failure");
    }
  });

  it("publishes each arm's executed-flow count in the artifact NAME", () => {
    for (const [job, platform] of [
      [workflow.jobs.android, "android"],
      [workflow.jobs.ios, "ios"],
    ] as const) {
      const count = (job.steps ?? []).find(step =>
        step.name?.includes("Count executed flows")
      );
      expect(count?.id).toBe("flows");
      expect(count?.run).toContain("executed=");

      const publish = (job.steps ?? []).find(step =>
        step.name?.includes("Publish executed-flow count")
      );
      // The count lives in the NAME so a downstream gate reads it from the
      // artifacts LIST — one API call, no download of a ~40 MB debug bundle —
      // and so it survives the payload's retention window.
      expect(publish?.with?.name).toBe(
        `maestro-${platform}-flowcount-\${{ steps.flows.outputs.executed }}`
      );
    }
  });

  it("prints the resolved Maestro version to the JOB LOG, not only the debug artifact", () => {
    for (const job of [workflow.jobs.android, workflow.jobs.ios]) {
      const report = (job.steps ?? []).find(step =>
        step.name?.includes("Report toolchain versions")
      );
      expect(report?.run).toContain("maestro --version");
      expect(report?.run).toContain("$GITHUB_STEP_SUMMARY");
    }
    const iosReport = (workflow.jobs.ios.steps ?? []).find(step =>
      step.name?.includes("Report toolchain versions")
    );
    // The `macos-15` image is re-rolled underneath callers, so a CLI-version
    // correlation is unreadable without the Xcode and simulator OS beside it.
    expect(iosReport?.run).toContain("xcodebuild -version");
    expect(iosReport?.run).toContain("IOS_SIM_OS");
  });

  it("keeps the Maestro CLI unpinned by default while making a pin a one-liner", () => {
    const inputs = workflow.on.workflow_call?.inputs ?? {};
    // Deliberately empty: one bad night is not a measurement, and pinning on
    // it would be an assumption dressed as a fix.
    expect(inputs.maestro_version?.default).toBe("");
    for (const job of [workflow.jobs.android, workflow.jobs.ios]) {
      const install = (job.steps ?? []).find(step =>
        step.name?.includes("Install Maestro")
      );
      expect(install?.env?.MAESTRO_VERSION_PIN).toBe(
        "${{ inputs.maestro_version }}"
      );
      expect(install?.run).toContain(
        'export MAESTRO_VERSION="$MAESTRO_VERSION_PIN"'
      );
    }
  });

  it("gives iOS driver startup an explicit budget and one retry, without retrying flow failures", () => {
    const inputs = workflow.on.workflow_call?.inputs ?? {};
    expect(inputs.ios_driver_startup_timeout_ms?.default).toBe(240000);

    const run = (workflow.jobs.ios.steps ?? []).find(step =>
      step.name?.includes("Run Maestro flows on simulator")
    );
    expect(run?.env?.MAESTRO_DRIVER_STARTUP_TIMEOUT).toBe(
      "${{ inputs.ios_driver_startup_timeout_ms }}"
    );
    // Without an explicit `shell: bash` the default is `bash -e` WITHOUT
    // pipefail, and every suite invocation is piped into `tee` — the status
    // read would be tee's (always 0) and a failed suite would report success.
    expect(run?.shell).toBe("bash");
    expect(run?.run).toContain("IOSDriverTimeoutException");
    expect(run?.run).toContain("not retrying");
    // Exactly two attempts: a blanket retry would double a four-hour suite
    // every time one assertion reds.
    expect(run?.run).toContain("maestro-ios-run-1.log");
    expect(run?.run).toContain("maestro-ios-run-2.log");
    expect(run?.run).not.toContain("maestro-ios-run-3.log");
  });
});
