/**
 * Vendor-neutral remote AWS bootstrap and platform-adapter coverage.
 * @module tests/unit/strategies/remote-agent-aws-setup
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { installRemoteAgentAws } from "../../../plugins/src/base/scripts/install-remote-agent-aws.mjs";

const temporaryDirectories: string[] = [];
const REMOTE_SETUP_SCRIPT_PATH =
  "plugins/src/base/scripts/remote-agent-aws-setup.sh";
const CURSOR_ENVIRONMENT_PATH = ".cursor/environment.json";
const COPILOT_WORKFLOW_PATH = ".github/workflows/copilot-setup-steps.yml";
const REMOTE_AWS_GUIDE_PATH = "docs/remote-agent-aws.md";
const COPILOT_PLATFORM_ARGUMENT = "--platform=copilot";
const NPM_INSTALL_STEP = "- run: npm ci";
const COPILOT_BOOTSTRAP_SECRET =
  "LISA_AWS_BOOTSTRAP_JSON: ${{ secrets.LISA_AWS_BOOTSTRAP_JSON }}";
const COPILOT_BOOTSTRAP_MARKER = "Lisa remote AWS bootstrap";
const CHECKOUT_CREDENTIAL_ISOLATION = "persist-credentials: false";
const GENERATED_PLUGIN_ROOTS = [
  "plugins/lisa",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
] as const;

/**
 * Create and register a disposable project directory.
 * @returns Absolute path to the disposable directory
 */
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lisa-remote-aws-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("remote AWS platform installer", () => {
  it("installs the common script and native Cursor and Copilot adapters", () => {
    const project = temporaryDirectory();
    const result = installRemoteAgentAws([
      `--project=${project}`,
      "--platform=all",
      "--secret-name=company-remote-agent",
    ]);

    expect(result.written).toEqual(
      expect.arrayContaining([
        "scripts/remote-agent-aws-setup.sh",
        CURSOR_ENVIRONMENT_PATH,
        COPILOT_WORKFLOW_PATH,
        REMOTE_AWS_GUIDE_PATH,
      ])
    );
    expect(
      JSON.parse(
        readFileSync(path.join(project, CURSOR_ENVIRONMENT_PATH), "utf8")
      ).install
    ).toBe("LISA_REMOTE_AGENT=cursor bash scripts/remote-agent-aws-setup.sh");
    const workflow = readFileSync(
      path.join(project, COPILOT_WORKFLOW_PATH),
      "utf8"
    );
    expect(workflow).toContain(COPILOT_BOOTSTRAP_MARKER);
    expect(workflow).toContain(COPILOT_BOOTSTRAP_SECRET);
    expect(workflow).toContain("LISA_REMOTE_AGENT: copilot");
    expect(workflow).toContain(CHECKOUT_CREDENTIAL_ISOLATION);
    expect(workflow).not.toContain("  push:");
    const guide = readFileSync(
      path.join(project, REMOTE_AWS_GUIDE_PATH),
      "utf8"
    );
    expect(guide).toContain("--secret-id company-remote-agent");
    for (const heading of [
      "## Context",
      "## Goal",
      "## Changes",
      "## Implementation",
      "## Notes",
    ]) {
      expect(guide).toContain(heading);
    }
  });

  it("preserves an existing Cursor install command and is idempotent", () => {
    const project = temporaryDirectory();
    mkdirSync(path.join(project, ".cursor"), { recursive: true });
    writeFileSync(
      path.join(project, CURSOR_ENVIRONMENT_PATH),
      '{"install":"npm ci"}\n'
    );

    installRemoteAgentAws([`--project=${project}`, "--platform=cursor"]);
    installRemoteAgentAws([`--project=${project}`, "--platform=cursor"]);

    const environment = JSON.parse(
      readFileSync(path.join(project, CURSOR_ENVIRONMENT_PATH), "utf8")
    );
    expect(environment.install).toBe(
      "LISA_REMOTE_AGENT=cursor bash scripts/remote-agent-aws-setup.sh && npm ci"
    );
  });

  it("merges the Copilot step once into an existing setup workflow", () => {
    const project = temporaryDirectory();
    const workflowPath = path.join(project, COPILOT_WORKFLOW_PATH);
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(
      workflowPath,
      "jobs:\n  copilot-setup-steps:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n"
    );

    installRemoteAgentAws([`--project=${project}`, COPILOT_PLATFORM_ARGUMENT]);
    installRemoteAgentAws([`--project=${project}`, COPILOT_PLATFORM_ARGUMENT]);

    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow.match(/Lisa remote AWS bootstrap/g)).toHaveLength(1);
    expect(workflow.match(/actions\/checkout@v4/g)).toHaveLength(1);
    expect(workflow).toContain(NPM_INSTALL_STEP);
    expect(workflow).toContain(COPILOT_BOOTSTRAP_SECRET);
    expect(workflow).toContain(CHECKOUT_CREDENTIAL_ISOLATION);
    expect(workflow.indexOf("actions/checkout@v4")).toBeLessThan(
      workflow.indexOf(COPILOT_BOOTSTRAP_MARKER)
    );
    expect(workflow.indexOf(COPILOT_BOOTSTRAP_MARKER)).toBeLessThan(
      workflow.indexOf(NPM_INSTALL_STEP)
    );
  });

  it("upgrades an existing Lisa Copilot step with the bootstrap secret", () => {
    const project = temporaryDirectory();
    const workflowPath = path.join(project, COPILOT_WORKFLOW_PATH);
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(
      workflowPath,
      [
        "jobs:",
        "  copilot-setup-steps:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Lisa remote AWS bootstrap",
        "        env:",
        "          LISA_REMOTE_AGENT: copilot",
        "        run: bash scripts/remote-agent-aws-setup.sh",
        "      - run: npm ci",
        "",
      ].join("\n")
    );

    installRemoteAgentAws([`--project=${project}`, COPILOT_PLATFORM_ARGUMENT]);

    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow.match(/LISA_AWS_BOOTSTRAP_JSON/g)).toHaveLength(2);
    expect(workflow).toContain(`      ${NPM_INSTALL_STEP}`);
    expect(workflow).toContain(CHECKOUT_CREDENTIAL_ISOLATION);
  });
});

describe("remote AWS runtime parity", () => {
  it("ships the setup skill and executable through every generated runtime", () => {
    const canonicalScript = readFileSync(REMOTE_SETUP_SCRIPT_PATH, "utf8");
    expect(canonicalScript).toContain('AWS_CLI_VERSION="2.36.2"');
    expect(canonicalScript).toContain(
      "awscli-exe-linux-${aws_architecture}-${AWS_CLI_VERSION}.zip"
    );
    expect(canonicalScript).toContain("gpg --batch --homedir");
    expect(canonicalScript).toContain("--verify");
    expect(canonicalScript).toContain(".key != $bootstrap_profile");
    expect(canonicalScript).toContain("remove_profile_setting");
    expect(canonicalScript).toContain("AWS_SHARED_CREDENTIALS_FILE");
    expect(canonicalScript).toContain("AWS_CONFIG_FILE");
    for (const root of GENERATED_PLUGIN_ROOTS) {
      expect(
        existsSync(path.join(root, "skills/lisa-setup-remote-aws/SKILL.md"))
      ).toBe(true);
      expect(
        readFileSync(
          path.join(root, "scripts/remote-agent-aws-setup.sh"),
          "utf8"
        )
      ).toBe(canonicalScript);
    }
    expect(
      existsSync(
        "plugins/lisa/.codex-plugin/skills/lisa-setup-remote-aws/SKILL.md"
      )
    ).toBe(true);
  });

  it("documents every supported or explicitly bounded remote-agent surface", () => {
    const guide = readFileSync(REMOTE_AWS_GUIDE_PATH, "utf8");
    for (const platform of [
      "Claude",
      "Codex",
      "Cursor",
      "Copilot",
      "Antigravity",
      "OpenCode",
    ]) {
      expect(guide).toContain(platform);
    }
  });
});

/* eslint-disable sonarjs/no-os-command-from-path -- Test-only PATH shims inject the fake aws executable. */
describe("remote AWS bootstrap script", () => {
  /**
   * Install a test-only AWS CLI shim that records every invocation.
   * @param directory - Disposable test root
   * @returns Fake binary directory and invocation log path
   */
  function createFakeAws(directory: string): {
    readonly binaryDirectory: string;
    readonly logPath: string;
  } {
    const binaryDirectory = path.join(directory, "bin");
    const logPath = path.join(directory, "aws.log");
    const awsPath = path.join(binaryDirectory, "aws");
    mkdirSync(binaryDirectory, { recursive: true });
    writeFileSync(
      awsPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_AWS_LOG"
if [ "\${1:-}" = "configure" ]; then
  mkdir -p "$HOME/.aws"
  touch "$HOME/.aws/credentials" "$HOME/.aws/config"
fi
if [ "\${1:-}" = "sts" ]; then
  printf '%s\\n' '{"Account":"111111111111"}'
fi
`
    );
    chmodSync(awsPath, 0o700);
    return { binaryDirectory, logPath };
  }

  it("writes renewable role profiles from the one bootstrap JSON secret", () => {
    const root = temporaryDirectory();
    const home = path.join(root, "home");
    mkdirSync(home, { recursive: true });
    const { binaryDirectory, logPath } = createFakeAws(root);
    const profiles = {
      dev: {
        roleArn: "arn:aws:iam::111111111111:role/RemoteAgent",
        region: "us-east-1",
      },
      production: {
        roleArn: "arn:aws:iam::222222222222:role/RemoteAgent",
        region: "us-west-2",
      },
    };
    const bootstrap = JSON.stringify({
      accessKeyId: "AKIATEST",
      secretAccessKey: "test-secret",
      externalId: "external-id",
      roleName: "RemoteAgent",
      profiles: JSON.stringify(profiles),
    });

    const output = execFileSync("bash", [REMOTE_SETUP_SCRIPT_PATH], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        FAKE_AWS_LOG: logPath,
        LISA_AWS_BOOTSTRAP_JSON: bootstrap,
        LISA_REMOTE_AGENT: "codex",
      },
    });

    const awsCalls = readFileSync(logPath, "utf8");
    expect(awsCalls).toContain(
      "configure set source_profile lisa-remote-agent-bootstrap --profile dev"
    );
    expect(awsCalls).toContain(
      "configure set role_session_name codex --profile production"
    );
    expect(awsCalls).toContain("sts get-caller-identity --profile dev");
    expect(output).toContain("default=dev");
    expect(output).toContain("profiles=dev, production");
  });

  it("rejects standard AWS credential variables that could bypass the role", () => {
    const root = temporaryDirectory();
    const home = path.join(root, "home");
    mkdirSync(home, { recursive: true });
    const { binaryDirectory, logPath } = createFakeAws(root);
    const result = spawnSync("bash", [REMOTE_SETUP_SCRIPT_PATH], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${binaryDirectory}:${process.env.PATH ?? ""}`,
        FAKE_AWS_LOG: logPath,
        AWS_ACCESS_KEY_ID: "must-not-be-used",
        LISA_AWS_BOOTSTRAP_JSON: "{}",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("do not set AWS_ACCESS_KEY_ID directly");
  });
});
/* eslint-enable sonarjs/no-os-command-from-path -- End test-only PATH shim scope. */
