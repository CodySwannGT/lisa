/**
 * Execution coverage for the remote AWS bootstrap script.
 *
 * These cases assert on the resulting `~/.aws` files rather than on exit
 * status. The defect they pin succeeded while overwriting another tenant's
 * profiles and reported ready while holding another tenant's credentials, so
 * an exit status distinguishes nothing here.
 * @module tests/unit/strategies/remote-agent-aws-profiles
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  bundleFor,
  removeTemporaryDirectories,
  runBootstrap,
  workstation,
} from "./support/remote-agent-aws-harness.js";

const ALPHA = "org-alpha";
const ALPHA_BUNDLE_ACCOUNTS = ["111111111111", "222222222222"] as const;
const BETA_BUNDLE_ACCOUNTS = ["333333333333", "444444444444"] as const;
const CONFIG_RELATIVE_PATH = path.join(".aws", "config");
const LEGACY_DEV_SECTION = "[profile dev]";

afterEach(removeTemporaryDirectories);

/**
 * The environment a plain, successful bootstrap needs.
 * @param namespace - Project component for the written profile names
 * @param accounts - Dev and production account ids for the bundle
 * @returns Variables to pass to the script
 */
function bootstrapEnvironment(
  namespace: string,
  accounts: readonly [string, string]
): Record<string, string> {
  return {
    LISA_AWS_BOOTSTRAP_JSON: bundleFor(accounts[0], accounts[1]),
    LISA_AWS_PROFILE_NAMESPACE: namespace,
  };
}

describe("remote AWS bootstrap script", () => {
  it("writes renewable role profiles from the one bootstrap JSON secret", () => {
    const ws = workstation();
    const result = runBootstrap({
      workstation: ws,
      environment: {
        ...bootstrapEnvironment(ALPHA, ALPHA_BUNDLE_ACCOUNTS),
        LISA_REMOTE_AGENT: "codex",
      },
    });

    expect(result.status).toBe(0);
    const awsCalls = readFileSync(ws.cli.logPath, "utf8");
    expect(awsCalls).toContain(
      "configure set source_profile org-alpha-agent-bootstrap --profile org-alpha-agent-dev"
    );
    expect(awsCalls).toContain(
      "configure set role_session_name codex --profile org-alpha-agent-production"
    );
    expect(awsCalls).toContain(
      "sts get-caller-identity --profile org-alpha-agent-dev"
    );
    expect(result.stdout).toContain("default=org-alpha-agent-dev");
    expect(result.stdout).toContain(
      "profiles=org-alpha-agent-dev, org-alpha-agent-production"
    );
  });

  it("rejects standard AWS credential variables that could bypass the role", () => {
    const result = runBootstrap({
      workstation: workstation(),
      environment: {
        AWS_ACCESS_KEY_ID: "must-not-be-used",
        LISA_AWS_BOOTSTRAP_JSON: "{}",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("do not set AWS_ACCESS_KEY_ID directly");
  });

  it("keeps two organisations' identically named stages apart in one config", () => {
    const ws = workstation();

    const first = runBootstrap({
      workstation: ws,
      environment: bootstrapEnvironment(ALPHA, ALPHA_BUNDLE_ACCOUNTS),
    });
    const second = runBootstrap({
      workstation: ws,
      environment: {
        ...bootstrapEnvironment("org-beta", BETA_BUNDLE_ACCOUNTS),
        LISA_AWS_CLAIM_DEFAULT_PROFILE: "1",
      },
    });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    const config = readFileSync(
      path.join(ws.home, CONFIG_RELATIVE_PATH),
      "utf8"
    );
    expect(config).toContain("[profile org-alpha-agent-dev]");
    expect(config).toContain("[profile org-beta-agent-dev]");
    expect(config).toContain("role_arn = arn:aws:iam::111111111111:role/");
    expect(config).toContain("role_arn = arn:aws:iam::333333333333:role/");
    // Two stages each, both projects. The source profiles hold only key
    // material, so they live in the credentials file rather than here.
    expect(config.match(/^\[profile /gm)).toHaveLength(4);
  });

  it("refuses to report ready when working credentials reach the wrong account", () => {
    // Working credentials, wrong account. Broken credentials would fail against
    // the defect too, and so would prove nothing about the fix.
    const result = runBootstrap({
      workstation: workstation(),
      environment: {
        ...bootstrapEnvironment(ALPHA, ALPHA_BUNDLE_ACCOUNTS),
        FAKE_STS_ACCOUNT: "999999999999",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("999999999999");
    expect(result.stderr).toContain("111111111111");
    expect(result.stdout).not.toContain("ready");
  });

  it("rejects a bundle whose declared account contradicts its own role ARN", () => {
    const ws = workstation();
    const result = runBootstrap({
      workstation: ws,
      environment: {
        LISA_AWS_PROFILE_NAMESPACE: ALPHA,
        LISA_AWS_BOOTSTRAP_JSON: JSON.stringify({
          accessKeyId: "AKIATEST",
          secretAccessKey: "test-secret",
          externalId: "external-id",
          profiles: {
            dev: {
              roleArn: "arn:aws:iam::111111111111:role/RemoteAgent",
              region: "us-east-1",
              expectedAccountId: "222222222222",
            },
          },
        }),
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("expectedAccountId 222222222222");
    expect(result.stderr).toContain("account 111111111111");
    expect(existsSync(path.join(ws.home, CONFIG_RELATIVE_PATH))).toBe(false);
  });

  it("refuses to write anything when no project namespace resolves", () => {
    const ws = workstation();
    const result = runBootstrap({
      workstation: ws,
      // Run from outside any checkout so the git-remote fallback finds nothing.
      cwd: ws.home,
      environment: {
        LISA_AWS_BOOTSTRAP_JSON: bundleFor(...ALPHA_BUNDLE_ACCOUNTS),
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "cannot determine which project these AWS profiles belong to"
    );
    expect(existsSync(path.join(ws.home, CONFIG_RELATIVE_PATH))).toBe(false);
  });

  it("reports rather than orphans profiles from the unnamespaced convention", () => {
    const ws = workstation();
    const configPath = path.join(ws.home, CONFIG_RELATIVE_PATH);
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      [
        LEGACY_DEV_SECTION,
        "role_arn = arn:aws:iam::123456789012:role/RemoteAgent",
        "source_profile = lisa-remote-agent-bootstrap",
        "",
        "[profile production]",
        "role_arn = arn:aws:iam::210987654321:role/RemoteAgent",
        "source_profile = lisa-remote-agent-bootstrap",
        "",
      ].join("\n")
    );

    const reported = runBootstrap({
      workstation: ws,
      environment: bootstrapEnvironment(ALPHA, ALPHA_BUNDLE_ACCOUNTS),
    });

    expect(reported.status).toBe(0);
    expect(reported.stderr).toContain("dev, production");
    expect(reported.stderr).toContain("LISA_AWS_PRUNE_LEGACY_PROFILES=1");
    expect(readFileSync(configPath, "utf8")).toContain(LEGACY_DEV_SECTION);

    const pruned = runBootstrap({
      workstation: ws,
      environment: {
        ...bootstrapEnvironment(ALPHA, ALPHA_BUNDLE_ACCOUNTS),
        LISA_AWS_PRUNE_LEGACY_PROFILES: "1",
      },
    });

    expect(pruned.status).toBe(0);
    expect(pruned.stderr).toContain("removed unnamespaced profiles");
    const config = readFileSync(configPath, "utf8");
    expect(config).not.toContain(LEGACY_DEV_SECTION);
    expect(config).toContain("[profile org-alpha-agent-dev]");
  });

  it("will not silently take over a default profile another project owns", () => {
    const ws = workstation();
    runBootstrap({
      workstation: ws,
      environment: bootstrapEnvironment(ALPHA, ALPHA_BUNDLE_ACCOUNTS),
    });

    const result = runBootstrap({
      workstation: ws,
      environment: bootstrapEnvironment("org-beta", BETA_BUNDLE_ACCOUNTS),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refusing to overwrite the [default]");
    expect(result.stderr).toContain("LISA_AWS_CLAIM_DEFAULT_PROFILE=1");
    const config = readFileSync(
      path.join(ws.home, CONFIG_RELATIVE_PATH),
      "utf8"
    );
    expect(config.slice(config.indexOf("[default]"))).toContain(
      "arn:aws:iam::111111111111:role/"
    );
  });

  it("still bootstraps over the inert default profile a container ships", () => {
    const ws = workstation();
    const configPath = path.join(ws.home, CONFIG_RELATIVE_PATH);
    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(configPath, "[default]\nregion = us-east-1\n");

    const result = runBootstrap({
      workstation: ws,
      environment: bootstrapEnvironment(ALPHA, ALPHA_BUNDLE_ACCOUNTS),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ready");
  });
});
