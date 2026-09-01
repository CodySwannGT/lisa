/**
 * Harness for the seeded CDK CI role-selection suite.
 *
 * Reads step bodies out of the shipped `cdk/create-only/.github/workflows/ci.yml`
 * and runs them the way GitHub runs a `run:` block — `bash -e`, with a real
 * `$GITHUB_OUTPUT` file — after resolving the `${{ … }}` expressions GitHub
 * would have resolved. Nothing here contacts AWS: the identity assertion is
 * pointed at a fake `aws` on PATH.
 *
 * Split out of the suite so the assertions stay readable and neither file
 * outgrows the repository's line budget.
 * @module tests/integration/support/cdk-ci-role-selection-harness
 */
import * as fs from "fs-extra";
import { load as loadYaml } from "js-yaml";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root, resolved from this file rather than from cwd. */
export const ROOT = path.resolve(HERE, "..", "..", "..");

/** The authoritative seed under test. */
export const CI_WORKFLOW = path.join(
  ROOT,
  "cdk/create-only/.github/workflows/ci.yml"
);

/** GitHub runs a `run:` block as `bash -e`; the `-e` is load-bearing. */
const SHELL = "/bin/bash";

/** Wall-clock ceiling for one step. A killed child is not a verdict. */
const RUN_TIMEOUT_MS = 30_000;

/** Owner-only rwx: the PATH shim must be executable, and nobody else's. */
const SHIM_MODE = 0o700;

/** Placeholder account ids, standing in for `secrets.AWS_ACCOUNT_ID_*`. */
export const ACCOUNTS = {
  dev: "000000000003",
  production: "000000000001",
  staging: "000000000002",
} as const;

/** One workflow step, in the shape this suite reads. */
export interface Step {
  /** The step's `id:`, when it has one. */
  id?: string;
  /** Static environment the step declares. */
  env?: Record<string, string>;
  /** The shell body. */
  run?: string;
}

/** The subset of the workflow document this suite reads. */
export interface Workflow {
  /** Trigger declarations. */
  on?: Record<string, unknown>;
  /** Jobs, keyed by id. */
  jobs: Record<
    string,
    {
      /** Job-level outputs. */
      outputs?: Record<string, string>;
      /** Job-level permissions. */
      permissions?: Record<string, string>;
      /** Steps, absent on a reusable-workflow call. */
      steps?: Step[];
      /** The reusable workflow this job calls, when it calls one. */
      uses?: string;
    }
  >;
}

/**
 * Parse the shipped workflow.
 *
 * Read rather than copied: a copy keeps passing after the workflow it claims to
 * describe is broken, which is the exact shape of an inert guard.
 * @returns The parsed workflow document.
 */
export function workflow(): Workflow {
  return loadYaml(fs.readFileSync(CI_WORKFLOW, "utf8")) as Workflow;
}

/**
 * The step carrying a given `id:`, from any job.
 * @param id The step's `id:`.
 * @returns That step.
 */
export function step(id: string): Step {
  const steps = Object.values(workflow().jobs).flatMap(job => job.steps ?? []);
  const found = steps.find(candidate => candidate.id === id);
  if (!found) throw new Error(`the CDK CI seed has no step with id \`${id}\``);
  return found;
}

/**
 * Resolve every `${{ … }}` expression in a shell body from a supplied map.
 *
 * An expression with no entry throws instead of expanding to the empty string,
 * so a body that grows a new context reference fails loudly here rather than
 * quietly changing what these assertions cover.
 * @param body The shell body.
 * @param context Expression text mapped to its value.
 * @returns The body with every expression substituted.
 */
function substitute(body: string, context: Record<string, string>): string {
  return body.replace(/\$\{\{([^}]*)\}\}/g, (_match, raw: string) => {
    const expression = raw.trim();
    const value = context[expression];
    if (value === undefined) {
      throw new Error(`no test value for GitHub expression \`${expression}\``);
    }
    return value;
  });
}

/** The result of running a step body. */
export interface Run {
  /** Exit status of the step. */
  status: number;
  /** Everything the step printed. */
  output: string;
  /** Every `key=value` line the step wrote, in order. */
  outputs: string[];
}

/**
 * Write a step body to disk and run it under `bash -e`.
 * @param script Where to write the body.
 * @param body The already-substituted shell body.
 * @param outputs Path to serve as `$GITHUB_OUTPUT`.
 * @param cwd Working directory for the step.
 * @param env Extra environment to expose.
 * @returns The completed child process.
 */
function spawnStep(
  script: string,
  body: string,
  outputs: string,
  cwd: string,
  env: Record<string, string>
): ReturnType<typeof spawnSync<string>> {
  fs.writeFileSync(script, body);
  fs.writeFileSync(outputs, "");
  return spawnSync(SHELL, ["-e", script], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: outputs, ...env },
    timeout: RUN_TIMEOUT_MS,
  });
}

/**
 * Install a fake `aws` that reports one caller identity.
 * @param bin Directory to place the executable in.
 * @param callerArn What `aws sts get-caller-identity` should print.
 * @returns The directory, ready to be prepended to PATH.
 */
function installFakeAws(bin: string, callerArn: string): string {
  const executable = path.join(bin, "aws");
  fs.mkdirpSync(bin);
  fs.writeFileSync(executable, `#!/bin/sh\necho '${callerArn}'\n`);
  fs.chmodSync(executable, SHIM_MODE);
  return bin;
}

/**
 * Run a shell body the way GitHub runs a `run:` block.
 * @param temp Scratch directory for this test.
 * @param body The already-substituted shell body.
 * @param env Extra environment to expose to the step.
 * @returns Status, combined output, and the `$GITHUB_OUTPUT` lines.
 */
function execute(
  temp: string,
  body: string,
  env: Record<string, string> = {}
): Run {
  const outputs = path.join(temp, "github_output");
  const child = spawnStep(path.join(temp, "step.sh"), body, outputs, temp, env);
  if (child.signal !== null) {
    throw new Error(`the step was KILLED (${child.signal}).`);
  }
  return {
    output: `${child.stdout}${child.stderr}`,
    outputs: fs
      .readFileSync(outputs, "utf8")
      .split("\n")
      .filter(line => line.length > 0),
    status: child.status ?? -1,
  };
}

/** The step runners, bound to one scratch directory. */
export interface Harness {
  /** Run the `determine_environment` selection step for one trigger. */
  determineEnvironment: (
    eventName: string,
    ref: string,
    roleVariable?: string
  ) => Run;
  /** Run the identity assertion against a fake `aws` reporting `callerArn`. */
  verifyIdentity: (expectedRole: string, callerArn: string) => Run;
}

/**
 * Bind the step runners to one scratch directory.
 * @param temp Scratch directory for the current test.
 * @returns The bound runners.
 */
export function harness(temp: string): Harness {
  return {
    determineEnvironment: (eventName, ref, roleVariable = "") =>
      execute(
        temp,
        substitute(step("env").run ?? "", {
          "github.base_ref": ref,
          "github.event.inputs.environment": ref,
          "github.event_name": eventName,
          "secrets.AWS_ACCOUNT_ID_DEV": ACCOUNTS.dev,
          "secrets.AWS_ACCOUNT_ID_PRODUCTION": ACCOUNTS.production,
          "secrets.AWS_ACCOUNT_ID_STAGING": ACCOUNTS.staging,
        }),
        { CDK_CI_READ_ONLY_ROLE_NAME: roleVariable }
      ),
    verifyIdentity: (expectedRole, callerArn) =>
      execute(temp, step("verify_identity").run ?? "", {
        EXPECTED_ROLE: expectedRole,
        PATH: `${installFakeAws(path.join(temp, "bin"), callerArn)}:${process.env["PATH"] ?? ""}`,
      }),
  };
}

/**
 * The single value written for one `$GITHUB_OUTPUT` key.
 * @param run A completed step run.
 * @param key The output name.
 * @returns The value, or an empty string when unset.
 */
export function output(run: Run, key: string): string {
  const hit = run.outputs.filter(line => line.startsWith(`${key}=`)).pop();
  return hit ? hit.slice(key.length + 1) : "";
}

/**
 * How many times a step wrote a given `$GITHUB_OUTPUT` key.
 * @param run A completed step run.
 * @param key The output name.
 * @returns The number of lines written for that key.
 */
export function emitted(run: Run, key: string): number {
  return run.outputs.filter(line => line.startsWith(`${key}=`)).length;
}
