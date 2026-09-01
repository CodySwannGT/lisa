/**
 * Proves `optional` is NON-BLOCKING, by running the façade's declared path.
 *
 * `quality.yml` used to collapse the two live levels into one boolean: the
 * resolve step wrote `configured=true` for `required` and for `optional`
 * alike, every downstream `if:` read that boolean, and nothing carried a
 * `continue-on-error` keyed on a level. A gate a maintainer declared
 * `optional` — "show me the red, do not block on it" — therefore failed this
 * reusable workflow exactly as a `required` one did, which fails the caller's
 * `release` job, which leaves every job sequenced after `release` SKIPPED. A
 * skipped job renders the way a passing one does, so `optional` did not merely
 * fail to work: it did the opposite of what it says, silently.
 *
 * Every assertion here runs the shipped text. The resolve block, each step's
 * `if:`, and the `continue-on-error` expression are pulled out of the workflow
 * verbatim; the harness supplies only GitHub's rules for combining them. A
 * test that string-matched for `continue-on-error` would pass against a
 * workflow that keyed it on an output nothing sets.
 * @module tests/integration/quality-gate-optional-level
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorkflowStep } from "../helpers/workflow-test-utils.js";

import {
  GATES_SCRIPT,
  resolveStep,
  stepNamed,
} from "./quality-gate-facade-fixture.js";
import {
  evaluateExpression,
  runResolve,
  runStep,
} from "./quality-gate-level-harness.js";
import type { StepContext } from "./quality-gate-level-harness.js";

/** The façade job standing in for all thirty copies of the same block. */
const JOB_ID = "lint";

/** The gate that job resolves. */
const GATE_ID = "code-style";

/** The step that runs the project's own prover. */
const GATE_STEP = "🧹 Run the code-style gate";

/** The step that keeps a non-blocking failure visible. */
const REPORT_STEP = "🟡 Report the optional gate that failed";

/** The step id both of those are wired through. */
const RUN_ID = "gate_run";

/** The moment the fixture configs declare their gate at. */
const MOMENT = "pull-request";

/** Where the façade looks for a project-local resolver. */
const RESOLVER_RELATIVE = path.join("scripts", "lisa-gates.mjs");

/** A prover that fails, so the gate has a red verdict to report. */
const FAILING_TASK = "fail.mjs";

/** A prover that passes, so the other direction is measured too. */
const PASSING_TASK = "pass.mjs";

/**
 * One step the façade must have, named in the failure when it does not.
 * @param step The step, or undefined.
 * @param what What was being looked for.
 * @returns The step.
 */
function required(step: WorkflowStep | undefined, what: string): WorkflowStep {
  if (step === undefined) {
    throw new Error(
      `${JOB_ID} must have ${what}. Every façade job carries the same steps, ` +
        "so a missing one is a rename or a deletion, not a local quirk."
    );
  }
  return step;
}

describe("a gate declared optional does not block", () => {
  let workdir = "";

  beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), "gate-level-"));
    await fs.ensureDir(path.join(workdir, "scripts"));
    await fs.copy(GATES_SCRIPT, path.join(workdir, RESOLVER_RELATIVE));
    // The resolver imports a sibling helper, so a lone copy cannot start.
    await fs.copy(
      path.join(path.dirname(GATES_SCRIPT), "lib"),
      path.join(workdir, "scripts", "lib")
    );
    await fs.writeFile(
      path.join(workdir, FAILING_TASK),
      'console.error("the property does not hold"); process.exit(1);\n'
    );
    await fs.writeFile(path.join(workdir, PASSING_TASK), "");
  });

  afterEach(async () => {
    await fs.remove(workdir);
  });

  /**
   * Declares the gate at one level with one prover.
   * @param level The declared level.
   * @param task The prover the declaration names.
   */
  async function declare(level: string, task = FAILING_TASK): Promise<void> {
    await fs.writeJson(path.join(workdir, ".lisa.config.json"), {
      gates: { runner: "node", [GATE_ID]: { [MOMENT]: { level, run: task } } },
    });
  }

  /**
   * Runs the façade's declared path end to end.
   *
   * Resolve, then the gate step under its own `if:` and `continue-on-error`,
   * then the report step under its own `if:` — each expression taken from the
   * workflow and evaluated against what the previous step actually produced.
   * @returns What the job would report, and what an operator would see.
   */
  function runDeclaredPath(): {
    resolved: Record<string, string>;
    gateRan: boolean;
    jobFailed: boolean;
    reported: boolean;
    annotation: string;
    summary: string;
  } {
    // The resolve and gate steps must exist — every other façade job has them
    // and this one stands in for all of them. The REPORT step deliberately
    // need not: its absence is a legitimate reading of the workflow ("nothing
    // reports"), and each test below asserts the outcome that absence
    // produces. Demanding it here would turn every behavioural assertion into
    // an assertion that a step exists, which is the weaker claim and the one
    // that keeps passing once someone adds a step that reports nothing.
    const resolve = required(resolveStep(JOB_ID), "a resolve step");
    const gate = required(stepNamed(JOB_ID, GATE_STEP), GATE_STEP);
    const report = stepNamed(JOB_ID, REPORT_STEP);
    const resolved = runResolve(resolve, {
      cwd: workdir,
      env: {
        ...process.env,
        GATE_ID,
        GATE_MOMENT: MOMENT,
        FALLBACK_RUNNER: "npm run",
      } as Record<string, string>,
    }).outputs;
    const beforeGate: StepContext = {
      outputs: { gate: resolved },
      outcomes: {},
    };
    const gateRan = evaluateExpression(String(gate.if ?? ""), beforeGate);
    // Absent means blocking and a YAML `true` means never blocking, exactly as
    // GitHub reads them. Only an expression is evaluated, so a workflow that
    // carried no `continue-on-error` at all is simulated as what it is rather
    // than erroring out — the failure then lands on the outcome assertion,
    // which is the claim under test.
    const declared = (gate as Record<string, unknown>)["continue-on-error"];
    const continueOnError =
      declared === undefined
        ? false
        : typeof declared === "boolean"
          ? declared
          : evaluateExpression(String(declared), beforeGate);
    const ran = gateRan
      ? runStep(gate, {
          cwd: workdir,
          env: {
            ...process.env,
            GATE_RUNNER: resolved.runner ?? "",
            GATE_TASK: resolved.task ?? "",
          } as Record<string, string>,
          continueOnError,
        })
      : null;
    const afterGate: StepContext = {
      outputs: beforeGate.outputs,
      outcomes: ran === null ? {} : { [RUN_ID]: ran.outcome },
    };
    const reported =
      report !== undefined &&
      evaluateExpression(String(report.if ?? ""), afterGate);
    const reportRun = reported
      ? runStep(report, {
          cwd: workdir,
          env: {
            ...process.env,
            GATE_ID: resolved.gate ?? "",
            GATE_MOMENT: MOMENT,
          } as Record<string, string>,
          continueOnError: false,
        })
      : null;
    return {
      resolved,
      gateRan,
      jobFailed: ran?.conclusion === "failure",
      reported,
      annotation: reportRun?.stdout ?? "",
      summary: reportRun?.summary ?? "",
    };
  }

  it("resolves the declared level rather than collapsing it to a boolean", async () => {
    await declare("optional");

    const { resolved } = runDeclaredPath();

    expect(resolved.configured).toBe("true");
    expect(resolved.level).toBe("optional");
  });

  it("does not fail the job when an optional gate's prover fails", async () => {
    await declare("optional");

    const { gateRan, jobFailed } = runDeclaredPath();

    // The gate RAN — this is not the `off` path wearing a different name.
    expect(gateRan).toBe(true);
    expect(jobFailed).toBe(false);
  });

  it("still reports the failure an optional gate did not block on", async () => {
    await declare("optional");

    const { reported, annotation, summary } = runDeclaredPath();

    expect(reported).toBe(true);
    // Non-blocking, not invisible: an annotation an operator sees on the run,
    // and a line in the summary that survives however the UI renders a step
    // that continued on error.
    expect(annotation).toContain("::warning");
    expect(annotation).toContain(GATE_ID);
    expect(summary).toContain(GATE_ID);
    expect(summary).toContain("optional");
  });

  it("still fails the job when a required gate's prover fails", async () => {
    await declare("required");

    const { resolved, gateRan, jobFailed, reported } = runDeclaredPath();

    expect(resolved.level).toBe("required");
    expect(gateRan).toBe(true);
    expect(jobFailed).toBe(true);
    // The optional report is for the level that asked for it, and only that
    // level. A fix that reported here would be describing a blocked run as a
    // tolerated one.
    expect(reported).toBe(false);
  });

  it("passes an optional gate whose prover passes, with nothing to report", async () => {
    await declare("optional", PASSING_TASK);

    const { jobFailed, reported } = runDeclaredPath();

    expect(jobFailed).toBe(false);
    expect(reported).toBe(false);
  });

  it("runs nothing and proves nothing when the gate is declared off", async () => {
    await declare("off");

    const { resolved, gateRan, jobFailed, reported } = runDeclaredPath();

    expect(resolved.configured).toBe("off");
    expect(resolved.level).toBe("off");
    expect(gateRan).toBe(false);
    expect(jobFailed).toBe(false);
    expect(reported).toBe(false);
  });

  it("refuses a level that is not one of the three", async () => {
    // Fail closed. `.lisa.config.json` is a file a pull request can edit, and
    // the level now reaches `$GITHUB_OUTPUT` and decides whether a gate
    // blocks. A value nobody defined must be loud, not silently strict or
    // silently lax.
    await declare("advisory");

    const resolve = required(resolveStep(JOB_ID), "a resolve step");
    const { status, text } = runResolve(resolve, {
      cwd: workdir,
      env: {
        ...process.env,
        GATE_ID,
        GATE_MOMENT: MOMENT,
        FALLBACK_RUNNER: "npm run",
      } as Record<string, string>,
    });

    expect(status).not.toBe(0);
    expect(text).toContain("::error");
    expect(text).toContain("advisory");
  });
});
