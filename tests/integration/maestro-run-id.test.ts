/**
 * MAESTRO_RUN_ID reaches flows as a real, resolvable, sweepable env var.
 *
 * Throwaway accounts and uploads a run mints had no run-scoped namespace, so a
 * reset/sweep pass could not enumerate what one run created
 * (CodySwannGT/lisa#4275). The reusable workflow now resolves `run_id` (or
 * `<github.run_id>-<github.run_attempt>`) and writes it to `$GITHUB_ENV` in the
 * same step that applies `maestro_env`, which lands it in every flow's `-e`
 * list automatically. Each test EXECUTES the step shell out of the YAML rather
 * than asserting on strings — the seam being proven is the one CI runs.
 * @module tests/integration/maestro-run-id
 */
import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../helpers/io-latency-budget.js";
import type { SimulatedWorkflow } from "../helpers/workflow-job-graph.js";

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

const APPLY_STEP = "🧩 Apply maestro env";
const ASSEMBLE_STEP = "🧮 Assemble Maestro flags";
const JOBS_WITH_ENV_APPLY = ["pre_suite", "android", "ios"];
const RESOLVED = "31557572592-1";

/** Prefix for the throwaway directories the step executions write into. */
const SCRATCH_PREFIX = "maestro-runid-";

/** Name of the scratch file standing in for $GITHUB_ENV. */
const ENV_FILE_NAME = "github-env";

/** One step node out of the loaded reusable workflow. */
interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly env?: Record<string, string>;
  readonly run?: string;
}

/** The parsed reusable workflow, `on:` block included. */
interface LoadedWorkflow extends SimulatedWorkflow {
  readonly on?: {
    readonly workflow_call?: {
      readonly inputs?: Record<string, unknown>;
    };
  };
}

/**
 * Find a named step inside one job of the loaded workflow.
 * @param job - The job id to search
 * @param name - The step's exact display name
 * @param workflow - The parsed maestro-native-e2e reusable workflow
 * @returns The matching step, which must carry a `run:` block
 */
function stepNamed(
  job: string,
  name: string,
  workflow: SimulatedWorkflow
): Step {
  const step = ((workflow.jobs[job]?.steps ?? []) as Step[]).find(
    candidate => candidate.name === name
  );
  if (!step?.run) throw new Error(`${name} step not found in ${job}`);
  return step;
}

/**
 * Execute one step's `run:` block under `bash -eo pipefail`, the same options
 * `shell: bash` carries in CI.
 * @param run - The step's shell body, verbatim out of the YAML
 * @param extra - Environment this run of the step sees on top of process.env
 * @param envFile - The file standing in for $GITHUB_ENV
 * @returns The step's exit status
 */
function runStep(
  run: string,
  extra: Readonly<Record<string, string>>,
  envFile: string
): number {
  try {
    boundedExecFileSync({
      label: "a maestro workflow step",
      command: BASH,
      args: ["-eo", "pipefail", "-c", run],
      cwd: path.dirname(envFile),
      env: { ...process.env, ...extra, GITHUB_ENV: envFile },
    });
    return 0;
  } catch (error) {
    return (error as { exitCode?: number | null }).exitCode ?? 1;
  }
}

describe("the run id reaches flows as MAESTRO_RUN_ID", () => {
  let workflow: LoadedWorkflow;

  beforeAll(async () => {
    workflow = yaml.load(
      await fs.readFile(REUSABLE_YML, "utf-8")
    ) as LoadedWorkflow;
  });

  it("declares an optional run_id input on workflow_call", () => {
    const inputs = workflow.on?.workflow_call?.inputs;
    const runId = inputs?.run_id as
      | { required?: boolean; type?: string; default?: string }
      | undefined;
    expect(runId).toBeDefined();
    expect(runId?.required).toBe(false);
    expect(runId?.type).toBe("string");
  });

  it.each(JOBS_WITH_ENV_APPLY)(
    "%s resolves the run id from the input or the run identity",
    job => {
      const step = stepNamed(job, APPLY_STEP, workflow);
      expect(step.env?.RESOLVED_RUN_ID).toBe(
        "${{ inputs.run_id || format('{0}-{1}', github.run_id, github.run_attempt) }}"
      );
    }
  );

  it.each(JOBS_WITH_ENV_APPLY)(
    "%s writes MAESTRO_RUN_ID into $GITHUB_ENV for later steps",
    job => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
      const envFile = path.join(scratch, ENV_FILE_NAME);
      fs.writeFileSync(envFile, "");
      const step = stepNamed(job, APPLY_STEP, workflow);
      expect(
        runStep(
          step.run as string,
          {
            E2E_ENV_INPUT: "",
            E2E_SECRET_ENV_INPUT: "",
            RESOLVED_RUN_ID: RESOLVED,
          },
          envFile
        )
      ).toBe(0);
      expect(fs.readFileSync(envFile, "utf-8")).toContain(
        `MAESTRO_RUN_ID=${RESOLVED}`
      );
    }
  );

  it("lets a caller's own MAESTRO_RUN_ID in maestro_env stand", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), SCRATCH_PREFIX));
    const envFile = path.join(scratch, ENV_FILE_NAME);
    fs.writeFileSync(envFile, "");
    const step = stepNamed("android", APPLY_STEP, workflow);
    expect(
      runStep(
        step.run as string,
        {
          E2E_ENV_INPUT: "MAESTRO_RUN_ID=caller-owned",
          E2E_SECRET_ENV_INPUT: "",
          RESOLVED_RUN_ID: RESOLVED,
        },
        envFile
      )
    ).toBe(0);
    const lines = fs
      .readFileSync(envFile, "utf-8")
      .trim()
      .split("\n")
      .filter(line => line.startsWith("MAESTRO_RUN_ID="));
    expect(lines).toEqual(["MAESTRO_RUN_ID=caller-owned"]);
  });

  it.each(["android", "ios"])(
    "%s forwards it to flows through the assemble step's -e list",
    job => {
      const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-asm-"));
      const envFile = path.join(scratch, ENV_FILE_NAME);
      fs.writeFileSync(envFile, "");
      const step = stepNamed(job, ASSEMBLE_STEP, workflow);
      expect(
        runStep(
          step.run as string,
          {
            E2E_ENV_INPUT: "",
            E2E_SECRET_ENV_INPUT: "",
            MAESTRO_APP_ID: "com.example.app",
            MAESTRO_RUN_ID: RESOLVED,
          },
          envFile
        )
      ).toBe(0);
      expect(fs.readFileSync(envFile, "utf-8")).toContain(
        `-e MAESTRO_RUN_ID=${RESOLVED}`
      );
    }
  );

  it("refuses a pre_suite_command export of MAESTRO_RUN_ID", () => {
    const capture = ((workflow.jobs.pre_suite?.steps ?? []) as Step[]).find(
      candidate => candidate.id === "capture"
    );
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-capture-"));
    const exportFile = path.join(scratch, "pre-suite-env");
    const outputFile = path.join(scratch, "github-output");
    const envFile = path.join(scratch, ENV_FILE_NAME);
    fs.writeFileSync(exportFile, "MAESTRO_RUN_ID=forked\n");
    fs.writeFileSync(outputFile, "");
    fs.writeFileSync(envFile, "");
    if (!capture?.run) throw new Error("capture step not found");
    const status = (() => {
      try {
        boundedExecFileSync({
          label: "the capture-pre-suite-env step",
          command: BASH,
          args: ["-eo", "pipefail", "-c", capture.run as string],
          cwd: scratch,
          env: {
            ...process.env,
            MAESTRO_PRE_SUITE_ENV: exportFile,
            GITHUB_OUTPUT: outputFile,
            GITHUB_ENV: envFile,
            RUNNER_TEMP: scratch,
          },
        });
        return 0;
      } catch (error) {
        return (error as { exitCode?: number | null }).exitCode ?? 1;
      }
    })();
    expect(status).not.toBe(0);
  });
});
