/**
 * Behavioral tests for the flake-classification step — the shell is pulled
 * verbatim out of the workflow YAML and EXECUTED, in the same spirit as the
 * zero-flow and driver-retry suites beside this file.
 *
 * The property under test is a negative one, which is exactly the kind that
 * rots unwatched: this step must be incapable of changing the job's outcome.
 * So each case runs the real step script under a condition that would fail an
 * ordinary step — a classifier that exits non-zero, a classifier that is not
 * installed, a report that was never written — and asserts exit 0 every time.
 * Delete the `|| true`, the missing-file guard, or the trailing `exit 0` and
 * one of these starts failing, which is the only thing that proves those
 * absorbers are load-bearing rather than decorative.
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
const SCRIPTS_DIR = "scripts";
const CLASSIFIER_FILE = "classify-maestro-failures.mjs";
const CLASSIFIER_SRC = path.join(
  REPO_ROOT,
  "expo",
  "copy-overwrite",
  SCRIPTS_DIR,
  CLASSIFIER_FILE
);

/**
 * The DIRECTORIES the classifier reaches into for its modules.
 *
 * Installed alongside it because the scratch project is a real vendored
 * checkout, not a stub: without them node fails the import outright, and the
 * step reads back as a classifier that found nothing rather than one that could
 * not start.
 *
 * Directories, not files. This listed `lib/invoked-as-script.mjs` and
 * `bdd/markdown-cell.mjs` by name, and a list is a second, silent copy of the
 * classifier's import set that goes stale the moment the classifier imports a
 * third sibling — reporting clean the whole time it is wrong, then failing as
 * an ERR_MODULE_NOT_FOUND that reads as the published package missing a file.
 * CodySwannGT/lisa#3082.
 */
const CLASSIFIER_DEPENDENCY_DIRS = ["lib", "bdd"];

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** Shape of a single step inside a workflow job's `steps:` list. */
interface WorkflowStep {
  name?: string;
  run?: string;
  shell?: string;
  if?: string;
  "continue-on-error"?: boolean;
  env?: Record<string, string>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
interface WorkflowJob {
  steps?: WorkflowStep[];
}

/** Root shape of the parsed reusable workflow. */
interface ReusableWorkflow {
  jobs: Record<string, WorkflowJob>;
}

/** Result of executing a step's shell in a scratch directory. */
interface RunOutcome {
  readonly status: number;
  readonly output: string;
  readonly summary: string;
}

let workflow: ReusableWorkflow;

/**
 * Locate the classification step inside one platform job.
 * @param job - Job name (`android` or `ios`)
 * @returns The parsed step
 */
function classificationStep(job: string): WorkflowStep {
  const step = workflow.jobs[job]?.steps?.find(candidate =>
    candidate.name?.includes("Classify Maestro failures")
  );
  if (!step) throw new Error(`no classification step in job ${job}`);
  return step;
}

/**
 * Execute a step's `run:` under `bash -eo pipefail`, which is exactly what
 * GitHub Actions uses for `shell: bash`. Running it under a laxer shell would
 * prove nothing about the shell CI actually uses.
 * @param step - The workflow step
 * @param workdir - Scratch directory to run in
 * @returns Exit status, combined output, and the step-summary contents
 */
function runStep(step: WorkflowStep, workdir: string): RunOutcome {
  const script = path.join(workdir, "step.sh");
  const summaryFile = path.join(workdir, "summary.md");
  let status = 0;
  let output = "";
  fs.writeFileSync(script, step.run ?? "");
  fs.writeFileSync(summaryFile, "");
  try {
    output = boundedExecFileSync({
      label: `the "${step.name ?? "unnamed"}" workflow step`,
      command: BASH,
      args: ["-eo", "pipefail", script],
      cwd: workdir,
      env: {
        ...process.env,
        ...step.env,
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    });
  } catch (error) {
    const failure = error as { exitCode?: number | null; stdout?: string };
    status = failure.exitCode ?? 1;
    output = failure.stdout ?? "";
  }
  return { status, output, summary: fs.readFileSync(summaryFile, "utf-8") };
}

/** Closing tag of a `<testcase>` whose body carried a failure element. */
const CASE_END = "</testcase>";

/** A report with one preamble loss and one product failure. */
const REPORT_XML = [
  "<testsuites><testsuite>",
  '<testcase file=".maestro/flows/ok.yaml" time="10.5" status="SUCCESS"/>',
  '<testcase file=".maestro/flows/card-detail.yaml" time="105.6" status="ERROR">',
  "<failure>Assertion is false: id: landing:screen is visible</failure>",
  CASE_END,
  '<testcase file=".maestro/flows/checkout.yaml" time="42" status="ERROR">',
  "<failure>Assertion is false: id: checkout:total is visible</failure>",
  CASE_END,
  "</testsuite></testsuites>",
].join("\n");

const SIGN_IN_FLOW = [
  "- extendedWaitUntil:",
  "    visible:",
  "      id: 'landing:screen'",
  "    timeout: 90000",
  "- tapOn:",
  "    id: 'landing:sign-in'",
  "",
].join("\n");

/** Which classifier a scratch checkout carries. */
type ClassifierKind = "real" | "failing" | "absent";

/**
 * A red report whose only failing flow carries a BLANK `<failure>` element.
 *
 * This is the shape the measured `DeviceServerDiedException` loss arrived in,
 * and it is the case the whole device column exists for: there is no string to
 * match, so anything reading the failure text sees nothing at all.
 */
const BLANK_FAILURE_XML = [
  "<testsuites><testsuite>",
  '<testcase file=".maestro/flows/ok.yaml" time="10.5" status="SUCCESS"/>',
  '<testcase file=".maestro/flows/checkout.yaml" time="42" status="ERROR">',
  "<failure></failure>",
  CASE_END,
  "</testsuite></testsuites>",
].join("\n");

/** One file to plant in the scratch checkout's Maestro debug tree. */
interface DebugArtifactFixture {
  /** Basename, as Maestro writes it. */
  readonly name: string;
  /** Contents the classifier will scan for markers. */
  readonly text: string;
}

/**
 * Build a scratch project checkout the step can run against.
 * @param options - Which pieces to install
 * @param options.classifier - The shipped script, a script that exits 3, or none
 * @param options.report - JUnit report to write, or omit to write none
 * @param options.debugArtifact - Artifact to write into `maestro-debug/.maestro/`
 * @returns Absolute path of the scratch directory
 */
function scratchProject(options: {
  classifier?: ClassifierKind;
  report?: string;
  debugArtifact?: DebugArtifactFixture;
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-classify-"));
  const installedClassifier = path.join(dir, SCRIPTS_DIR, CLASSIFIER_FILE);
  const flowsDir = path.join(dir, ".maestro", "flows");
  fs.ensureDirSync(path.join(dir, SCRIPTS_DIR));
  if (options.classifier === "real") {
    fs.copySync(CLASSIFIER_SRC, installedClassifier);
    for (const bucket of CLASSIFIER_DEPENDENCY_DIRS) {
      fs.copySync(
        path.join(REPO_ROOT, "expo", "copy-overwrite", SCRIPTS_DIR, bucket),
        path.join(dir, SCRIPTS_DIR, bucket)
      );
    }
    fs.ensureDirSync(flowsDir);
    fs.writeFileSync(
      path.join(flowsDir, "card-detail.yaml"),
      "- runFlow: sign-in.yaml\n"
    );
    fs.writeFileSync(path.join(flowsDir, "sign-in.yaml"), SIGN_IN_FLOW);
  } else if (options.classifier === "failing") {
    fs.writeFileSync(
      installedClassifier,
      'process.stderr.write("boom\\n");\nprocess.exit(3);\n'
    );
  }
  if (options.report !== undefined) {
    fs.writeFileSync(
      path.join(dir, "maestro-android-report.xml"),
      options.report
    );
  }
  if (options.debugArtifact) {
    // Under `.maestro/`, a HIDDEN directory, because that is where Maestro
    // actually puts them — the same fact the artifact upload's
    // `include-hidden-files` exists for.
    const debugDir = path.join(dir, "maestro-debug", ".maestro");
    fs.ensureDirSync(debugDir);
    fs.writeFileSync(
      path.join(debugDir, options.debugArtifact.name),
      options.debugArtifact.text
    );
  }
  return dir;
}

describe("maestro-native-e2e flake classification (executed)", () => {
  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as ReusableWorkflow;
  });

  it("is declared non-gating on both arms", () => {
    for (const job of ["android", "ios"]) {
      const step = classificationStep(job);
      expect(step["continue-on-error"]).toBe(true);
      expect(step.shell).toBe("bash");
      // `!cancelled()` and not `success()`: the classification is at its most
      // useful precisely on the runs where the suite already went red.
      expect(step.if).toContain("!cancelled()");
    }
  });

  it("reads the report its own arm wrote, never the other arm's", () => {
    expect(classificationStep("android").env?.MAESTRO_REPORT).toBe(
      "maestro-android-report.xml"
    );
    expect(classificationStep("android").env?.MAESTRO_PLATFORM).toBe("android");
    expect(classificationStep("ios").env?.MAESTRO_REPORT).toBe(
      "maestro-ios-report.xml"
    );
    expect(classificationStep("ios").env?.MAESTRO_PLATFORM).toBe("ios");
  });

  it("exits 0 and separates preamble from product on a real red report", () => {
    const dir = scratchProject({ classifier: "real", report: REPORT_XML });
    const outcome = runStep(classificationStep("android"), dir);
    expect(outcome.status).toBe(0);
    expect(outcome.summary).toContain("1 product");
    expect(outcome.summary).toContain("1 preamble");
    // The preamble loss names its gate and the time it took to REACH it:
    // 105.6s duration minus the gate's 90s ceiling.
    expect(outcome.summary).toContain("landing:screen");
    expect(outcome.summary).toContain("15.6s");
    // And it says out loud that it decides nothing.
    expect(outcome.summary).toContain("never changes the result of any gate");
  });

  it("exits 0 when the classifier itself blows up", () => {
    const dir = scratchProject({ classifier: "failing", report: REPORT_XML });
    const outcome = runStep(classificationStep("android"), dir);
    expect(outcome.status).toBe(0);
  });

  it("exits 0 when the repository has not picked up the classifier yet", () => {
    const dir = scratchProject({ classifier: "absent", report: REPORT_XML });
    const outcome = runStep(classificationStep("android"), dir);
    expect(outcome.status).toBe(0);
    expect(outcome.output).toContain("skipping flake classification");
  });

  it("exits 0 when the suite never wrote a report at all", () => {
    const dir = scratchProject({ classifier: "real" });
    const outcome = runStep(classificationStep("android"), dir);
    expect(outcome.status).toBe(0);
    expect(outcome.output).toContain("to classify");
  });

  it("names the device column on a blank <failure> the report cannot explain", () => {
    // End to end through the real step shell: a failure element with NO text,
    // and the only account of what happened sitting in the debug tree. This is
    // the measured `DeviceServerDiedException` case.
    const dir = scratchProject({
      classifier: "real",
      report: BLANK_FAILURE_XML,
      debugArtifact: {
        name: "commands-(checkout).json",
        text: '{"error":"maestro.android.DeviceServerDiedException: server died"}',
      },
    });
    const outcome = runStep(classificationStep("android"), dir);
    expect(outcome.status).toBe(0);
    expect(outcome.summary).toContain("1 device");
    expect(outcome.summary).toContain("0 product");
    expect(outcome.summary).toContain("checkout.yaml");
    expect(outcome.summary).toContain("DeviceServerDiedException");
  });

  it("leaves the same failure in the product column with no debug tree", () => {
    // The negative half of the case above, and the reason the device verdict
    // cannot be coming from the report: identical XML, no run evidence, no
    // device verdict. The flow is still REPORTED, which it was not before —
    // a blank `<failure>` used to be dropped from the summary entirely.
    const dir = scratchProject({
      classifier: "real",
      report: BLANK_FAILURE_XML,
    });
    const outcome = runStep(classificationStep("android"), dir);
    expect(outcome.status).toBe(0);
    expect(outcome.summary).toContain("0 device");
    expect(outcome.summary).toContain("1 product");
    expect(outcome.summary).toContain("checkout.yaml");
    expect(outcome.summary).toContain("(no failure text)");
  });

  it("is never read by the suite driver, so retry cannot depend on it", () => {
    // Per-flow retry is keyed on WHICH flow failed and never on why. A device
    // classifier feeding that decision would reintroduce the too-narrow regex
    // the driver's own comment block rejects, so the structural fact is
    // asserted rather than trusted: no step before the classification step
    // mentions the classifier, and the classification step is last of them.
    for (const job of ["android", "ios"]) {
      const steps = workflow.jobs[job]?.steps ?? [];
      const classifyIndex = steps.findIndex(step =>
        step.name?.includes("Classify Maestro failures")
      );
      expect(classifyIndex).toBeGreaterThan(-1);
      const mentions = steps
        .map((step, index) => ({ index, step }))
        .filter(
          entry =>
            entry.step.run?.includes(CLASSIFIER_FILE) ||
            Object.values(entry.step.env ?? {}).some(value =>
              String(value).includes(CLASSIFIER_FILE)
            )
        )
        .map(entry => entry.index);
      expect(mentions).toEqual([classifyIndex]);
    }
  });
});
