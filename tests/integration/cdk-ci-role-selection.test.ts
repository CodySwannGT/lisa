/**
 * The seeded CDK CI workflow picks its AWS identity by TRIGGER, not by account.
 *
 * `cdk/create-only/.github/workflows/ci.yml` seeds every new CDK repository
 * with a pull-request validation job that only ever reads — `cdk synth`,
 * `cdk diff`, unit tests — and it used to assume a hardcoded deploy role in
 * whichever account the base branch mapped to. GitHub emits an identical
 * `pull_request` OIDC subject regardless of base branch, so that seed forces a
 * consumer to trust `repo:<owner>/<repo>:pull_request` in EVERY account it
 * validates against, production included: anyone able to open a pull request
 * could then obtain production deploy credentials.
 *
 * The narrowing has a trap, and it is the reason this suite exists rather than
 * a one-line diff review. The same workflow also fires on `workflow_dispatch`,
 * which presents a DIFFERENT subject (`ref:refs/heads/<branch>`). A read-only
 * role whose trust policy admits only the pull-request subject refuses it, and
 * the failure is an opaque `sts:AssumeRoleWithWebIdentity` denial that names
 * nothing. So the assertions below pin BOTH arms of the selection: swapping the
 * role unconditionally would satisfy the security half and silently break the
 * manual-dispatch half.
 *
 * Everything here is executed rather than pattern-matched where it can be. The
 * step bodies are read out of the shipped workflow and run under `bash -e`, the
 * way GitHub runs a `run:` block, and the identity assertion runs against a
 * fake `aws` on PATH, so no live AWS account is involved.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED rather than
 * derived from the file under test.
 * @module tests/integration/cdk-ci-role-selection
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LisaConfig } from "../../src/core/config.js";
import { CreateOnlyStrategy } from "../../src/strategies/create-only.js";
import type { StrategyContext } from "../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";
import type { Harness } from "./support/cdk-ci-role-selection-harness.js";
import {
  ACCOUNTS,
  CI_WORKFLOW,
  ROOT,
  emitted,
  harness,
  output,
  step,
  workflow,
} from "./support/cdk-ci-role-selection-harness.js";

/** The least-privileged default a fresh repository is seeded with. */
const READ_ONLY_ROLE = "CiReadOnlyServiceRole";

/** The identity every non-pull-request trigger must keep. */
const DEPLOY_ROLE = "DeployServiceRole";

/** Where a create-only delivery puts the seed. */
const RELATIVE = ".github/workflows/ci.yml";

/** Scratch directory for the current test. */
let temp = "";

/** Step runners bound to the current scratch directory. */
let run: Harness;

/**
 * A strategy context pointed at a throwaway destination.
 * @param destDir Where the create-only asset is delivered.
 * @returns The context.
 */
function context(destDir: string): StrategyContext {
  const config: LisaConfig = {
    destDir,
    dryRun: false,
    harness: "claude",
    lisaDir: path.join(ROOT, "cdk/create-only"),
    skipGitCheck: false,
    validateOnly: false,
    yesMode: true,
  };
  return {
    backupFile: async () => {},
    config,
    promptOverwrite: async () => true,
  };
}

beforeEach(async () => {
  temp = await createTempDir();
  run = harness(temp);
});

afterEach(async () => {
  await cleanupTempDir(temp);
});

describe("pull requests get the least-privileged identity by default", () => {
  it.each([
    ["main", "production", ACCOUNTS.production],
    ["staging", "staging", ACCOUNTS.staging],
    ["dev", "dev", ACCOUNTS.dev],
    ["feature/anything", "dev", ACCOUNTS.dev],
  ])(
    "a pull request into %s validates %s read-only",
    (baseRef, environment, account) => {
      const result = run.determineEnvironment("pull_request", baseRef);

      expect(result.status).toBe(0);
      expect(output(result, "environment")).toBe(environment);
      expect(output(result, "aws_account_id")).toBe(account);
      expect(output(result, "role_name")).toBe(READ_ONLY_ROLE);
      expect(output(result, "role_arn")).toBe(
        `arn:aws:iam::${account}:role/${READ_ONLY_ROLE}`
      );
    }
  );

  it("emits role_name and role_arn exactly once", () => {
    const result = run.determineEnvironment("pull_request", "main");

    expect(emitted(result, "role_name")).toBe(1);
    expect(emitted(result, "role_arn")).toBe(1);
  });

  it("builds every account's ARN from the selected role, never a literal", () => {
    const arnLines = (step("env").run ?? "")
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith('echo "role_arn='));

    expect(arnLines).toHaveLength(3);
    for (const line of arnLines) {
      expect(line).toContain(":role/$ROLE_NAME");
      expect(line).not.toContain(DEPLOY_ROLE);
      expect(line).not.toContain(READ_ONLY_ROLE);
    }
  });
});

describe("the read-only role name is overridable without a secret", () => {
  it("uses the repository variable when one is set", () => {
    const result = run.determineEnvironment("pull_request", "main", "MyCiRole");

    expect(output(result, "role_name")).toBe("MyCiRole");
    expect(output(result, "role_arn")).toBe(
      `arn:aws:iam::${ACCOUNTS.production}:role/MyCiRole`
    );
  });

  it("accepts the deploy role as an explicit compatibility override", () => {
    const result = run.determineEnvironment(
      "pull_request",
      "main",
      DEPLOY_ROLE
    );

    expect(output(result, "role_name")).toBe(DEPLOY_ROLE);
    expect(output(result, "role_arn")).toBe(
      `arn:aws:iam::${ACCOUNTS.production}:role/${DEPLOY_ROLE}`
    );
  });

  it("reads the variable through env, not by interpolating it into shell", () => {
    expect(step("env").env ?? {}).toMatchObject({
      CDK_CI_READ_ONLY_ROLE_NAME: "${{ vars.CDK_CI_READ_ONLY_ROLE_NAME }}",
    });
    expect(step("env").run ?? "").not.toContain("vars.");
  });
});

describe("manual dispatch keeps the deployment identity", () => {
  it.each([
    ["production", ACCOUNTS.production],
    ["staging", ACCOUNTS.staging],
    ["dev", ACCOUNTS.dev],
  ])("dispatching %s still assumes the deploy role", (environment, account) => {
    const result = run.determineEnvironment("workflow_dispatch", environment);

    expect(result.status).toBe(0);
    expect(output(result, "environment")).toBe(environment);
    expect(output(result, "aws_account_id")).toBe(account);
    expect(output(result, "role_name")).toBe(DEPLOY_ROLE);
    expect(output(result, "role_arn")).toBe(
      `arn:aws:iam::${account}:role/${DEPLOY_ROLE}`
    );
  });

  it("keeps the deploy role when dispatch supplies no environment", () => {
    // `workflow_dispatch:` declares no inputs, so this — not the cases above —
    // is what a real manual run presents: an empty environment that falls
    // through to dev. The role selection must not depend on that resolving.
    const result = run.determineEnvironment("workflow_dispatch", "");

    expect(result.status).toBe(0);
    expect(output(result, "aws_account_id")).toBe(ACCOUNTS.dev);
    expect(output(result, "role_name")).toBe(DEPLOY_ROLE);
    expect(output(result, "role_arn")).toBe(
      `arn:aws:iam::${ACCOUNTS.dev}:role/${DEPLOY_ROLE}`
    );
  });

  it("ignores the pull-request override on dispatch", () => {
    const result = run.determineEnvironment(
      "workflow_dispatch",
      "production",
      "MyCiRole"
    );

    expect(output(result, "role_name")).toBe(DEPLOY_ROLE);
  });

  it("publishes role_name as a job output for downstream jobs", () => {
    expect(workflow().jobs["determine_environment"]?.outputs).toMatchObject({
      role_name: "${{ steps.env.outputs.role_name }}",
    });
  });
});

describe("the workflow proves which identity it actually assumed", () => {
  it("passes when the assumed role matches the selection", () => {
    const result = run.verifyIdentity(
      READ_ONLY_ROLE,
      `arn:aws:sts::${ACCOUNTS.production}:assumed-role/${READ_ONLY_ROLE}/cdk-ci-checks`
    );

    expect(result.status).toBe(0);
    expect(result.output).toContain(READ_ONLY_ROLE);
  });

  it("fails, naming both identities, when a different role was assumed", () => {
    const observed = `arn:aws:sts::${ACCOUNTS.production}:assumed-role/${DEPLOY_ROLE}/cdk-ci-checks`;

    const result = run.verifyIdentity(READ_ONLY_ROLE, observed);

    expect(result.status).toBe(1);
    expect(result.output).toContain("::error::");
    expect(result.output).toContain(READ_ONLY_ROLE);
    expect(result.output).toContain(observed);
  });

  it("is not fooled by a role whose name merely starts the same", () => {
    const result = run.verifyIdentity(
      READ_ONLY_ROLE,
      `arn:aws:sts::${ACCOUNTS.production}:assumed-role/${READ_ONLY_ROLE}Elevated/cdk-ci-checks`
    );

    expect(result.status).toBe(1);
  });

  it("takes the expected role from the job output, via env", () => {
    expect(step("verify_identity").env ?? {}).toMatchObject({
      EXPECTED_ROLE: "${{ needs.determine_environment.outputs.role_name }}",
    });
  });
});

describe("the rest of the seeded workflow is unchanged", () => {
  it("still fires on both pull_request and workflow_dispatch", () => {
    expect(Object.keys(workflow().on ?? {})).toEqual([
      "pull_request",
      "workflow_dispatch",
    ]);
  });

  it("keeps the OIDC permissions the credential step needs", () => {
    expect(workflow().jobs["cdk-checks"]?.permissions).toMatchObject({
      contents: "read",
      "id-token": "write",
    });
  });

  it("keeps checkout, setup, build, synth, diff and test", () => {
    const steps = JSON.stringify(workflow().jobs["cdk-checks"]?.steps ?? []);

    expect(steps).toContain("actions/checkout@v6");
    expect(steps).toContain("actions/setup-node@v6");
    // Pinned to a commit SHA, not a floating major (#3585): a third-party
    // action at `@v4` resolves, at job start, to whatever the upstream owner
    // has pushed there, and this step assumes a deploy role.
    expect(steps).toContain(
      "aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a"
    );
    expect(steps).toContain("npm run build");
    expect(steps).toContain("cdk synth");
    expect(steps).toContain("cdk diff");
    expect(steps).toContain("npm test");
  });

  it("still delegates to the reusable quality workflow", () => {
    expect(workflow().jobs["quality"]?.uses).toBe(
      "CodySwannGT/lisa/.github/workflows/quality.yml@main"
    );
  });

  it("warns the reader, in the file, why the role is trigger-selected", () => {
    const body = step("env").run ?? "";

    expect(body).toContain("repo:<owner>/<repo>:pull_request");
    expect(body).toContain("repo:<owner>/<repo>:ref:refs/heads/<branch>");
    expect(body).toContain("sts:AssumeRoleWithWebIdentity");
    expect(body).toContain("CDK_CI_READ_ONLY_ROLE_NAME");
  });
});

describe("create-only delivery still only touches fresh repositories", () => {
  it("creates the updated seed in a repository that has none", async () => {
    const destDir = path.join(temp, "fresh");
    const destFile = path.join(destDir, RELATIVE);
    await fs.ensureDir(path.dirname(destFile));

    const result = await new CreateOnlyStrategy().apply(
      CI_WORKFLOW,
      destFile,
      RELATIVE,
      context(destDir)
    );

    expect(result.action).toBe("created");
    expect(await fs.readFile(destFile, "utf8")).toBe(
      await fs.readFile(CI_WORKFLOW, "utf8")
    );
  });

  it("preserves an existing workflow byte for byte", async () => {
    const destDir = path.join(temp, "existing");
    const destFile = path.join(destDir, RELATIVE);
    const sentinel = "# sentinel: this repo owns its own CI\nname: mine\n";
    await fs.ensureDir(path.dirname(destFile));
    await fs.writeFile(destFile, sentinel);

    const result = await new CreateOnlyStrategy().apply(
      CI_WORKFLOW,
      destFile,
      RELATIVE,
      context(destDir)
    );

    expect(result.action).toBe("skipped");
    expect(await fs.readFile(destFile, "utf8")).toBe(sentinel);
  });
});
