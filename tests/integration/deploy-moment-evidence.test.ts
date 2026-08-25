/**
 * The deploy-moment workflow RECORDS what it proved, executed rather than read.
 *
 * The sibling suites prove the wiring and that the gate BITES. Neither answers
 * the question CodySwannGT/lisa#3022 asks, which is what the run leaves behind:
 * a `pre-deploy:production` gate that wants a recent `continuous:staging`
 * result has to resolve against something, and before this the scheduled
 * caller ran its gates and recorded nothing at all.
 *
 * So this file writes both shipped step bodies to disk and runs them under
 * `bash -e`, exactly as GitHub runs a `run:` block, against a throwaway project
 * — and then reads the file the workflow claims to have written. The three
 * cases are the three that decide whether the record can be trusted:
 *
 * - a moment that ran gates records them, bound to its subject;
 * - a moment that declared nothing records an EMPTY list, so the recorder
 *   cannot manufacture evidence for gates that did not run;
 * - a verdict reported with NOTHING recorded FAILS, so a missing record and a
 *   clean record never look the same.
 * @module tests/integration/deploy-moment-evidence
 */

import * as fs from "fs-extra";
import { load as loadYaml } from "js-yaml";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The reusable workflow whose shell is executed here. */
const GATES_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/gates.yml");

/** Where the shipped runner and its resolver live. */
const SCRIPT_DIR = path.join(REPO_ROOT, "all/copy-overwrite/scripts");

/** The scheduled moment whose result a pre-deploy gate is meant to require. */
const CONTINUOUS = "continuous:staging";

/** The moment a stale continuous result must not be able to satisfy. */
const PRE_DEPLOY = "pre-deploy:production";

/**
 * The gate whose whole point is the deploy families.
 *
 * `code-style` would be the obvious fixture and is the wrong one: it is illegal
 * at `continuous`, so the runner REFUSES the configuration and nothing runs.
 * The three deploy-only gates are the ones a continuous moment can actually
 * declare, and this is the one a stack ships a prover for.
 */
const DAST = "runtime-web-vulnerability";

/** The script the registry resolves `security:dast` to on shipped stacks. */
const PROVER = "security:zap";

/** A prover that passes, so the moment's verdict is the run's own. */
const PASSES = "echo scanned";

/** Wall-clock ceiling for one step. A killed child is not a verdict. */
const RUN_TIMEOUT_MS = 60_000;

/** GitHub runs a `run:` block as `bash -e`; the `-e` is load-bearing. */
const SHELL = "/bin/bash";

/** One workflow step, in the shape this suite reads. */
interface Step {
  /** The step's id, if it has one. */
  id?: string;
  /** The shell body. */
  run?: string;
}

/**
 * The shell body of one step, read out of the shipped workflow.
 *
 * Read rather than copied: a copy keeps passing after the workflow it claims
 * to describe is broken, which is the exact shape of an inert guard.
 * @param id The step's `id:`.
 * @returns The step's `run:` script.
 */
function stepScript(id: string): string {
  const workflow = loadYaml(fs.readFileSync(GATES_WORKFLOW, "utf8")) as {
    jobs: Record<string, { steps: Step[] }>;
  };
  const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
  const step = steps.find(candidate => candidate.id === id);
  if (!step?.run) throw new Error(`gates.yml has no step with id \`${id}\``);
  return step.run;
}

let project = "";
let temp = "";

/**
 * Write the throwaway project the steps will run against.
 * @param gates The gates block, or null for no block at all.
 * @param scripts The project's package scripts.
 */
function seed(
  gates: object | null,
  scripts: Record<string, string> = {}
): void {
  fs.mkdirpSync(path.join(project, "scripts"));
  for (const file of ["lisa-gates.mjs", "lisa-run-gates.mjs"]) {
    fs.copySync(
      path.join(SCRIPT_DIR, file),
      path.join(project, "scripts", file)
    );
  }
  fs.copySync(
    path.join(SCRIPT_DIR, "lib"),
    path.join(project, "scripts", "lib")
  );
  fs.writeJsonSync(path.join(project, "package.json"), {
    name: "gate-evidence-fixture",
    private: true,
    scripts,
    version: "1.0.0",
  });
  if (gates !== null) {
    fs.writeJsonSync(path.join(project, ".lisa.config.json"), { gates });
  }
}

/** What running the two shipped step bodies produced. */
interface StepRun {
  /** Exit status of the gate step. */
  gateStatus: number;
  /** Exit status of the recording-verification step. */
  evidenceStatus: number;
  /** Everything the two steps printed, plus the job summary. */
  output: string;
  /** The recorded envelope, or null when none was written. */
  envelope: Record<string, never> | null;
}

/**
 * Run one step body the way GitHub runs it, sharing the outputs file.
 * @param id The step's `id:`.
 * @param moment The moment under test.
 * @param outputs Path to the shared `$GITHUB_OUTPUT` file.
 * @param summary Path to the shared `$GITHUB_STEP_SUMMARY` file.
 * @param extra Extra environment, e.g. the previous step's outputs.
 * @returns The completed child process.
 */
function execute(
  id: string,
  moment: string,
  outputs: string,
  summary: string,
  extra: Record<string, string> = {}
): ReturnType<typeof spawnSync<string>> {
  const script = path.join(project, `${id}-step.sh`);
  fs.writeFileSync(script, stepScript(id));
  return spawnSync(SHELL, ["-e", script], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...process.env,
      GATE_MOMENT: moment,
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: summary,
      RUNNER_TEMP: temp,
      ...extra,
    },
    timeout: RUN_TIMEOUT_MS,
  });
}

/**
 * Read a `key=value` line back out of a `$GITHUB_OUTPUT` file.
 * @param outputs The file path.
 * @param key The output name.
 * @returns The value, or an empty string when unset.
 */
function output(outputs: string, key: string): string {
  const lines = fs.existsSync(outputs)
    ? fs.readFileSync(outputs, "utf8").split("\n")
    : [];
  const hit = lines.filter(line => line.startsWith(`${key}=`)).pop();
  return hit ? hit.slice(key.length + 1) : "";
}

/**
 * Run the gate step and then the recording-verification step, in order.
 *
 * `steps.gates.outputs.*` is passed forward by hand because nothing here is
 * GitHub — that substitution is the one part of the workflow this suite
 * simulates, and it is the part that cannot silently misbehave.
 * @param moment The moment to run.
 * @returns Both statuses, the combined output, and the envelope.
 */
function runMoment(moment: string): StepRun {
  const outputs = path.join(project, "github_output");
  const summary = path.join(project, "github_step_summary");
  const gate = execute("gates", moment, outputs, summary);
  if (gate.signal !== null) {
    throw new Error(`the gate step was KILLED (${gate.signal}).`);
  }
  const evidence = execute("evidence", moment, outputs, summary, {
    GATE_EVIDENCE: output(outputs, "evidence"),
    GATE_RUNNER: output(outputs, "runner"),
    // `steps.gates.outputs.status` is the RUNNER's code, which is NOT the
    // step's exit status: the step routes 78 to exit 0 so a consumer with no
    // gates block is not failed. Simulating this with the step's own status
    // would test wiring GitHub never performs.
    GATE_STATUS: output(outputs, "status"),
  });
  if (evidence.signal !== null) {
    throw new Error(`the evidence step was KILLED (${evidence.signal}).`);
  }
  const recorded = output(outputs, "evidence");
  return {
    envelope:
      recorded && fs.existsSync(recorded) ? fs.readJsonSync(recorded) : null,
    evidenceStatus: evidence.status ?? -1,
    gateStatus: gate.status ?? -1,
    output: [
      gate.stdout,
      gate.stderr,
      evidence.stdout,
      evidence.stderr,
      fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "",
    ].join(""),
  };
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-gate-evidence-ws-"));
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-gate-evidence-tmp-"));
});

afterEach(() => {
  fs.removeSync(project);
  fs.removeSync(temp);
});

describe("a deploy-moment run records what it proved", () => {
  it("records the gate it ran, bound to the moment and the run", () => {
    seed(
      { runner: "npm run", [DAST]: { [CONTINUOUS]: "required" } },
      { [PROVER]: PASSES }
    );

    const run = runMoment(CONTINUOUS);

    expect(run.gateStatus).toBe(0);
    expect(run.evidenceStatus).toBe(0);
    expect(run.envelope?.["schema"]).toBe("lisa.gate-evidence/v1");
    expect(run.envelope?.["gates"]).toHaveLength(1);
    expect(run.envelope?.["contract"]).toMatchObject({
      moment: CONTINUOUS,
      runner: "npm run",
    });
    expect(run.envelope?.["producer"]).toMatchObject({ reused_gates: [] });
    expect(run.output).toContain("recorded 1 observation(s)");
  });

  it("records a blocked moment, so a red is observed rather than absent", () => {
    // The prover prints a recognisable failure signature, so the runner
    // diagnoses a real ASSERTION rather than an undiagnosed exit. That
    // distinction survives into the record: a measured failure is `fail`, and
    // an exit the runner could not read is `unknown` (the case below).
    seed(
      { runner: "npm run", [DAST]: { [CONTINUOUS]: "required" } },
      { [PROVER]: "echo 'Tests  1 failed | 2 passed (3)'; exit 1" }
    );

    const run = runMoment(CONTINUOUS);

    expect(run.gateStatus).toBe(1);
    expect(run.envelope?.["verdict"]).toBe("blocked");
    expect(run.envelope?.["gates"]).toEqual([
      expect.objectContaining({ gate: DAST, status: "fail" }),
    ]);
  });

  it("records an undiagnosable failure as unknown, never as a failure", () => {
    // The runner already refuses to call an unreadable exit a verdict — it
    // prints UNPROVABLE, because `exit 3` with no recognised signature is a
    // fact about the command and not about the property. The record has to
    // carry that same distinction or it re-collapses the two on disk.
    seed(
      { runner: "npm run", [DAST]: { [CONTINUOUS]: "required" } },
      { [PROVER]: "exit 3" }
    );

    const run = runMoment(CONTINUOUS);

    expect(run.gateStatus).toBe(1);
    expect(run.envelope?.["gates"]).toEqual([
      expect.objectContaining({ gate: DAST, status: "unknown" }),
    ]);
  });
});

describe("the workflow hands the runner its own contract", () => {
  it("declares the inputs digest env the runner reads", () => {
    // `toJSON(inputs)` is the whole input context with defaults applied, so
    // nothing here has to be kept in step with the `workflow_call` block by
    // hand. Read out of the shipped workflow: a copy would keep passing after
    // the wiring it describes was removed.
    const workflow = loadYaml(fs.readFileSync(GATES_WORKFLOW, "utf8")) as {
      jobs: Record<
        string,
        { steps: { id?: string; env?: Record<string, string> }[] }
      >;
    };
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
    const gate = steps.find(step => step.id === "gates");

    expect(gate?.env?.["LISA_GATE_EVIDENCE_INPUTS"]).toContain(
      "toJSON(inputs)"
    );
  });

  it("digests the inputs it was handed, which a tree hash cannot carry", () => {
    seed(
      { runner: "npm run", [DAST]: { [CONTINUOUS]: "required" } },
      { [PROVER]: PASSES }
    );
    const outputs = path.join(project, "github_output");
    const summary = path.join(project, "github_step_summary");

    const gate = execute("gates", CONTINUOUS, outputs, summary, {
      LISA_GATE_EVIDENCE_INPUTS: '{"moment":"continuous:staging"}',
    });

    expect(gate.status).toBe(0);
    const envelope = fs.readJsonSync(output(outputs, "evidence")) as {
      contract: { inputs_digest: string | null };
    };
    expect(envelope.contract.inputs_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("the recorder cannot manufacture evidence", () => {
  it("records an empty list for a moment that declared nothing", () => {
    // The negative control. This project declares `code-style` at the
    // continuous moment and NOTHING at the pre-deploy moment, so the
    // pre-deploy envelope must name no gate at all. An envelope that carried
    // the continuous result forward would let evidence about staging satisfy
    // a gate about production — the failure the subject binding exists to
    // prevent, committed by the recorder itself.
    seed(
      { runner: "npm run", [DAST]: { [CONTINUOUS]: "required" } },
      { [PROVER]: PASSES }
    );

    const run = runMoment(PRE_DEPLOY);

    expect(run.gateStatus).toBe(0);
    expect(run.evidenceStatus).toBe(0);
    expect(run.envelope?.["gates"]).toEqual([]);
    expect(run.envelope?.["contract"]).toMatchObject({ moment: PRE_DEPLOY });
    expect(run.output).toContain("recorded 0 observation(s)");
  });
});

describe("a verdict reported with nothing recorded fails", () => {
  it("fails the job when the runner reported a verdict and wrote no envelope", () => {
    seed(
      { runner: "npm run", [DAST]: { [CONTINUOUS]: "required" } },
      { [PROVER]: PASSES }
    );
    const outputs = path.join(project, "github_output");
    const summary = path.join(project, "github_step_summary");
    const gate = execute("gates", CONTINUOUS, outputs, summary);
    expect(gate.status).toBe(0);

    // The one thing a caller must never be able to do: report a clean verdict
    // with no record behind it. Deleting the envelope reproduces exactly that
    // state — a runner that supports recording, a verdict on the record, and
    // nothing on disk.
    fs.removeSync(output(outputs, "evidence"));
    const evidence = execute("evidence", CONTINUOUS, outputs, summary, {
      GATE_EVIDENCE: output(outputs, "evidence"),
      GATE_RUNNER: output(outputs, "runner"),
      GATE_STATUS: output(outputs, "status"),
    });

    expect(evidence.status).toBe(1);
    expect(`${evidence.stdout}${evidence.stderr}`).toContain(
      "Gates recorded nothing"
    );
  });

  it("refuses an envelope whose verdict it does not recognise", () => {
    // The same rule the schema token gets, and for the same reason: a verdict
    // one producer adds would otherwise read as ABSENT to another, and absent
    // is the one thing that must never be mistaken for proved. The vocabulary
    // is imported from the runner that wrote the file, so this also proves the
    // two cannot drift apart.
    seed(
      { runner: "npm run", [DAST]: { [CONTINUOUS]: "required" } },
      { [PROVER]: PASSES }
    );
    const outputs = path.join(project, "github_output");
    const summary = path.join(project, "github_step_summary");
    const gate = execute("gates", CONTINUOUS, outputs, summary);
    expect(gate.status).toBe(0);

    const recorded = output(outputs, "evidence");
    const doc = fs.readJsonSync(recorded) as { verdict: string };
    fs.writeJsonSync(recorded, { ...doc, verdict: "definitely-fine" });

    const evidence = execute("evidence", CONTINUOUS, outputs, summary, {
      GATE_EVIDENCE: recorded,
      GATE_RUNNER: output(outputs, "runner"),
      GATE_STATUS: output(outputs, "status"),
    });

    expect(evidence.status).toBe(1);
    expect(`${evidence.stdout}${evidence.stderr}`).toContain(
      "Gate evidence unreadable"
    );
  });

  it("accepts every verdict its own runner can write", () => {
    // The complement, and the reason the enum is imported rather than
    // restated: a refusal that rejected a value the writer legitimately emits
    // would fail every run at that verdict. `no-gates` is the one a consumer
    // that never adopted the registry produces on every deploy.
    seed(null, {});
    const outputs = path.join(project, "github_output");
    const summary = path.join(project, "github_step_summary");
    const gate = execute("gates", CONTINUOUS, outputs, summary);

    // 78 = NO_GATES on the RUNNER, which the step routes to its own exit 0 so
    // a consumer that never adopted the registry is not failed.
    expect(gate.status).toBe(0);
    expect(output(outputs, "status")).toBe("78");
    const evidence = execute("evidence", CONTINUOUS, outputs, summary, {
      GATE_EVIDENCE: output(outputs, "evidence"),
      GATE_RUNNER: output(outputs, "runner"),
      GATE_STATUS: output(outputs, "status"),
    });

    expect(evidence.status).toBe(0);
    expect(
      fs.readJsonSync(output(outputs, "evidence")) as { verdict: string }
    ).toMatchObject({ verdict: "no-gates" });
  });

  it("does not fail a consumer whose installed runner predates recording", () => {
    // `gates.yml` is referenced `@main`, so a repository picks this step up on
    // merge while its runner comes from its INSTALLED package. Failing that
    // repository would break every consumer that has not bumped, for a change
    // whose entire promise is that it records more.
    seed({ [DAST]: { [CONTINUOUS]: "required" } }, { [PROVER]: "echo ok" });
    const outputs = path.join(project, "github_output");
    const summary = path.join(project, "github_step_summary");
    const old = path.join(project, "old-runner.mjs");
    fs.writeFileSync(old, "// a runner with no evidence support\n");

    const evidence = execute("evidence", CONTINUOUS, outputs, summary, {
      GATE_EVIDENCE: path.join(temp, "absent.json"),
      GATE_RUNNER: old,
      GATE_STATUS: "0",
    });

    expect(evidence.status).toBe(0);
    expect(`${evidence.stdout}${evidence.stderr}`).toContain(
      "Runner too old to record evidence"
    );
  });
});
