#!/usr/bin/env node
/**
 * Bootstrap a machine before there is a repository to read.
 *
 * `/lisa:setup:local-env` is project-bound by design: it reads
 * `.lisa.config.json`. A fresh workstation or throwaway container has no such
 * file yet, but Lisa still needs the same basic substrate: supported agent CLIs
 * plus universal factory tools.
 *
 * Vendor installers are intentionally a separate kind. They are not pinned or
 * checksummed, so the report names that trust boundary instead of letting them
 * masquerade as `remoteEnv.tools` archive pins.
 * @module workstation-bootstrap
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const AGENTS = [
  {
    name: "claude",
    command: "claude",
    kind: "vendor",
    installer: [
      "bash",
      "-lc",
      "curl -fsSL https://claude.ai/install.sh | bash",
    ],
    note: "Anthropic native installer; self-updating install tree.",
  },
  {
    name: "codex",
    command: "codex",
    kind: "vendor",
    installer: ["npm", ["install", "--global", "@openai/codex@latest"]],
    note: "OpenAI npm-distributed CLI.",
  },
  {
    name: "cursor",
    command: "cursor-agent",
    kind: "vendor",
    installer: ["bash", "-lc", "curl -fsSL https://cursor.com/install | bash"],
    note: "Cursor native installer for cursor-agent.",
  },
  {
    name: "opencode",
    command: "opencode",
    kind: "vendor",
    installer: ["bash", "-lc", "curl -fsSL https://opencode.ai/install | bash"],
    note: "OpenCode native installer.",
  },
  {
    name: "agy",
    command: "agy",
    kind: "vendor",
    installer: [
      "bash",
      "-lc",
      "curl -fsSL https://antigravity.google/cli/install.sh | bash",
    ],
    note: "Google Antigravity native installer.",
  },
  {
    name: "copilot",
    command: "copilot",
    kind: "manual",
    note: "GitHub Copilot CLI install methods vary by account/channel; detect only until a stable vendor installer is declared.",
  },
];

const PINNED_UNIVERSAL = [
  {
    name: "bws",
    version: "2.1.0",
    platforms: {
      "linux-x64": {
        install: "release-zip",
        url: "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-x86_64-unknown-linux-gnu-2.1.0.zip",
        sha256:
          "ba8233c3a4aee5d43e3c73bbd04d99e9bc5aba13bbbfd06d89b073abe732b860",
      },
      "darwin-arm64": {
        install: "release-zip",
        url: "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-aarch64-apple-darwin-2.1.0.zip",
        sha256:
          "9cb1c1c6e6164d83b2e339883ba02b4cbb37188ce9a484b1ce8249443163e066",
      },
      "darwin-x64": {
        install: "release-zip",
        url: "https://github.com/bitwarden/sdk-sm/releases/download/bws-v2.1.0/bws-x86_64-apple-darwin-2.1.0.zip",
        sha256:
          "6f626b3971368902af1b9847c02791a1b4666969d7561e2047681cded7997537",
      },
    },
  },
  {
    name: "gh",
    version: "2.83.0",
    platforms: {
      "linux-x64": {
        install: "release-tar",
        url: "https://github.com/cli/cli/releases/download/v2.83.0/gh_2.83.0_linux_amd64.tar.gz",
        sha256:
          "a5cf6cdb40fc67751adf561126b3314044779cea81ba4f254fbe8e9a69f1676f",
        binary: "gh_2.83.0_linux_amd64/bin/gh",
      },
      "darwin-arm64": {
        install: "release-zip",
        url: "https://github.com/cli/cli/releases/download/v2.83.0/gh_2.83.0_macOS_arm64.zip",
        sha256:
          "fecba907bc361d5e33620dbf1145f11432c39fb2b388a839463cfbb89a84820b",
        binary: "gh_2.83.0_macOS_arm64/bin/gh",
      },
      "darwin-x64": {
        install: "release-zip",
        url: "https://github.com/cli/cli/releases/download/v2.83.0/gh_2.83.0_macOS_amd64.zip",
        sha256:
          "0c0de650752bb92d7283e386cafd03d9ac5f47028c648c4ab821ef08a75c0716",
        binary: "gh_2.83.0_macOS_amd64/bin/gh",
      },
    },
  },
];

const VENDOR_UNIVERSAL = [
  {
    name: "aws",
    command: "aws",
    kind: "manual",
    note: "AWS CLI is installer-managed and large; install with the official AWS CLI package for this OS.",
  },
  {
    name: "sonar",
    command: "sonar",
    kind: "manual",
    note: "SonarQube CLI is installer-managed; use the vendor package or Homebrew cask where appropriate.",
  },
];

/**
 * Locate a sibling script from lisa-setup-remote-env.
 * @param {string} script Script filename.
 * @returns {string} Absolute path.
 */
function remoteEnvScript(script) {
  const path = resolve(
    HERE,
    "..",
    "..",
    "lisa-setup-remote-env",
    "scripts",
    script
  );
  if (!existsSync(path)) {
    throw new Error(`cannot find lisa-setup-remote-env/scripts/${script}`);
  }
  return path;
}

/**
 * Import the toolchain helpers owned by the remote/local env flow.
 * @returns {Promise<object>} Helper functions.
 */
async function loadToolchain() {
  const toolchain = await import(
    pathToFileURL(remoteEnvScript("toolchain.mjs")).href
  );
  const setup = await import(
    pathToFileURL(remoteEnvScript("setup-remote-env.mjs")).href
  );
  return { ...toolchain, ...setup };
}

/**
 * Parse CLI args.
 * @param {string[]} args Raw argv tail.
 * @returns {object} Parsed options.
 */
export function parseArgs(args) {
  const agentsArg = args.find(arg => arg.startsWith("--agents="));
  return {
    yes: args.includes("--yes"),
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json"),
    platform: args.find(arg => arg.startsWith("--platform="))?.slice(11),
    agents: agentsArg
      ? agentsArg
          .slice("--agents=".length)
          .split(",")
          .map(value => value.trim())
          .filter(Boolean)
      : null,
  };
}

/**
 * Probe a command with the shared remote-env probe.
 * @param {string} command CLI command name.
 * @param {Function} probe Probe function.
 * @returns {{present: boolean, version: string|null}} Probe result.
 */
function probeCommand(command, probe) {
  return probe(command);
}

/**
 * Plan vendor/manual entries.
 * @param {object[]} entries Tool entries.
 * @param {Function} probe Probe function.
 * @returns {object[]} Plan rows.
 */
function planVendor(entries, probe) {
  return entries.map(entry => {
    const found = probeCommand(entry.command, probe);
    if (found.present) {
      return {
        name: entry.name,
        command: entry.command,
        kind: entry.kind,
        action: "present",
        reason: `${entry.command} ${found.version ?? ""}`.trim(),
        note: entry.note,
      };
    }
    return {
      name: entry.name,
      command: entry.command,
      kind: entry.kind,
      action: entry.kind === "vendor" ? "install" : "manual",
      reason:
        entry.kind === "vendor"
          ? `${entry.command} is absent; vendor installer available`
          : `${entry.command} is absent; manual vendor setup required`,
      installer: entry.installer,
      note: entry.note,
    };
  });
}

/**
 * Execute one vendor installer command.
 * @param {string|Array} installer Command shape.
 * @param {Function} exec Executor seam.
 */
function runInstaller(installer, exec) {
  if (Array.isArray(installer[1])) {
    exec(installer[0], installer[1], { stdio: "inherit" });
    return;
  }
  exec(installer[0], installer.slice(1), { stdio: "inherit" });
}

/**
 * Build the complete workstation plan.
 * @param {object} options Run options.
 * @param {object} deps Injectable dependencies.
 * @returns {Promise<object>} Plan object.
 */
export async function plan(options = {}, deps = {}) {
  const env = deps.env ?? (await loadToolchain());
  const probe = deps.probe ?? env.probe;
  const platform = options.platform ?? env.currentPlatform();
  const wanted = new Set(options.agents ?? AGENTS.map(agent => agent.name));
  const unknown = [...wanted].filter(
    name => !AGENTS.some(agent => agent.name === name)
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown agent(s): ${unknown.join(", ")}. Known: ${AGENTS.map(agent => agent.name).join(", ")}.`
    );
  }

  const agentPlan = planVendor(
    AGENTS.filter(agent => wanted.has(agent.name)),
    probe
  );
  const pinned = env.planToolchain(
    { install: PINNED_UNIVERSAL },
    probe,
    "local",
    platform
  );
  const vendorUniversal = planVendor(VENDOR_UNIVERSAL, probe);
  return {
    platform,
    agents: agentPlan,
    universal: [...pinned, ...vendorUniversal],
  };
}

/**
 * Run the workstation bootstrap command.
 * @param {object} options Parsed options.
 * @param {object} deps Injectable dependencies.
 * @returns {Promise<number>} Exit code.
 */
export async function run(options = {}, deps = {}) {
  const env = deps.env ?? (await loadToolchain());
  const exec = deps.exec ?? execFileSync;
  const result = await plan(options, { ...deps, env });
  const rows = [...result.agents, ...result.universal];
  const blocked = rows.filter(row => row.action === "invalid");
  const installable = rows.filter(row => row.action === "install");
  const manual = rows.filter(row => row.action === "manual");

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return blocked.length ? 1 : 0;
  }

  console.log(`Workstation bootstrap for ${result.platform}\n`);
  for (const row of rows) {
    const kind = row.kind ?? "pinned";
    console.log(
      `  ${row.action.padEnd(8)} ${String(kind).padEnd(7)} ${row.reason.split("\n")[0]}`
    );
    if (row.action === "install" && kind === "vendor") {
      console.log(`           ${row.note}`);
    }
  }

  if (!options.yes && installable.length > 0) {
    console.log(
      `\n${installable.length} missing tool(s) can be installed. Nothing was installed.\n` +
        `Re-run with --yes to execute vendor installers and pinned archive installs.`
    );
  }

  if (options.yes) {
    const binDir =
      options.dryRun || installable.length === 0 ? null : env.ensureBinDir();
    for (const row of installable) {
      if (options.dryRun) {
        console.log(`\nWould install ${row.name}`);
        continue;
      }
      console.log(`\nInstalling ${row.name}`);
      if (row.kind === "vendor") runInstaller(row.installer, exec);
      else env.installTool(row.tool, binDir);
    }
  }

  if (manual.length > 0) {
    console.log(`\n${manual.length} tool(s) require manual vendor setup:`);
    for (const row of manual) console.log(`  ${row.command} - ${row.note}`);
  }

  return blocked.length ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run(parseArgs(process.argv.slice(2))).then(
    code => {
      process.exitCode = code;
    },
    err => {
      console.error(err.message);
      process.exitCode = 1;
    }
  );
}
