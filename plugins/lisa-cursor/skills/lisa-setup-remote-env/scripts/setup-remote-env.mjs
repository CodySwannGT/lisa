#!/usr/bin/env node
/**
 * Prepare a remote environment: toolchain, then secrets, then the project hook.
 *
 * This is the script a remote environment's setup **and** maintenance fields
 * call. They are the same script on purpose. A container may be built fresh or
 * resumed from cache, and every step here is idempotent and version-aware, so
 * running it twice is correct.
 *
 * Order matters. The toolchain comes first because the secrets step needs the
 * provider CLI that the toolchain installs. The project hook comes last because
 * it is the only part that may assume everything else is ready.
 *
 * **Which phases run depends on the surface, and the reason is not cosmetic.**
 * On a surface that re-runs this script when a container resumes, materializing
 * here is what picks up a rotated value. On a surface that *skips* it whenever a
 * filesystem cache exists, materializing here would write the value once and
 * then never refresh it — a rotated credential would stay stale until the cache
 * expired. Those surfaces materialize from a session-start hook instead, which
 * runs every session including resumed ones, and `--phase=secrets` is how that
 * hook re-enters this file.
 *
 * The selection comes from the surface's `materializeAt` capability rather than
 * from its name, so adding a surface does not mean editing a branch here.
 *
 * Usage:
 *   setup-remote-env.mjs [--dry-run] [--phase=toolchain|secrets|hook]
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
import { fileURLToPath, pathToFileURL } from "node:url";

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

/** Phases this runner can execute, in the order they must happen. */
const PHASES = ["toolchain", "secrets", "hook"];

/**
 * The settings block that wires the session-start hook into a repository.
 *
 * Emitted rather than written, because `.claude/settings.json` belongs to the
 * project: it may already carry hooks, and merging someone else's file from
 * here is how a careless tool destroys a configuration it did not understand.
 */
const SESSION_START_BLOCK = `{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume",
        "hooks": [
          {
            "type": "command",
            "command": "bash \\"$CLAUDE_PROJECT_DIR\\"/scripts/lisa-remote-env/session-start.sh"
          }
        ]
      }
    ]
  }
}`;

/**
 * Produce the configuration a human pastes to provision a Claude cloud surface.
 *
 * This surface has no API tier and no console tier to fall back to: a Claude
 * cloud environment is configured only in the environment dialog, which has no
 * settings page, no direct URL, and no endpoint. Emit is not a degraded option
 * here, it is the only one — so the read-back in `verify-remote-env.mjs` is
 * what makes the result trustworthy, exactly as it would be at any other tier.
 * @param {{bootstrapKey: string|null, install: string}} options Project details.
 * @returns {string} Text to show the operator.
 */
export function emitClaudeWeb({ bootstrapKey, install }) {
  const key = bootstrapKey ?? "<secrets.bootstrap.key is not configured>";
  return [
    "Provisioning tier: EMIT — and for this surface that is the only tier.",
    "  A Claude cloud environment is account-scoped configuration edited in the",
    "  environment selector at claude.ai/code. There is no settings page, no",
    "  direct URL and no API, so nothing here can provision it for you.",
    "",
    "Paste into the environment dialog",
    "---------------------------------",
    "  Network access:  Trusted, or Custom plus any host your project needs",
    "",
    "  Environment variables:",
    `    ${key}=<read this from your credential manager>`,
    "",
    "    Only the bootstrap belongs in this box. Values here are stored as",
    "    plain text and are readable by anyone who uses the environment — on an",
    "    organization-shared environment that is every member of the org. Every",
    "    other credential is materialized by the session-start hook below, which",
    "    is why exactly one value needs to live here.",
    "",
    "  Setup script:",
    `    ${install} && bash scripts/lisa-remote-env/setup.sh`,
    "",
    "    The install must come first. On a fresh container node_modules is the",
    "    only copy of the Lisa skills present, because Claude receives them as",
    "    an installed plugin rather than as part of the clone.",
    "",
    "Commit to the repository",
    "------------------------",
    "  scripts/lisa-remote-env/session-start.sh   (from this skill's assets)",
    "",
    "  .claude/settings.json — merge this into any hooks already there:",
    SESSION_START_BLOCK.split("\n")
      .map(line => `    ${line}`)
      .join("\n"),
    "",
    "    The setup script is skipped whenever a cached environment exists, so",
    "    secrets are materialized from this hook instead. It runs every session,",
    "    including a resumed one, which is what keeps a rotated value current.",
    "",
    "Worth knowing about this base image",
    "-----------------------------------",
    "  The GitHub CLI is not pre-installed. If this project's flows shell out to",
    "  `gh`, add it to remoteEnv.tools.install with a pinned version and",
    "  checksum, the same as any other tool.",
    "",
    "  A credential handled by the GitHub proxy reads as the literal string",
    '  "proxy-injected" inside the session. Tools that authenticate through the',
    "  proxy work; a script that reads the variable itself gets the placeholder.",
    "",
    "Then prove it",
    "-------------",
    "  Start a session and run the read-back. Whatever provisioned an",
    "  environment, the same verify is what makes it trustworthy:",
    "    node node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-setup-remote-env/scripts/verify-remote-env.mjs",
  ].join("\n");
}

/**
 * Decide which phases this invocation runs.
 *
 * An explicit `--phase` always wins, because that is how a session-start hook
 * asks for the one phase it owns. Otherwise every phase runs except a secrets
 * step that belongs to a different moment on this surface — running it here
 * would produce a copy that the surface never refreshes.
 * @param {string|undefined} requested Value of `--phase`, when given.
 * @param {string|null} materializeAt When this surface materializes.
 * @returns {string[]} Phases to run, in order.
 */
export function selectPhases(requested, materializeAt) {
  if (requested) {
    if (!PHASES.includes(requested)) {
      throw new Error(
        `unknown --phase "${requested}". Known: ${PHASES.join(", ")}.`
      );
    }
    if (requested === "secrets" && materializeAt !== "session-start") {
      // Not an error: the hook is committed to the repository and runs on every
      // surface the project is ever checked out on. Refusing loudly would make
      // a correct local session look broken every time it started.
      return [];
    }
    return [requested];
  }
  return PHASES.filter(
    phase => phase !== "secrets" || materializeAt === "setup"
  );
}

/**
 * Read the surface the resolver detects, without duplicating its rules.
 *
 * Imported rather than shelled out to, because the answer is a pure function of
 * the environment and a subprocess would buy nothing. The path is converted to
 * a file URL first: a bare absolute path is not a portable module specifier.
 * @returns {Promise<{surface: string, materializeAt: string|null}>} Detected surface.
 */
async function detectSurface() {
  const script = siblingScript("lisa-secrets-access", "surfaces.mjs");
  const mod = await import(pathToFileURL(script).href);
  const surface = mod.detectSurface();
  return { surface, materializeAt: mod.SURFACES[surface].materializeAt };
}

/**
 * Name the project's own install command rather than inventing one.
 *
 * The emitted setup line must begin with whatever this project already uses; a
 * guessed package manager produces a container that fails on its first command.
 * @param {string} [cwd] Repository root.
 * @returns {string} The install command to place before the setup script.
 */
export function detectInstallCommand(cwd = process.cwd()) {
  const lockfiles = [
    ["bun.lockb", "bun install"],
    ["bun.lock", "bun install"],
    ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
    ["yarn.lock", "yarn install --immutable"],
    ["package-lock.json", "npm ci"],
  ];
  for (const [file, command] of lockfiles) {
    if (existsSync(join(cwd, file))) return command;
  }
  return "<your install command>";
}

/**
 * Read the bootstrap key name, which is the one value the operator must paste.
 * @param {string} [cwd] Repository root.
 * @returns {string|null} The configured key name, when there is one.
 */
function readBootstrapKey(cwd = process.cwd()) {
  const path = join(cwd, ".lisa.config.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")).secrets?.bootstrap?.key ?? null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const emit = process.argv
    .find(arg => arg.startsWith("--emit="))
    ?.slice("--emit=".length);

  if (emit) {
    if (emit !== "claude-web") {
      throw new Error(
        `no emit template for surface "${emit}".\n` +
          `Emitting is implemented for claude-web, which has no other tier.`
      );
    }
    console.log(
      emitClaudeWeb({
        bootstrapKey: readBootstrapKey(),
        install: detectInstallCommand(),
      })
    );
    return;
  }

  const requested = process.argv
    .find(arg => arg.startsWith("--phase="))
    ?.slice("--phase=".length);
  const cfg = readRemoteEnvConfig();
  const { surface, materializeAt } = await detectSurface();
  const phases = selectPhases(requested, materializeAt);

  if (!phases.length) {
    console.log(
      `Nothing to do: surface "${surface}" does not materialize from a ` +
        `session-start hook.`
    );
    return;
  }

  if (phases.includes("toolchain")) {
    console.log("Toolchain:");
    applyToolchain(cfg.tools, dryRun);
  }

  if (phases.includes("secrets")) {
    console.log("\nSecrets:");
    const materialize = siblingScript(
      "lisa-secrets-access",
      "materialize-secrets.mjs"
    );
    execFileSync("node", dryRun ? [materialize, "--dry-run"] : [materialize], {
      stdio: "inherit",
    });
  } else if (!requested) {
    console.log(
      `\nSecrets: materialized from a session-start hook on "${surface}", ` +
        `not here.\n` +
        `  This script is skipped whenever a cached environment exists, so a ` +
        `value written\n  here would go stale the moment it was rotated. The ` +
        `hook runs every session.`
    );
  }

  if (phases.includes("hook")) runHook(cfg.hook, dryRun);
  console.log(`\nRemote environment ${dryRun ? "plan complete" : "ready"}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Awaited rather than called bare: main is async, so a synchronous try/catch
  // would let a rejected promise escape as an unhandled rejection and exit 0 —
  // reporting a prepared environment that was never prepared.
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
