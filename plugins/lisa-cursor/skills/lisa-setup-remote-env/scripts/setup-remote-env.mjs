#!/usr/bin/env node
/**
 * Prepare a remote environment: toolchain, then secrets, then the project hook.
 *
 * This is the script a remote environment's setup **and** maintenance fields
 * call. They are the same script on purpose. A container may be built fresh or
 * resumed from cache, and every step here is idempotent and version-aware, so
 * running it twice is correct and running it on resume is what picks up a
 * rotated value, an edited note, or a changed version pin.
 *
 * Order matters. The toolchain comes first because the secrets step needs the
 * provider CLI that the toolchain installs. The project hook comes last because
 * it is the only part that may assume everything else is ready.
 *
 * Usage:
 *   setup-remote-env.mjs [--dry-run]
 * @module setup-remote-env
 */

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertPinned, extractVersion, planToolchain } from "./toolchain.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locate a sibling skill's script.
 *
 * Secrets belong to `lisa-secrets-access`, and this script must not reimplement
 * any part of that contract — the single chokepoint is what makes the one-store
 * rule enforceable. Resolving relative to this file works in every install
 * layout, because skills are always siblings under one `skills/` directory.
 * @param {string} skill Sibling skill slug.
 * @param {string} script Script filename.
 * @returns {string} Absolute path.
 */
function siblingScript(skill, script) {
  const path = resolve(HERE, "..", "..", skill, "scripts", script);
  if (!existsSync(path)) {
    throw new Error(
      `cannot find ${skill}/scripts/${script} beside this skill.\n` +
        `Remote setup composes with that skill rather than reimplementing it.`
    );
  }
  return path;
}

/**
 * Read the `remoteEnv` block from `.lisa.config.json`.
 * @param {string} [cwd] Directory to look in.
 * @returns {{tools: object, hook: string|null, surfaces: object}} Configuration.
 */
export function readRemoteEnvConfig(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  const defaults = {
    tools: { require: [], install: [] },
    hook: null,
    surfaces: {},
  };
  if (!existsSync(path)) return defaults;
  const cfg = JSON.parse(readFileSync(path, "utf8")).remoteEnv;
  if (!cfg) return defaults;
  return {
    tools: { require: [], install: [], ...(cfg.tools ?? {}) },
    hook: cfg.hook ?? null,
    surfaces: cfg.surfaces ?? {},
  };
}

/**
 * Probe what a tool reports for its version, treating absence as not present.
 * @param {string} name Executable name.
 * @returns {{version: string|null, present: boolean}} Probe result.
 */
function probe(name) {
  try {
    const out = execFileSync(name, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { present: true, version: extractVersion(out) };
  } catch {
    return { present: false, version: null };
  }
}

/**
 * Install a pinned archive, refusing anything whose checksum does not match.
 * @param {object} tool Manifest entry.
 * @param {string} binDir Directory to install into.
 */
function installReleaseZip(tool, binDir) {
  const temporary = join(binDir, `.${tool.name}-download`);
  mkdirSync(temporary, { recursive: true });
  try {
    const archive = join(temporary, "download.zip");
    execFileSync("curl", ["-fsSL", tool.url, "-o", archive], {
      stdio: "inherit",
    });
    // Verify before unpacking, not after. An unexpected archive must fail
    // before any of its contents reach a directory that is on PATH.
    execFileSync("sha256sum", ["-c", "-"], {
      input: `${tool.sha256}  ${archive}\n`,
      stdio: ["pipe", "ignore", "inherit"],
    });
    execFileSync("unzip", ["-q", "-o", archive, "-d", temporary], {
      stdio: "inherit",
    });
    const binary = join(temporary, tool.binary ?? tool.name);
    execFileSync("install", ["-m", "0755", binary, join(binDir, tool.name)], {
      stdio: "inherit",
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Install a pinned global npm package.
 * @param {object} tool Manifest entry.
 */
function installNpmGlobal(tool) {
  execFileSync(
    "npm",
    ["install", "--global", `${tool.package}@${tool.version}`],
    {
      stdio: "inherit",
    }
  );
}

/**
 * Execute one install decision.
 * @param {object} tool Manifest entry.
 * @param {string} binDir Directory for downloaded binaries.
 */
function installTool(tool, binDir) {
  assertPinned(tool);
  if (tool.install === "release-zip") installReleaseZip(tool, binDir);
  else installNpmGlobal(tool);
}

/**
 * Apply the toolchain plan, reporting every decision.
 * @param {object} tools Manifest.
 * @param {boolean} dryRun Whether to plan only.
 * @returns {Array<object>} The plan that was applied.
 */
function applyToolchain(tools, dryRun) {
  const plan = planToolchain(tools, probe);
  const blocked = plan.filter(
    p => p.action === "missing" || p.action === "invalid"
  );
  if (blocked.length) {
    throw new Error(blocked.map(p => p.reason).join("\n\n"));
  }

  const binDir = join(process.env.HOME ?? "", ".local", "bin");
  mkdirSync(binDir, { recursive: true, mode: 0o755 });
  const byName = new Map((tools.install ?? []).map(t => [t.name, t]));

  for (const step of plan) {
    console.log(`  ${step.action.padEnd(8)} ${step.reason}`);
    if (step.action === "install" && !dryRun)
      installTool(byName.get(step.name), binDir);
  }
  return plan;
}

/**
 * Run the project's own setup hook when it has one.
 *
 * A declarative manifest will never cover everything, and without an escape
 * hatch a project's only option is to fork Lisa's script — at which point it
 * stops receiving any of the fixes.
 * @param {string|null} hook Repository-relative path.
 * @param {boolean} dryRun Whether to plan only.
 */
function runHook(hook, dryRun) {
  if (!hook) return;
  const path = resolve(process.cwd(), hook);
  if (!existsSync(path)) {
    throw new Error(`remoteEnv.hook points at ${hook}, which does not exist`);
  }
  console.log(`\nProject hook: ${hook}`);
  if (dryRun) return;
  chmodSync(path, 0o755);
  execFileSync("bash", [path], { stdio: "inherit" });
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const cfg = readRemoteEnvConfig();

  console.log("Toolchain:");
  applyToolchain(cfg.tools, dryRun);

  console.log("\nSecrets:");
  const materialize = siblingScript(
    "lisa-secrets-access",
    "materialize-secrets.mjs"
  );
  execFileSync("node", dryRun ? [materialize, "--dry-run"] : [materialize], {
    stdio: "inherit",
  });

  runHook(cfg.hook, dryRun);
  console.log(`\nRemote environment ${dryRun ? "plan complete" : "ready"}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
