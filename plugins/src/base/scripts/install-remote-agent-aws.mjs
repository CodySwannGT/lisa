#!/usr/bin/env node
/**
 * Install Lisa's vendor-neutral remote AWS bootstrap into a host project.
 *
 * This installer writes only non-secret repository artifacts. The bootstrap
 * SecretString is configured directly in each remote-agent platform.
 * @module install-remote-agent-aws
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "remote-agent-aws-setup.sh";
const INSTALL_COMMAND = `bash scripts/${SCRIPT_NAME}`;
const VALID_PLATFORMS = new Set([
  "all",
  "claude",
  "codex",
  "cursor",
  "copilot",
  "agy",
  "opencode",
]);

function parseArguments(arguments_) {
  let project = process.cwd();
  let platform = "all";
  let secretName = "remote-agent-credentials";
  for (const argument of arguments_) {
    if (argument.startsWith("--project=")) {
      project = path.resolve(argument.slice("--project=".length));
    } else if (argument.startsWith("--platform=")) {
      platform = argument.slice("--platform=".length).toLowerCase();
    } else if (argument.startsWith("--secret-name=")) {
      secretName = argument.slice("--secret-name=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!VALID_PLATFORMS.has(platform)) {
    throw new Error(
      `Unsupported platform '${platform}'. Expected one of: ${[...VALID_PLATFORMS].join(", ")}`
    );
  }
  if (!/^[A-Za-z0-9/_+=.@-]+$/.test(secretName)) {
    throw new Error("--secret-name must be a valid Secrets Manager name");
  }
  return { project, platform, secretName };
}

function writeSetupScript(project) {
  const source = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    SCRIPT_NAME
  );
  const destination = path.join(project, "scripts", SCRIPT_NAME);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(source));
  chmodSync(destination, 0o700);
  return path.relative(project, destination);
}

function installCursorAdapter(project) {
  const environmentPath = path.join(project, ".cursor", "environment.json");
  mkdirSync(path.dirname(environmentPath), { recursive: true });

  const environment = existsSync(environmentPath)
    ? JSON.parse(readFileSync(environmentPath, "utf8"))
    : {};
  const existingInstall = environment.install;
  if (existingInstall !== undefined && typeof existingInstall !== "string") {
    throw new Error(
      `.cursor/environment.json install must be a string before Lisa can merge ${INSTALL_COMMAND}`
    );
  }
  const lisaInstall = `LISA_REMOTE_AGENT=cursor ${INSTALL_COMMAND}`;
  if (!existingInstall?.includes(SCRIPT_NAME)) {
    environment.install = existingInstall
      ? `${lisaInstall} && ${existingInstall}`
      : lisaInstall;
  }
  writeFileSync(environmentPath, `${JSON.stringify(environment, null, 2)}\n`);
  return path.relative(project, environmentPath);
}

function installCopilotAdapter(project) {
  const workflowPath = path.join(
    project,
    ".github",
    "workflows",
    "copilot-setup-steps.yml"
  );
  mkdirSync(path.dirname(workflowPath), { recursive: true });
  const marker = "Lisa remote AWS bootstrap";
  const step = [
    `      - name: ${marker}`,
    "        env:",
    "          LISA_REMOTE_AGENT: copilot",
    `        run: ${INSTALL_COMMAND}`,
  ].join("\n");

  if (!existsSync(workflowPath)) {
    writeFileSync(
      workflowPath,
      [
        'name: "Copilot Setup Steps"',
        "on:",
        "  workflow_dispatch:",
        "jobs:",
        "  copilot-setup-steps:",
        "    runs-on: ubuntu-latest",
        "    permissions:",
        "      contents: read",
        "    steps:",
        "      - uses: actions/checkout@v4",
        step,
        "",
      ].join("\n")
    );
    return path.relative(project, workflowPath);
  }

  const current = readFileSync(workflowPath, "utf8");
  if (current.includes(marker)) return path.relative(project, workflowPath);
  const lines = current.split("\n");
  const jobIndex = lines.findIndex(line =>
    /^\s{2}copilot-setup-steps:\s*$/.test(line)
  );
  const jobEndIndex = lines.findIndex(
    (line, index) => index > jobIndex && /^\s{2}\S[^:]*:\s*$/.test(line)
  );
  const stepsIndex = lines.findIndex(
    (line, index) =>
      index > jobIndex &&
      (jobEndIndex < 0 || index < jobEndIndex) &&
      /^\s{4}steps:\s*$/.test(line)
  );
  if (jobIndex < 0 || stepsIndex < 0) {
    throw new Error(
      "Existing copilot-setup-steps.yml must contain jobs.copilot-setup-steps.steps before Lisa can merge the AWS bootstrap step"
    );
  }
  const additions = current.includes("actions/checkout@")
    ? [step]
    : ["      - uses: actions/checkout@v4", step];
  lines.splice(stepsIndex + 1, 0, ...additions);
  writeFileSync(workflowPath, lines.join("\n"));
  return path.relative(project, workflowPath);
}

function writeGuide(project, platform, secretName) {
  const guidePath = path.join(project, "docs", "remote-agent-aws.md");
  mkdirSync(path.dirname(guidePath), { recursive: true });
  writeFileSync(
    guidePath,
    `# Remote coding-agent AWS access

This repository uses Lisa's vendor-neutral AWS bootstrap. Configure the complete
Secrets Manager SecretString as the secret \`LISA_AWS_BOOTSTRAP_JSON\`; do not
split it into \`AWS_ACCESS_KEY_ID\` and \`AWS_SECRET_ACCESS_KEY\` environment
variables. The setup script writes a named source profile whose only permission
is \`sts:AssumeRole\`, then creates automatically refreshed role profiles.

## Runtime configuration

| Runtime | Setup |
|---|---|
| Claude | Add \`LISA_AWS_BOOTSTRAP_JSON\` to the cloud environment, set \`LISA_REMOTE_AGENT=claude\`, and run \`${INSTALL_COMMAND}\` in the setup script. |
| Codex | Add \`LISA_AWS_BOOTSTRAP_JSON\` as a setup secret, set \`LISA_REMOTE_AGENT=codex\`, and run \`${INSTALL_COMMAND}\` in the setup script. Permit required AWS endpoints during the agent phase. |
| Cursor | Add the secret to the selected cloud environment. \`.cursor/environment.json\` runs the setup script with \`LISA_REMOTE_AGENT=cursor\`. |
| Copilot | Add the value as an organization-level **Agents** secret. \`copilot-setup-steps.yml\` runs the setup script with \`LISA_REMOTE_AGENT=copilot\`. |
| Antigravity | Direct AWS CLI is supported only on a user-managed remote host. Google's managed preview currently documents proxy-injected HTTP credentials, not arbitrary AWS credential files. |
| OpenCode | Run the setup script on the VPS/container that hosts \`opencode serve\`, with \`LISA_REMOTE_AGENT=opencode\`. OpenCode does not supply the host. |

Generated for: \`${platform}\`.

## Profiles

The bootstrap bundle defines the available profile names. \`dev\` is the
default when present. Select another account explicitly, for example:

\`\`\`bash
aws --profile staging sts get-caller-identity
aws --profile production cloudformation describe-stacks
\`\`\`

Production and shared profiles are observer-only. Production repair remains a
human-driven local-workstation operation.

## Administrator rollout

After the infrastructure pipeline deploys the remote-agent IAM stacks, retrieve
the complete bundle from the shared account. Do not extract or distribute its
individual access-key fields:

\`\`\`bash
aws --profile shared secretsmanager get-secret-value \\
  --secret-id ${secretName} \\
  --query SecretString \\
  --output text
\`\`\`

Store that exact output as the masked secret \`LISA_AWS_BOOTSTRAP_JSON\` on each
remote-agent platform. Run the setup command and require its live
\`sts:GetCallerIdentity\` check to pass before considering the platform ready.

Rotate by replacing the bootstrap IAM access key through infrastructure and
then updating this one secret on every configured platform. Disabling or
deleting the bootstrap user immediately prevents new role sessions.
`
  );
  return path.relative(project, guidePath);
}

export function installRemoteAgentAws(arguments_ = process.argv.slice(2)) {
  const { project, platform, secretName } = parseArguments(arguments_);
  if (!existsSync(project))
    throw new Error(`Project does not exist: ${project}`);

  const written = [writeSetupScript(project)];
  if (platform === "all" || platform === "cursor") {
    written.push(installCursorAdapter(project));
  }
  if (platform === "all" || platform === "copilot") {
    written.push(installCopilotAdapter(project));
  }
  written.push(writeGuide(project, platform, secretName));
  return { project, platform, secretName, written };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(installRemoteAgentAws(), null, 2)}\n`
    );
  } catch (error) {
    process.stderr.write(
      `install-remote-agent-aws: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
