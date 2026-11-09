/**
 * Executes the third-party review evidence workflow's own step scripts, in
 * order, against a host-shaped folder and a controlled GitHub.
 *
 * The runner's contract is reproduced only as far as these steps read it: a
 * step's `env:` expressions resolve against the event's contexts, its
 * `$GITHUB_OUTPUT` lines become `steps.<id>.outputs` for the steps after it,
 * `$RUNNER_TEMP` and `$GITHUB_STEP_SUMMARY` exist, and a step runs only when
 * every step before it succeeded (CodySwannGT/lisa#4630).
 * @module tests/helpers/third-party-review-workflow-steps
 */
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { githubTemplate } from "./github-expression.js";
import { boundedSpawnSync } from "./io-latency-budget.js";
import {
  installControlledGitHub,
  installProverAsHost,
  type JournaledCall,
  type Observations,
} from "./third-party-review-cli-fixture.js";
import { REPO } from "./third-party-review-observations.js";
import {
  proverStep,
  publishStep,
  type ScriptStep,
  workflowOf,
} from "./third-party-review-workflow.js";

/** The runner's scratch directory, inside the job's folder. */
const RUNNER_TEMP = "runner-temp";

/** The job's step summary, inside the job's folder. */
const SUMMARY = "summary.md";

/** One step's `$GITHUB_OUTPUT`, inside the job's folder. */
const OUTPUT = "output";

/** What one execution of the job's steps produced. */
export interface StepsRun {
  /** The job's exit: the first failing step's, or 0. */
  readonly status: number | null;
  /** Everything the steps printed, stdout and stderr. */
  readonly log: string;
  /** Every call the steps made to the controlled GitHub. */
  readonly calls: readonly JournaledCall[];
  /** What the steps wrote to the job's step summary. */
  readonly summary: string;
}

/** A check run the publish step created, as the controlled GitHub received it. */
export interface PublishedRun {
  readonly name: string;
  readonly head_sha: string;
  readonly status: string;
  readonly conclusion: string;
  readonly output: { readonly title: string; readonly summary: string };
}

/**
 * The outputs one step wrote to `$GITHUB_OUTPUT`.
 * @param file - The output file
 * @returns Output name to value
 */
function outputsIn(file: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(line => line.includes("="))
      .map(line => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ])
  );
}

/** Where one job runs: its folder, the controlled `gh`, and the environment. */
interface JobPlace {
  /** The host-shaped folder the job runs in. */
  readonly folder: string;
  /** Where the controlled `gh` lives. */
  readonly bindir: string;
  /** The suite's own environment, which every step inherits. */
  readonly env: NodeJS.ProcessEnv;
}

/**
 * Start one step's script under the runner's variables.
 * @param place - Where the job runs
 * @param script - The step's script file
 * @param stepEnv - The step's resolved `env:`
 * @returns The step's exit and log
 */
function spawnStep(
  place: JobPlace,
  script: string,
  stepEnv: Record<string, string>
) {
  const { folder, bindir, env } = place;
  const result = boundedSpawnSync({
    label: "a shipped evidence workflow step",
    command: "/bin/bash",
    args: [script],
    cwd: folder,
    env: {
      ...env,
      ...stepEnv,
      RUNNER_TEMP: path.join(folder, RUNNER_TEMP),
      GITHUB_OUTPUT: path.join(folder, OUTPUT),
      GITHUB_STEP_SUMMARY: path.join(folder, SUMMARY),
      PATH: [bindir, path.dirname(process.execPath), env.PATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
    baseMs: 30000,
  });
  return {
    status: result.status,
    log: `${String(result.stdout)}${String(result.stderr)}`,
  };
}

/**
 * Execute one shipped step script, as the runner does.
 * @param place - Where the job runs
 * @param step - The step's script and env
 * @param event - The contexts its expressions read
 * @returns The step's exit, output and `$GITHUB_OUTPUT` values
 */
function runStep(
  place: JobPlace,
  step: ScriptStep,
  event: Record<string, unknown>
) {
  const script = path.join(place.folder, `step-${step.id ?? "unnamed"}.sh`);
  const output = path.join(place.folder, OUTPUT);
  const stepEnv = Object.fromEntries(
    Object.entries(step.env).map(([key, value]) => [
      key,
      githubTemplate(String(value), event),
    ])
  );
  fs.writeFileSync(script, step.run);
  fs.writeFileSync(output, "");
  return { ...spawnStep(place, script, stepEnv), outputs: outputsIn(output) };
}

/**
 * Lay out a host-shaped folder for one job.
 * @param folder - A fresh folder the caller owns
 * @param proverAt - Where the folder holds the prover
 */
function prepareFolder(
  folder: string,
  proverAt: "host" | "in-repo-template"
): void {
  installProverAsHost(folder);
  if (proverAt === "in-repo-template") {
    fs.moveSync(
      path.join(folder, "scripts"),
      path.join(folder, "all/copy-overwrite/scripts")
    );
  }
  fs.mkdirSync(path.join(folder, RUNNER_TEMP));
  fs.writeFileSync(path.join(folder, SUMMARY), "");
}

/**
 * Execute one copy's real step scripts for one event against a host folder:
 * the prover step, then — as the runner would, only when it succeeded — the
 * step that publishes its verdict.
 * @param copy - Repository-relative workflow path
 * @param event - The event's contexts
 * @param observations - What GitHub shows at the head
 * @param env - The suite's own environment, supplied explicitly by the suite
 * @param proverAt - Where the folder holds the prover: a host's `scripts/`,
 *   or only this repository's in-repo template, as its own checkout does
 * @returns The job's exit, its log, its summary, and the calls it made
 */
export function executeSteps(
  copy: string,
  event: Record<string, unknown>,
  observations: Observations,
  env: NodeJS.ProcessEnv,
  proverAt: "host" | "in-repo-template" = "host"
): StepsRun {
  const workflow = workflowOf(copy);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-step-"));
  try {
    prepareFolder(folder, proverAt);
    const github = installControlledGitHub(folder, observations);
    const place = { folder, bindir: github.bindir, env };
    const prover = proverStep(workflow);
    const proved = runStep(place, prover, event);
    const steps = { [String(prover.id)]: { outputs: proved.outputs } };
    const published =
      proved.status === 0
        ? runStep(place, publishStep(workflow), { ...event, steps })
        : { status: proved.status, log: "" };
    return {
      status: published.status,
      log: `${proved.log}${published.log}`,
      calls: github.calls(),
      summary: fs.readFileSync(path.join(folder, SUMMARY), "utf8"),
    };
  } finally {
    fs.removeSync(folder);
  }
}

/**
 * The check runs a job published.
 * @param run - One execution
 * @returns Each published check run's body
 */
export function publishedRuns(run: StepsRun): readonly PublishedRun[] {
  return run.calls
    .filter(
      call =>
        call.argv[1] === `repos/${REPO}/check-runs` &&
        call.argv.includes("POST")
    )
    .map(call => call.input as PublishedRun);
}
