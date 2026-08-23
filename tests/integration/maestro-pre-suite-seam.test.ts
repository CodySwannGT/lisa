/**
 * The `pre_suite_command` seam — execution counts, proved by simulation.
 *
 * The defect this closes: `setup_command` runs inside BOTH platform jobs, and
 * those jobs are siblings with no edge between them, so it executes twice,
 * CONCURRENTLY. Adopters had already put a destructive sweep and a conditional
 * seeder ("does any record have line items? if not, create one") behind it — a
 * read-modify-write evaluated from two runners against the same pre-write
 * state, which can seed twice or seed two different records, after which the
 * two legs test against different fixtures.
 *
 * Asserting that a job named `pre_suite` exists proves nothing about how many
 * times its command runs. So these tests simulate the workflow's own job graph
 * — matrix fan-out, `needs` edges, job and step guards — and COUNT the
 * executions, running the preflight step's real shell to get the outputs the
 * simulation starts from.
 *
 * The counts are the contract:
 *   platform=all     → pre_suite_command × 1,  setup_command × 2
 *   platform=android → pre_suite_command × 1,  setup_command × 1
 *   platform=ios     → pre_suite_command × 1,  setup_command × 1
 *   pre_suite failed → no platform leg starts  (fail closed)
 *
 * The `setup_command × 2` line is not a bug being enshrined — it is the
 * documented meaning of the per-leg seam, and precisely why mutation must not
 * live there. It is asserted so a later change that silently collapses the two
 * seams into one behaviour gets caught.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import {
  simulateRun,
  type JobResult,
  type SimulatedWorkflow,
} from "../helpers/workflow-job-graph";

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

const ANDROID = "android";
const IOS = "ios";
const PLATFORM_JOBS = [ANDROID, IOS];
const PRE_SUITE = "pre_suite";
const PRE_SUITE_INPUT = "pre_suite_command";
const SETUP_INPUT = "setup_command";
const RESULT_ALLOWLIST = `contains(fromJSON('["success", "skipped"]'), needs.pre_suite.result)`;

/** Stand-in commands; their text is irrelevant, only that they are non-empty. */
const A_RESET = "node scripts/reset.mjs";
const A_READ = "node scripts/read-seed.mjs";

/**
 * Runs the preflight step's real shell and returns the outputs it wrote.
 *
 * Re-implementing the platform fan-out here would make the simulation agree
 * with itself rather than with the workflow.
 *
 * @param workflow The parsed workflow.
 * @param platform The `platform` input value.
 * @param expoToken The EXPO_TOKEN secret; empty means the project is unwired.
 * @returns The `$GITHUB_OUTPUT` key/value pairs the step wrote.
 */
const runPreflight = (
  workflow: SimulatedWorkflow,
  platform: string,
  expoToken = "token"
): Record<string, string> => {
  const step = (workflow.jobs.preflight.steps ?? []).find(
    candidate => candidate.id === "check"
  );
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-preflight-"));
  const flowsDir = path.join(scratch, "flows");
  const outputFile = path.join(scratch, "github-output");
  if (!step?.run) throw new Error("preflight check step not found");
  fs.mkdirpSync(flowsDir);
  fs.writeFileSync(outputFile, "");
  boundedExecFileSync({
    label: "the preflight check step",
    command: BASH,
    args: ["-e", "-c", step.run],
    cwd: scratch,
    env: {
      ...process.env,
      EXPO_TOKEN: expoToken,
      PLATFORM: platform,
      FLOWS_DIR: flowsDir,
      REQUIRE_PREREQUISITES: "false",
      GITHUB_OUTPUT: outputFile,
    },
  });
  return Object.fromEntries(
    fs
      .readFileSync(outputFile, "utf-8")
      .split("\n")
      .filter(line => line.includes("="))
      .map(line => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ])
  );
};

describe("maestro-native-e2e pre-suite seam", () => {
  let workflow: SimulatedWorkflow;

  /**
   * Simulates one run of the reusable workflow.
   *
   * @param platform The `platform` input.
   * @param inputs Extra caller inputs.
   * @param forcedResults Results to force on jobs that do start.
   * @param expoToken The EXPO_TOKEN secret.
   * @returns The simulation result.
   */
  const run = (
    platform: string,
    inputs: Record<string, unknown> = {},
    forcedResults: Record<string, JobResult> = {},
    expoToken = "token"
  ) =>
    simulateRun(workflow, {
      seed: {
        name: "preflight",
        outputs: runPreflight(workflow, platform, expoToken),
      },
      inputs: {
        platform,
        package_manager: "bun",
        pre_suite_command: "",
        setup_command: "",
        pre_suite_install_dependencies: false,
        ...inputs,
      },
      forcedResults,
    });

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as SimulatedWorkflow;
  });

  it("executes the pre-suite command ONCE with both platforms selected", () => {
    const result = run("all", {
      [PRE_SUITE_INPUT]: A_RESET,
      [SETUP_INPUT]: A_READ,
    });
    expect(result.jobs[ANDROID].ran).toBe(true);
    expect(result.jobs[IOS].ran).toBe(true);
    expect(result.commandExecutions[PRE_SUITE_INPUT]).toBe(1);
    // The defect, quantified: the per-leg seam runs on both runners at once.
    expect(result.commandExecutions[SETUP_INPUT]).toBe(2);
  });

  it.each(PLATFORM_JOBS)("executes it once when only %s is selected", one => {
    const result = run(one, {
      [PRE_SUITE_INPUT]: A_RESET,
      [SETUP_INPUT]: A_READ,
    });
    expect(result.commandExecutions[PRE_SUITE_INPUT]).toBe(1);
    expect(result.commandExecutions[SETUP_INPUT]).toBe(1);
  });

  it("does not run it at all when preflight says the project is unwired", () => {
    // An unwired project skips every job in the workflow, this one included —
    // there is nothing to establish state for.
    const result = run("all", { [PRE_SUITE_INPUT]: A_RESET }, {}, "");
    expect(result.jobs[PRE_SUITE].ran).toBe(false);
    expect(result.commandExecutions[PRE_SUITE_INPUT] ?? 0).toBe(0);
  });

  it("is one job with no matrix fan-out and no platform-dependent guard", () => {
    const job = workflow.jobs[PRE_SUITE];
    const guard = String(job.if);
    expect(job.strategy).toBeUndefined();
    // Referencing a per-platform output here is exactly how a "once per run"
    // job silently becomes "once per platform, or never".
    expect(guard).not.toContain("run_android");
    expect(guard).not.toContain("run_ios");
    expect(guard).not.toContain("platforms");
  });

  it("owns the only step in the workflow that executes the command", () => {
    const carriers = Object.entries(workflow.jobs)
      .filter(([, job]) =>
        (job.steps ?? []).some(step =>
          step.run?.includes(`\${{ inputs.${PRE_SUITE_INPUT} }}`)
        )
      )
      .map(([name]) => name);
    expect(carriers).toEqual([PRE_SUITE]);
  });

  it.each(PLATFORM_JOBS)("%s genuinely depends on the pre-suite job", leg => {
    expect(workflow.jobs[leg].needs).toContain(PRE_SUITE);
  });

  it.each(PLATFORM_JOBS)(
    "%s gates on an ALLOWLIST of pre-suite results, not a denylist",
    leg => {
      const guard = String(workflow.jobs[leg].if);
      expect(guard).toContain(RESULT_ALLOWLIST);
      // A denylist enumerates what is forbidden and admits anything new.
      expect(guard).not.toContain("!= 'failure'");
    }
  );

  it("starts NO platform suite when the pre-suite command fails", () => {
    const result = run(
      "all",
      { [PRE_SUITE_INPUT]: A_RESET, [SETUP_INPUT]: A_READ },
      { [PRE_SUITE]: "failure" }
    );
    expect(result.jobs[PRE_SUITE].result).toBe("failure");
    expect(result.jobs[ANDROID].ran).toBe(false);
    expect(result.jobs[IOS].ran).toBe(false);
    expect(result.commandExecutions[SETUP_INPUT] ?? 0).toBe(0);
  });

  it("proves the allowlist is what fails closed, not !cancelled()", () => {
    // Strip the allowlist clause and the legs start again after a failed
    // pre-suite — `!cancelled()` is precisely the operator that lets a job run
    // despite a failed dependency, which is right for a build artifact and
    // wrong for established state. Delete the guard and this test goes red.
    const weakened = JSON.parse(JSON.stringify(workflow)) as SimulatedWorkflow;
    for (const leg of PLATFORM_JOBS) {
      weakened.jobs[leg].if = String(weakened.jobs[leg].if).replace(
        / && contains\(fromJSON\('\[.*?\]'\), needs\.pre_suite\.result\)/,
        ""
      );
    }
    const result = simulateRun(weakened, {
      seed: { name: "preflight", outputs: runPreflight(workflow, "all") },
      inputs: { [PRE_SUITE_INPUT]: A_RESET, [SETUP_INPUT]: A_READ },
      forcedResults: { [PRE_SUITE]: "failure" },
    });
    expect(result.jobs[ANDROID].ran).toBe(true);
    expect(result.jobs[IOS].ran).toBe(true);
  });

  it("still establishes state once when one platform's EAS build failed", () => {
    // One leg of a matrix failing marks the whole `build` job failed; the
    // surviving platform must still get its known state established.
    const result = run(
      "all",
      { [PRE_SUITE_INPUT]: A_RESET },
      { build: "failure" }
    );
    expect(result.commandExecutions[PRE_SUITE_INPUT]).toBe(1);
  });

  it("leaves setup_command declared, optional, and defaulting to empty", () => {
    const declared = (
      workflow as unknown as {
        on: {
          workflow_call: { inputs: Record<string, { default?: unknown }> };
        };
      }
    ).on.workflow_call.inputs[SETUP_INPUT];
    expect(declared.default).toBe("");
  });

  it("changes nothing for an adopter who never sets pre_suite_command", () => {
    const result = run("all", { [SETUP_INPUT]: A_READ });
    // The JOB runs (see the row-26 test below); its WORK does not.
    expect(result.commandExecutions[PRE_SUITE_INPUT] ?? 0).toBe(0);
    expect(result.jobs[ANDROID].ran).toBe(true);
    expect(result.jobs[IOS].ran).toBe(true);
    expect(result.commandExecutions[SETUP_INPUT]).toBe(2);
  });

  it("row 26: no job skips itself in a wired run just because an input is unset", () => {
    // The nightly health gate's completeness rule treats ANY job behind a
    // `mode: "run"` suite that concludes something other than `success` as
    // `incomplete_run` — a BLOCKED merge gate. So a job that skips whenever an
    // optional input is unset would redden every adopter who does not use that
    // input. The obvious spelling of the pre-suite guard
    // (`&& inputs.pre_suite_command != ''` on the JOB) does exactly that, which
    // is why the work is gated per-step instead.
    //
    // A caller passing NOTHING optional is the case that must stay clean.
    const result = run("all");
    for (const [name, outcome] of Object.entries(result.jobs)) {
      expect(`${name}:${outcome.ran}`).toBe(`${name}:true`);
    }
    expect(String(workflow.jobs[PRE_SUITE].if)).not.toContain(
      `inputs.${PRE_SUITE_INPUT} != ''`
    );
  });
});
