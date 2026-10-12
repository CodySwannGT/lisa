#!/usr/bin/env node
/**
 * Bring a developer's machine in line with the toolchain the project declares.
 *
 * The manifest, the planner, the pins and the installers are the remote flow's,
 * unchanged and imported — this is the surface that was missing, not a second
 * implementation. `remoteEnv.tools` was always surface-aware and the executor
 * always understood `local`; the only way to reach either was to run a file
 * called `setup-remote-env.mjs` out of a directory called `lisa-remote-env`,
 * which nobody looking for local setup ever found.
 *
 * Two things differ from the remote flow, and both are because a person is here:
 *
 *   consent  — a container provisions itself silently because it is disposable
 *              and nobody is watching. A laptop belongs to someone, so nothing
 *              is installed until they ask with --install-tools.
 *
 *   tolerance — a container that cannot be fully provisioned should fail before
 *              it half-runs, because there is no one to read the report. A
 *              developer can act on a list, so an unprovisionable tool is
 *              reported, everything else is still installed, and the exit code
 *              carries the failure.
 * @module local-env
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a script belonging to a sibling skill.
 *
 * Skills are always siblings under one `skills/` directory, in every install
 * layout, so this holds for a plugin install, a checkout, and node_modules
 * alike. Failing loudly here beats reimplementing what the sibling owns.
 * @param {string} skill Sibling skill slug.
 * @param {string} script Script filename.
 * @returns {string} Absolute path.
 */
function siblingScript(skill, script) {
  const path = resolve(HERE, "..", "..", skill, "scripts", script);
  if (!existsSync(path)) {
    throw new Error(
      `cannot find ${skill}/scripts/${script} beside this skill.\n` +
        `Local setup composes with that skill rather than reimplementing it: ` +
        `the pins, checksums and installers must be the same ones the remote ` +
        `surface uses, or the two drift and only one gets fixed.`
    );
  }
  return path;
}

/**
 * Load the pieces the remote flow owns.
 * @returns {Promise<object>} The imported helpers.
 */
async function loadRemoteEnv() {
  const setup = await import(
    pathToFileURL(
      siblingScript("lisa-setup-remote-env", "setup-remote-env.mjs")
    ).href
  );
  const toolchain = await import(
    pathToFileURL(siblingScript("lisa-setup-remote-env", "toolchain.mjs")).href
  );
  return { ...toolchain, ...setup };
}

/**
 * Describe one blocked decision in terms a person can act on.
 *
 * A blocked step on a laptop is usually one of two things, and they are fixed
 * differently: a tool the project requires and the machine lacks (install it),
 * or a tool with no artifact pinned for this platform (add the pin, or install
 * it however this platform normally would). Printing the planner's reason alone
 * left the reader to work out which.
 * @param {object} step A plan step.
 * @param {string} platform The platform key that was resolved against.
 * @returns {string} A rendered block.
 */
function explainBlocked(step, platform) {
  if (step.action === "invalid" && step.reason.includes("no pin for")) {
    return (
      `  ${step.name} — declared, but no artifact is pinned for ${platform}.\n` +
      `      Lisa will not guess a download URL, because a guessed artifact is ` +
      `one the checksum cannot vouch for.\n` +
      `      Add a "${platform}" block under this tool's "platforms" map, or ` +
      `install it yourself.`
    );
  }
  return `  ${step.name} — ${step.reason.split("\n")[0]}`;
}

/**
 * Report and optionally apply the local toolchain.
 * @param {object} argv Parsed arguments.
 * @returns {Promise<number>} Process exit code.
 */
export async function run(argv) {
  const env = await loadRemoteEnv();
  // Both seams exist for tests, and both default to this machine. A platform
  // that can only be exercised by running on it is one CI will never cover,
  // which is how a resolution bug ships to the platform nobody tested.
  const platform = argv.platform ?? env.currentPlatform();
  const { tools } = env.readRemoteEnvConfig(argv.cwd);

  const declared = (tools.require ?? []).length + (tools.install ?? []).length;
  if (declared === 0) {
    console.log(
      "No tools are declared in remoteEnv.tools, so there is nothing to check.\n" +
        "Run /lisa:detect-tooling — it reads npm scripts, MCP servers, " +
        "credential\nnotes and quality config, and proposes pinned entries for " +
        "what it finds."
    );
    return 0;
  }

  const plan = env.planToolchain(tools, env.probe, "local", platform);
  const blocked = plan.filter(
    step => step.action === "missing" || step.action === "invalid"
  );
  const installable = plan.filter(step => step.action === "install");

  if (argv.json) {
    console.log(JSON.stringify({ platform, plan }, null, 2));
    return blocked.length ? 1 : 0;
  }

  console.log(`Local toolchain for ${platform}\n`);
  for (const step of plan) {
    console.log(`  ${step.action.padEnd(8)} ${step.reason.split("\n")[0]}`);
  }

  if (installable.length && !argv.installTools) {
    console.log(
      `\n${installable.length} declared tool(s) can be installed here.\n` +
        `Nothing has been installed: this machine is yours, not a container.\n` +
        `Re-run with --install-tools to provision them into ~/.local/bin.`
    );
  }

  if (installable.length && argv.installTools) {
    const binDir = env.ensureBinDir();
    console.log(`\nInstalling into ${binDir}`);
    for (const step of installable) {
      console.log(`  ${step.name}`);
      if (!argv.dryRun) env.installTool(step.tool, binDir);
    }
  }

  if (blocked.length) {
    console.log(`\n${blocked.length} tool(s) this command cannot resolve:\n`);
    for (const step of blocked) console.log(explainBlocked(step, platform));
    return 1;
  }

  return 0;
}

/**
 * Whether this module is the one node was asked to run.
 *
 * Both sides are realpath'd: a raw URL comparison answers "no" through a
 * symlinked checkout, a git worktree, or a /tmp path on macOS, so the module
 * loads, runs nothing and exits 0 — a silent no-op that reads as success.
 *
 * A local copy rather than an import: plugin payload scripts ship standalone,
 * with no `lib/` sibling to import from once installed.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  const argv = {
    installTools: process.argv.includes("--install-tools"),
    dryRun: process.argv.includes("--dry-run"),
    json: process.argv.includes("--json"),
  };
  run(argv)
    .then(code => process.exit(code))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
