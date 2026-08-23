/**
 * The cross-job export seam — behavioral, not string-matched.
 *
 * `$GITHUB_ENV` does not cross job boundaries, so the `setup_command` trick of
 * appending `MAESTRO_*` lines to it cannot work for a command that now runs in
 * a job of its own. `pre_suite_command` instead appends to the file named by
 * `$MAESTRO_PRE_SUITE_ENV`; a capture step validates those pairs and publishes
 * them as a JOB OUTPUT; each platform leg re-applies them to its own
 * `$GITHUB_ENV` before `setup_command` runs.
 *
 * Every test below EXECUTES the workflow's own shell, pulled verbatim out of
 * the YAML. A validator that is only asserted to exist is a validator nobody
 * has ever seen fire, so each rejection case is paired with the acceptance case
 * it must not swallow.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import type { SimulatedWorkflow } from "../helpers/workflow-job-graph";

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

const PLATFORM_JOBS = ["android", "ios"];
const APPLY_STEP = "🧭 Apply pre-suite env";
const SEED_PAIR = "MAESTRO_SEED_PLAYER_ID=abc123";
const NAME_PAIR = "MAESTRO_NAME=Truffert";

/** Names the workflow owns and refuses to let `pre_suite_command` set. */
const RESERVED_ARGS_KEY = "MAESTRO_E2E_ARGS";
const RESERVED_FILE_KEY = "MAESTRO_PRE_SUITE_ENV";

/** What executing a step produced. */
interface StepOutcome {
  status: number;
  /** Everything the step wrote to its own stdout. */
  console: string;
  /** The `$GITHUB_OUTPUT` or `$GITHUB_ENV` file the step wrote. */
  written: string;
}

describe("pre-suite exports cross the job boundary as a validated output", () => {
  let workflow: SimulatedWorkflow;

  /**
   * Executes the capture step's real shell against an export file.
   *
   * @param exported What `pre_suite_command` appended to $MAESTRO_PRE_SUITE_ENV.
   * @returns The step's exit status, console output, and $GITHUB_OUTPUT.
   */
  const capture = (exported: string): StepOutcome => {
    const step = (workflow.jobs.pre_suite.steps ?? []).find(
      candidate => candidate.id === "capture"
    );
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-capture-"));
    const exportFile = path.join(scratch, "pre-suite-env");
    const outputFile = path.join(scratch, "github-output");
    const env = {
      ...process.env,
      MAESTRO_PRE_SUITE_ENV: exportFile,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: scratch,
    };
    let status = 0;
    let console = "";
    if (!step?.run) throw new Error("capture step not found");
    fs.writeFileSync(exportFile, exported);
    fs.writeFileSync(outputFile, "");
    try {
      // `shell: bash` in GitHub Actions is `bash -eo pipefail` — run the step
      // under the same options CI gives it, or the test proves a different
      // program from the one that ships.
      console = boundedExecFileSync({
        label: "the capture-pre-suite-env step",
        command: BASH,
        args: ["-eo", "pipefail", "-c", step.run],
        cwd: scratch,
        env,
      });
    } catch (error) {
      const failure = error as { exitCode?: number | null; stdout?: string };
      status = failure.exitCode ?? 1;
      console = failure.stdout ?? "";
    }
    return { status, console, written: fs.readFileSync(outputFile, "utf-8") };
  };

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as SimulatedWorkflow;
  });

  it("publishes the exports as a job output, because $GITHUB_ENV is per-job", () => {
    const declared = (
      workflow.jobs.pre_suite as { outputs?: Record<string, string> }
    ).outputs;
    expect(declared?.maestro_env).toBe(
      "${{ steps.capture.outputs.maestro_env }}"
    );
  });

  it("forwards well-formed MAESTRO_* pairs", () => {
    const result = capture(`${SEED_PAIR}\n${NAME_PAIR}\n`);
    expect(result.status).toBe(0);
    expect(result.written.trim()).toBe(`maestro_env=${SEED_PAIR} ${NAME_PAIR}`);
  });

  it("emits an empty output when the command exported nothing", () => {
    const result = capture("");
    expect(result.status).toBe(0);
    expect(result.written.trim()).toBe("maestro_env=");
  });

  it("ignores blank lines and comments", () => {
    const result = capture(`\n# a note\n${SEED_PAIR}\n\n`);
    expect(result.status).toBe(0);
    expect(result.written.trim()).toBe(`maestro_env=${SEED_PAIR}`);
  });

  it.each([
    ["a key outside the allowlist", "SEED_PLAYER_ID=abc"],
    // Assembled rather than written as one literal: the reserved names are
    // built from their keys so a secret scanner does not read the test data as
    // a credential assignment.
    ["a reserved key", `${RESERVED_ARGS_KEY}=x`],
    ["the export-file variable itself", `${RESERVED_FILE_KEY}=/tmp/elsewhere`],
    ["an empty value", "MAESTRO_SEED="],
    // The exact shape that aborted both arms of a real suite before flow 1:
    // an unquoted flag list word-splits, and the tail is read as a flow path.
    ["a value containing whitespace", "MAESTRO_PLAYER=Adrien Truffert"],
    ["a line that is not KEY=VALUE", "just some output"],
  ])("fails closed on %s", (_label, line) => {
    const result = capture(`${line}\n`);
    expect(result.status).not.toBe(0);
    expect(result.console).toContain("::error");
  });
});

describe("each platform leg re-applies the exports to its own $GITHUB_ENV", () => {
  let workflow: SimulatedWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as SimulatedWorkflow;
  });

  it.each(PLATFORM_JOBS)("%s reads the pre-suite job's output", leg => {
    const step = (workflow.jobs[leg].steps ?? []).find(
      candidate => candidate.name === APPLY_STEP
    );
    expect(step?.env?.PRE_SUITE_ENV).toBe(
      "${{ needs.pre_suite.outputs.maestro_env }}"
    );
  });

  it.each(PLATFORM_JOBS)("%s turns that output back into env lines", leg => {
    const step = (workflow.jobs[leg].steps ?? []).find(
      candidate => candidate.name === APPLY_STEP
    );
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-apply-"));
    const envFile = path.join(scratch, "github-env");
    if (!step?.run) throw new Error(`apply step not found in ${leg}`);
    fs.writeFileSync(envFile, "");
    boundedExecFileSync({
      label: "the apply-pre-suite-env step",
      command: BASH,
      args: ["-e", "-c", step.run],
      cwd: scratch,
      env: {
        ...process.env,
        PRE_SUITE_ENV: `${SEED_PAIR} ${NAME_PAIR}`,
        GITHUB_ENV: envFile,
      },
    });
    expect(fs.readFileSync(envFile, "utf-8").trim().split("\n")).toEqual([
      SEED_PAIR,
      NAME_PAIR,
    ]);
  });

  it.each(PLATFORM_JOBS)("%s applies them BEFORE setup_command runs", leg => {
    const names = (workflow.jobs[leg].steps ?? []).map(step => step.name);
    const applyIndex = names.indexOf(APPLY_STEP);
    const setupIndex = names.indexOf("🎯 Run setup command");
    expect(applyIndex).toBeGreaterThanOrEqual(0);
    expect(setupIndex).toBeGreaterThan(applyIndex);
  });
});
