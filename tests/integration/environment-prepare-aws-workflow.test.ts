/**
 * The `environment-prepare-aws` reusable workflow (CodySwannGT/lisa#4374).
 *
 * A host's `environment:reset` may need AWS credentials — to invoke a scoped
 * reset function that exists only in its non-production account, say. The
 * natural credential is a GitHub OIDC role, which needs `id-token: write`.
 *
 * That scope cannot be added to `environment-prepare.yml`, `playwright-e2e.yml`
 * or `maestro-native-e2e.yml`: GitHub compares a callee's declared scopes
 * against the caller's grant BEFORE any `if:` is evaluated, so every installed
 * caller that does not grant it would `startup_failure` — see the header of
 * `reusable-workflow-caller-scopes.test.ts` (#2046, #2566). So the credentialed
 * path is a separate, opt-in workflow, and this suite pins the properties that
 * make it safe:
 *
 * 1. **Only the prepare job holds `id-token: write`**, and the three existing
 *    workflows still declare no `id-token` anywhere (the negative control —
 *    the regression this design exists to avoid).
 * 2. **No job sets `environment:`.** The OIDC `sub` claim the host's trust
 *    policy matches is `repo:<owner>/<repo>:ref:refs/heads/<branch>` only while
 *    no environment is named; naming one silently changes it to
 *    `...:environment:<name>` and the role refuses to be assumed.
 * 3. **Credentials are assumed before the verbs run**, through the pinned
 *    action, from the caller's `role_to_assume`.
 * 4. **Everything else is the sibling's, compared against the sibling.** The
 *    shared inputs' type/required/default, the prepare job's parsed steps
 *    (minus the two AWS-only ones) and the concurrency block are compared with
 *    `environment-prepare.yml` itself, so drift in any of those fails here.
 *    Not compared: input descriptions, YAML comments, the job's name/timeout,
 *    and the workflow_contract job.
 * @module tests/integration/environment-prepare-aws-workflow
 */

import yaml from "js-yaml";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.resolve(__dirname, "..", "..", ".github", "workflows");

const AWS_FILE = "environment-prepare-aws.yml";
const SIBLING_FILE = "environment-prepare.yml";

/** The pin already used by the shipped CDK CI template. */
const CONFIGURE_AWS_PIN =
  "aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a";

/** Absolute, so the shell under test is never resolved through PATH. */
const BASH = "/bin/bash";

const VERB_STEP = "🧼 Prepare the environment";
const VALIDATE_STEP = "Validate role_to_assume";
const REFUSAL_STEP = "Refuse to prepare";

/** One workflow step, as far as these assertions read it. */
interface Step {
  name: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}

/** One workflow job, as far as these assertions read it. */
interface Job {
  permissions?: Record<string, string>;
  environment?: unknown;
  steps: Step[];
}

/** The subset of a workflow file these assertions read. */
interface Workflow {
  on: { workflow_call: { inputs: Record<string, Record<string, unknown>> } };
  permissions?: Record<string, string>;
  concurrency: Record<string, unknown>;
  jobs: Record<string, Job>;
}

/**
 * Parse one workflow file.
 * @param file Workflow filename under `.github/workflows`.
 * @returns The parsed document.
 */
function load(file: string): Workflow {
  return yaml.load(
    readFileSync(path.join(WORKFLOWS, file), "utf8")
  ) as Workflow;
}

/**
 * The raw text of one workflow file.
 * @param file Workflow filename under `.github/workflows`.
 * @returns The file contents.
 */
function raw(file: string): string {
  return readFileSync(path.join(WORKFLOWS, file), "utf8");
}

/**
 * The steps of the prepare job in a workflow.
 * @param file Workflow filename.
 * @returns The step list.
 */
function prepareSteps(file: string): Step[] {
  return load(file).jobs.prepare.steps;
}

/**
 * Locate a step by a substring of its name, failing loudly when absent.
 * @param steps The step list to search.
 * @param fragment A substring of the wanted step's name.
 * @returns The matching step.
 */
function stepNamed(steps: Step[], fragment: string): Step {
  const step = steps.find(candidate => candidate.name.includes(fragment));
  if (step === undefined) {
    throw new Error(`no step whose name contains "${fragment}"`);
  }
  return step;
}

/**
 * Execute the role validation step's script with a given role value.
 * @param role The value `inputs.role_to_assume` would carry.
 * @returns The exit status and combined output.
 */
function runValidation(role: string): { status: number; output: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-prepare-aws-"));
  const step = stepNamed(prepareSteps(AWS_FILE), VALIDATE_STEP);
  writeFileSync(path.join(dir, "validate.sh"), String(step.run ?? ""));
  try {
    const output = boundedExecFileSync({
      label: "the role validation step",
      command: BASH,
      args: ["validate.sh"],
      cwd: dir,
      env: { ...process.env, ROLE_TO_ASSUME: role },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.exitCode ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("environment-prepare-aws — inputs", () => {
  it("requires role_to_assume as a string with no default", () => {
    const input = load(AWS_FILE).on.workflow_call.inputs.role_to_assume;

    expect(input?.required).toBe(true);
    expect(input?.type).toBe("string");
    expect(input?.default).toBeUndefined();
  });

  it("documents the caller grant and the subject the trust policy matches", () => {
    const description = String(
      load(AWS_FILE).on.workflow_call.inputs.role_to_assume?.description
    );

    expect(description).toContain("id-token: write");
    expect(description).toContain(
      "repo:<owner>/<repo>:ref:refs/heads/<branch>"
    );
  });

  it("defaults aws_region to us-east-1 and role_session_name to empty", () => {
    const inputs = load(AWS_FILE).on.workflow_call.inputs;

    expect(inputs.aws_region?.default).toBe("us-east-1");
    expect(inputs.aws_region?.type).toBe("string");
    expect(inputs.role_session_name?.default).toBe("");
    expect(inputs.role_session_name?.type).toBe("string");
  });

  it("keeps every input shared with environment-prepare.yml identical", () => {
    // Computed from BOTH files, so a later edit to either one's defaults,
    // types or required-ness fails here instead of drifting quietly.
    const sibling = load(SIBLING_FILE).on.workflow_call.inputs;
    const aws = load(AWS_FILE).on.workflow_call.inputs;
    const shared = Object.keys(sibling);

    expect(shared.length).toBeGreaterThanOrEqual(8);
    for (const name of shared) {
      const pick = (input: Record<string, unknown> | undefined) => ({
        required: input?.required,
        type: input?.type,
        default: input?.default,
      });
      expect(pick(aws[name]), name).toEqual(pick(sibling[name]));
    }
  });
});

describe("environment-prepare-aws — permissions", () => {
  it("grants the prepare job exactly contents:read and id-token:write", () => {
    expect(load(AWS_FILE).jobs.prepare.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
  });

  it("keeps id-token off the workflow level and every other job", () => {
    const doc = load(AWS_FILE);

    expect(doc.permissions ?? {}).not.toHaveProperty("id-token");
    const others = Object.entries(doc.jobs).filter(
      ([key]) => key !== "prepare"
    );
    expect(others.length).toBeGreaterThanOrEqual(1);
    for (const [key, job] of others) {
      expect(job.permissions, key).toBeDefined();
      expect(job.permissions ?? {}, key).not.toHaveProperty("id-token");
    }
  });

  it.each([SIBLING_FILE, "playwright-e2e.yml", "maestro-native-e2e.yml"])(
    "%s still declares no id-token anywhere (negative control)",
    file => {
      // The regression this workflow exists to avoid: widening an existing
      // reusable workflow startup-fails every installed caller that does not
      // grant the new scope.
      expect(raw(file)).not.toMatch(/id-token\s*:/);
    }
  );

  it("sets no environment: key on any job", () => {
    // A named environment changes the OIDC subject from `...:ref:refs/heads/<b>`
    // to `...:environment:<name>`, which the host's trust policy will not match.
    for (const [key, job] of Object.entries(load(AWS_FILE).jobs)) {
      expect(job, key).not.toHaveProperty("environment");
    }
  });
});

describe("environment-prepare-aws — credential step", () => {
  it("assumes the caller's role with the pinned action before the verbs", () => {
    const steps = prepareSteps(AWS_FILE);
    const credentialAt = steps.findIndex(step =>
      String(step.uses ?? "").startsWith(
        "aws-actions/configure-aws-credentials"
      )
    );
    const verbAt = steps.findIndex(step => step.name.startsWith(VERB_STEP));

    expect(credentialAt).toBeGreaterThanOrEqual(0);
    expect(verbAt).toBeGreaterThanOrEqual(0);
    expect(credentialAt).toBeLessThan(verbAt);

    const credential = steps[credentialAt];
    expect(credential?.uses).toBe(CONFIGURE_AWS_PIN);
    expect(credential?.with?.["role-to-assume"]).toBe(
      "${{ inputs.role_to_assume }}"
    );
    expect(credential?.with?.["aws-region"]).toBe("${{ inputs.aws_region }}");
    expect(credential?.with?.["role-session-name"]).toBe(
      "${{ inputs.role_session_name || format('lisa-environment-prepare-{0}', github.run_id) }}"
    );
  });

  it("carries the version comment beside the pinned SHA", () => {
    expect(raw(AWS_FILE)).toContain(`uses: ${CONFIGURE_AWS_PIN} # v4.3.1`);
  });

  it("validates the role before checkout, and after the pull-request refusal", () => {
    const names = prepareSteps(AWS_FILE).map(step => step.name);
    const refusalAt = names.findIndex(name => name.includes(REFUSAL_STEP));
    const validateAt = names.findIndex(name => name.includes(VALIDATE_STEP));
    const checkoutAt = names.findIndex(name => name.includes("Checkout"));

    expect(refusalAt).toBeGreaterThanOrEqual(0);
    expect(validateAt).toBeGreaterThan(refusalAt);
    expect(checkoutAt).toBeGreaterThan(validateAt);
  });

  it.each([
    "",
    "   ",
    "ExampleResetInvokeRole",
    "arn:aws:s3:::bucket",
    "arn:aws-x:y:iam::123456789012:role/a",
    "arn:aws:iam::123456789012:role/a b",
    "arn:aws:iam::12345678901:role/a",
    "arn:aws:iam::123456789012:user/a",
  ])("refuses role_to_assume=%j", role => {
    const { status, output } = runValidation(role);

    expect(status).not.toBe(0);
    expect(output).toContain("::error");
    // A malformed value can still carry an account id; it is never echoed.
    expect(output).not.toContain("123456789012");
  });

  it.each([
    "arn:aws:iam::123456789012:role/ExampleResetInvokeRole",
    "arn:aws-us-gov:iam::123456789012:role/ExampleResetInvokeRole",
    "arn:aws-cn:iam::123456789012:role/ExampleResetInvokeRole",
    "arn:aws:iam::123456789012:role/path/to/ExampleResetInvokeRole",
  ])("accepts role_to_assume=%j", role => {
    // The positive controls: without them, the refusals above are equally
    // consistent with a script that cannot run at all.
    const { status, output } = runValidation(role);

    expect(status).toBe(0);
    // Only the role name is logged — the account id stays out of public logs.
    expect(output).toContain("ExampleResetInvokeRole");
    expect(output).not.toContain("123456789012");
  });
});

describe("environment-prepare-aws — parity with environment-prepare.yml", () => {
  it("is the sibling's prepare job plus exactly the two AWS-only steps", () => {
    // Deep equality over every parsed step field — name, if, uses, with, env,
    // run. Nothing is excluded: the steps that legitimately differ are the two
    // AWS-only ones removed below, and `WORKFLOW_FILE` lives in the
    // workflow_contract job, not here. YAML comments are not compared.
    const awsOnly = new Set([VALIDATE_STEP, "Assume the AWS role"]);
    const aws = prepareSteps(AWS_FILE);
    const shared = aws.filter(
      step => ![...awsOnly].some(fragment => step.name.includes(fragment))
    );

    // Exactly the two named steps were removed — a rename would otherwise
    // leave one in and fail below for a confusing reason, or remove nothing.
    expect(aws.length - shared.length).toBe(awsOnly.size);
    expect(shared).toEqual(prepareSteps(SIBLING_FILE));
  });

  it("runs the identical verb invocation", () => {
    const sibling = stepNamed(prepareSteps(SIBLING_FILE), VERB_STEP);
    const aws = stepNamed(prepareSteps(AWS_FILE), VERB_STEP);

    expect(aws.run).toBe(sibling.run);
    expect(aws.env).toEqual(sibling.env);
  });

  it("carries the same pull-request refusal", () => {
    const sibling = stepNamed(prepareSteps(SIBLING_FILE), REFUSAL_STEP);
    const aws = stepNamed(prepareSteps(AWS_FILE), REFUSAL_STEP);

    expect(aws.if).toBe(sibling.if);
    expect(aws.run).toBe(sibling.run);
  });

  it("queues on the same environment lock", () => {
    // Both prepare paths mutate the same environment, so they must exclude
    // each other rather than holding two groups over one database.
    expect(load(AWS_FILE).concurrency).toEqual(load(SIBLING_FILE).concurrency);
  });
});
