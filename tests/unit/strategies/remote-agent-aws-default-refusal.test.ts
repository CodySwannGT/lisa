/**
 * Execution coverage for the `[default]` takeover refusal in the remote AWS
 * bootstrap script.
 *
 * The refusal is correct; what it used to offer was not. It told the operator
 * to "use the named profiles instead" after refusing before any of them were
 * written, so the one remedy it presented did not exist and the override was
 * left as the only real path (CodySwannGT/lisa#4446). These cases pin the
 * resulting `~/.aws` files, not just the exit status: the named profiles must
 * exist when the message says to use them, and `[default]` must be untouched.
 * @module tests/unit/strategies/remote-agent-aws-default-refusal
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bundleFor,
  removeTemporaryDirectories,
  runBootstrap,
  workstation,
  type Workstation,
} from "./support/remote-agent-aws-harness.js";

const ALPHA = "org-alpha";
const BETA = "org-beta";
const ALPHA_DEV_ACCOUNT = "111111111111";
const BETA_DEV_ACCOUNT = "333333333333";
const REFUSAL = "refusing to overwrite the [default]";
const CLAIM_OVERRIDE = "LISA_AWS_CLAIM_DEFAULT_PROFILE=1";
const OPERATOR_ROLE_DEFAULT =
  "[default]\nrole_arn = arn:aws:iam::999999999999:role/Mine\n";

afterEach(removeTemporaryDirectories);

/**
 * The environment a plain bootstrap for one project needs.
 * @param namespace - Project component for the written profile names
 * @param devAccount - Account owning the bundle's dev role
 * @returns Variables to pass to the script
 */
function projectEnvironment(
  namespace: string,
  devAccount: string
): Record<string, string> {
  return {
    LISA_AWS_BOOTSTRAP_JSON: bundleFor(devAccount, "444444444444"),
    LISA_AWS_PROFILE_NAMESPACE: namespace,
  };
}

/**
 * Read one of the workstation's AWS files.
 * @param ws - The disposable workstation
 * @param name - `config` or `credentials`
 * @returns The file's contents
 */
function awsFile(ws: Workstation, name: "config" | "credentials"): string {
  return readFileSync(path.join(ws.home, ".aws", name), "utf8");
}

/**
 * The body of one section, up to the next section header.
 * @param contents - An INI-style AWS file
 * @param header - The exact section header, brackets included
 * @returns The section's lines, or an empty string when absent
 */
function sectionBody(contents: string, header: string): string {
  const start = contents.indexOf(header);
  if (start < 0) return "";
  const rest = contents.slice(start + header.length);
  const next = rest.search(/^\[/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * Seed the workstation with an operator's own AWS files.
 * @param ws - The disposable workstation
 * @param files - Initial contents for `config` and/or `credentials`
 * @param files.config - Initial `~/.aws/config` contents
 * @param files.credentials - Initial `~/.aws/credentials` contents
 */
function seedOperatorFiles(
  ws: Workstation,
  files: { readonly config?: string; readonly credentials?: string }
): void {
  const directory = path.join(ws.home, ".aws");
  mkdirSync(directory, { recursive: true });
  if (files.config !== undefined) {
    writeFileSync(path.join(directory, "config"), files.config);
  }
  if (files.credentials !== undefined) {
    writeFileSync(path.join(directory, "credentials"), files.credentials);
  }
}

/**
 * Assert the project's named profiles and bootstrap source were all written.
 * @param ws - The disposable workstation
 * @param namespace - Project component of the profile names
 * @param devAccount - Account the dev profile must point at
 */
function expectNamedProfilesWritten(
  ws: Workstation,
  namespace: string,
  devAccount: string
): void {
  const config = awsFile(ws, "config");
  expect(sectionBody(config, `[profile ${namespace}-agent-dev]`)).toContain(
    `role_arn = arn:aws:iam::${devAccount}:role/RemoteAgent`
  );
  expect(
    sectionBody(config, `[profile ${namespace}-agent-production]`)
  ).toContain("role_arn = arn:aws:iam::444444444444:role/RemoteAgent");
  expect(
    sectionBody(awsFile(ws, "credentials"), `[${namespace}-agent-bootstrap]`)
  ).toContain("aws_access_key_id = AKIATEST");
}

describe("remote AWS bootstrap refusing to take over [default]", () => {
  it("writes the named profiles another project's default does not block", () => {
    const ws = workstation();
    runBootstrap({
      workstation: ws,
      environment: projectEnvironment(ALPHA, ALPHA_DEV_ACCOUNT),
    });

    const result = runBootstrap({
      workstation: ws,
      environment: projectEnvironment(BETA, BETA_DEV_ACCOUNT),
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("ready (");
    expect(result.stderr).toContain(REFUSAL);
    expect(result.stderr).toContain("another Lisa project");
    expect(result.stderr).toContain(CLAIM_OVERRIDE);
    expectNamedProfilesWritten(ws, BETA, BETA_DEV_ACCOUNT);
    expect(sectionBody(awsFile(ws, "config"), "[default]")).toContain(
      `arn:aws:iam::${ALPHA_DEV_ACCOUNT}:role/`
    );
  });

  it("names profiles that exist, verified, and how to select one", () => {
    const ws = workstation();
    seedOperatorFiles(ws, {
      config:
        "[default]\nsso_start_url = https://example.invalid/start\nregion = eu-west-1\n",
    });

    const result = runBootstrap({
      workstation: ws,
      environment: projectEnvironment(BETA, BETA_DEV_ACCOUNT),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(REFUSAL);
    expect(result.stderr).toContain("this workstation operator");
    expect(result.stderr).toContain(
      "org-beta-agent-dev, org-beta-agent-production"
    );
    // Only the default stage is proved without VERIFY_ALL, so only it is named.
    expect(result.stderr).toContain(
      "were written; org-beta-agent-dev was verified"
    );
    expect(result.stderr).not.toContain("written and verified");
    expect(result.stderr).toContain("AWS_PROFILE=org-beta-agent-dev");
    expect(result.stderr).not.toContain("No profiles were created");
    expect(readFileSync(ws.cli.logPath, "utf8")).toContain(
      "sts get-caller-identity --profile org-beta-agent-dev"
    );
    expectNamedProfilesWritten(ws, BETA, BETA_DEV_ACCOUNT);
    const operatorDefault = sectionBody(awsFile(ws, "config"), "[default]");
    expect(operatorDefault).toContain("sso_start_url");
    expect(operatorDefault).not.toContain("role_arn");
    expect(operatorDefault).not.toContain("source_profile");
  });

  it("vouches for every profile only when every profile was verified", () => {
    const ws = workstation();
    seedOperatorFiles(ws, {
      config: OPERATOR_ROLE_DEFAULT,
    });

    const result = runBootstrap({
      workstation: ws,
      environment: {
        ...projectEnvironment(BETA, BETA_DEV_ACCOUNT),
        LISA_AWS_VERIFY_ALL_PROFILES: "1",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("were written and verified");
    const awsCalls = readFileSync(ws.cli.logPath, "utf8");
    expect(awsCalls).toContain(
      "sts get-caller-identity --profile org-beta-agent-dev"
    );
    expect(awsCalls).toContain(
      "sts get-caller-identity --profile org-beta-agent-production"
    );
  });

  it("does not claim verification it skipped", () => {
    const ws = workstation();
    seedOperatorFiles(ws, {
      config: OPERATOR_ROLE_DEFAULT,
    });

    const result = runBootstrap({
      workstation: ws,
      environment: {
        ...projectEnvironment(BETA, BETA_DEV_ACCOUNT),
        LISA_AWS_SKIP_VERIFY: "1",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(REFUSAL);
    expect(result.stderr).not.toContain("written and verified");
    expect(result.stderr).toContain("LISA_AWS_SKIP_VERIFY=1");
    expectNamedProfilesWritten(ws, BETA, BETA_DEV_ACCOUNT);
  });

  it("warns that claiming would not displace long-lived keys under [default]", () => {
    // The shape that was actually reported: config-side `[profile default]`
    // holding only region/output, credentials-side `[default]` holding static
    // IAM keys for a different account.
    const ws = workstation();
    seedOperatorFiles(ws, {
      config: "[profile default]\nregion = us-east-1\noutput = json\n",
      credentials:
        "[default]\naws_access_key_id = AKIAOPERATOR\naws_secret_access_key = operator-secret\n",
    });

    const result = runBootstrap({
      workstation: ws,
      environment: projectEnvironment(BETA, BETA_DEV_ACCOUNT),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(REFUSAL);
    expect(result.stderr).toContain("long-lived access keys");
    expect(result.stderr).not.toContain("AKIAOPERATOR");
    expect(result.stderr).not.toContain("operator-secret");
    expectNamedProfilesWritten(ws, BETA, BETA_DEV_ACCOUNT);
    expect(sectionBody(awsFile(ws, "credentials"), "[default]")).toContain(
      "aws_access_key_id = AKIAOPERATOR"
    );
  });

  it("still takes over [default] when the override is set", () => {
    const ws = workstation();
    seedOperatorFiles(ws, {
      config: OPERATOR_ROLE_DEFAULT,
    });

    const result = runBootstrap({
      workstation: ws,
      environment: {
        ...projectEnvironment(BETA, BETA_DEV_ACCOUNT),
        LISA_AWS_CLAIM_DEFAULT_PROFILE: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain(REFUSAL);
    expect(result.stdout).toContain("ready (");
    expectNamedProfilesWritten(ws, BETA, BETA_DEV_ACCOUNT);
    const claimed = sectionBody(awsFile(ws, "config"), "[default]");
    expect(claimed).toContain(`arn:aws:iam::${BETA_DEV_ACCOUNT}:role/`);
    expect(claimed).toContain("source_profile = org-beta-agent-bootstrap");
  });
});
