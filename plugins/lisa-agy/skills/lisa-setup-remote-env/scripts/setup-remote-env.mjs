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
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
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
 *
 * "Not installed" and "dislikes `--version`" are different answers, and only a
 * failure to *spawn* means the first. Info-ZIP's `unzip` — the build shipped by
 * both macOS and Ubuntu — parses `--version` one letter at a time, warns that
 * `-n` and `-o` conflict, and exits 10. Reading that as absence made `require`
 * fail on a machine that had the tool, which is precisely the false alarm the
 * check exists to avoid raising.
 *
 * Version text is still recovered from a failed invocation where there is any,
 * because a tool that refuses the flag often prints its banner anyway — which
 * is how `unzip` still reports 6.00 despite exiting non-zero.
 *
 * The runner is injectable so both branches can be exercised without depending
 * on which quirky binaries happen to exist on the machine running the tests.
 * @param {string} name Executable name.
 * @param {Function} [exec] Command runner, for tests.
 * @returns {{version: string|null, present: boolean}} Probe result.
 */
export function probe(name, exec = execFileSync) {
  try {
    const out = exec(name, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { present: true, version: extractVersion(out) };
  } catch (err) {
    if (err.code === "ENOENT") return { present: false, version: null };
    const output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    return { present: true, version: extractVersion(output) };
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
 * Install a pinned tarball, refusing anything whose checksum does not match.
 *
 * Same contract as the zip path and the same ordering — verify, then unpack —
 * because an unexpected archive must fail before any of its contents reach a
 * directory that is on PATH. It exists because several tools worth pinning
 * publish no zip for Linux: gh ships .deb, .rpm and .tar.gz and nothing else.
 * @param {object} tool Manifest entry.
 * @param {string} binDir Directory to install into.
 */
function installReleaseTar(tool, binDir) {
  const temporary = join(binDir, `.${tool.name}-download`);
  mkdirSync(temporary, { recursive: true });
  try {
    const archive = join(temporary, "download.tar.gz");
    execFileSync("curl", ["-fsSL", tool.url, "-o", archive], {
      stdio: "inherit",
    });
    execFileSync("sha256sum", ["-c", "-"], {
      input: `${tool.sha256}  ${archive}\n`,
      stdio: ["pipe", "ignore", "inherit"],
    });
    execFileSync("tar", ["-xzf", archive, "-C", temporary], {
      stdio: "inherit",
    });
    // Release tarballs usually nest under a versioned directory, so `binary` is
    // a path within the archive rather than a bare name.
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
  else if (tool.install === "release-tar") installReleaseTar(tool, binDir);
  else installNpmGlobal(tool);
}

/**
 * Apply the toolchain plan, reporting every decision.
 * @param {object} tools Manifest.
 * @param {boolean} dryRun Whether to plan only.
 * @returns {Array<object>} The plan that was applied.
 */
function applyToolchain(tools, dryRun, options = {}) {
  const { surface = "remote", consent = true } = options;
  const plan = planToolchain(tools, probe, surface);
  const blocked = plan.filter(
    p => p.action === "missing" || p.action === "invalid"
  );
  if (blocked.length) {
    throw new Error(blocked.map(p => p.reason).join("\n\n"));
  }

  const binDir = join(process.env.HOME ?? "", ".local", "bin");
  mkdirSync(binDir, { recursive: true, mode: 0o755 });
  const byName = new Map((tools.install ?? []).map(t => [t.name, t]));

  // Installing is a different act on a laptop than in a container. A container
  // is disposable and provisioning it silently is the whole point; a developer
  // machine belongs to a person, and putting pinned binaries in their
  // ~/.local/bin without being asked is not ours to decide. So the same
  // manifest drives both, and only the consent differs.
  //
  // Reporting still happens either way — knowing the machine diverges from what
  // the project declares is most of the value, and is what nothing did before.
  if (!consent) {
    const missing = plan.filter(step => step.action === "install");
    if (missing.length === 0) {
      console.log("  every declared tool is already present");
      return plan;
    }
    console.log(
      `  ${missing.length} declared tool(s) are missing or below their pin:`
    );
    for (const step of missing) {
      const tool = byName.get(step.name);
      console.log(`    ${step.name}${tool?.version ? ` ${tool.version}` : ""}`);
    }
    console.log(
      "\n  Not installing without confirmation. Re-run with --install-tools\n" +
        "  to provision them, or install them yourself."
    );
    return plan;
  }

  // Installing a binary somewhere nothing looks is the same as not installing
  // it. `~/.local/bin` is on PATH by default on a developer workstation and is
  // NOT on a minimal container, so the toolchain step reported `install bws`,
  // the file landed at ~/.local/bin/bws mode 755, and the very next step died
  // with `spawnSync bws ENOENT`.
  //
  // This was invisible in every local test because a workstation shell already
  // exports the directory — the environment doing the hiding was the one used
  // to verify the fix.
  //
  // Prepended, not appended: a pinned-and-checksummed binary must win over
  // whatever an image happens to ship under the same name.
  if (!pathContains(binDir)) {
    process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
  }

  for (const step of plan) {
    console.log(`  ${step.action.padEnd(8)} ${step.reason}`);
    if (step.action === "install" && !dryRun)
      installTool(byName.get(step.name), binDir);
  }
  return plan;
}

/**
 * Whether a directory is already on PATH.
 *
 * Compared entry by entry rather than by substring: a substring test would
 * consider `/root/.local/bin` present because `/root/.local/bin/extra` is, and
 * would then skip the prepend that makes the tool findable.
 * @param {string} dir Directory to look for.
 * @returns {boolean} True when PATH already contains exactly that entry.
 */
export function pathContains(dir, path = process.env.PATH ?? "") {
  return path.split(delimiter).filter(Boolean).includes(dir);
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

/** Where a host project keeps the scripts its remote environment invokes. */
export const INSTALL_DIR = join("scripts", "lisa-remote-env");

/** Assets a host project needs on disk before any remote session can start. */
const INSTALLABLE = ["setup.sh", "session-start.sh"];

/**
 * Copy this skill's assets into the host project that will run them.
 *
 * These live in the skill, but the paths that reference them are *repository*
 * paths: a vendor's setup field says `bash scripts/lisa-remote-env/setup.sh`,
 * and a session-start hook is only committed if it is a real file in the repo.
 * Nothing put them there, so every reference resolved to a path that did not
 * exist — the environment came up, ran a missing script, exited non-zero, and
 * the session failed to start with no indication that a setup step was skipped.
 *
 * Copied rather than symlinked or generated: the file must survive in a fresh
 * clone on a container that has never seen the plugin, which is the whole
 * reason the entrypoint is thin enough to copy in the first place.
 * @param {string} [cwd] Repository root.
 * @returns {Array<{name: string, action: string}>} What was written.
 */
export function installAssets(cwd = process.cwd()) {
  const destination = join(cwd, INSTALL_DIR);
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  return INSTALLABLE.map(name => {
    const source = resolve(HERE, "..", "assets", name);
    if (!existsSync(source)) {
      throw new Error(`asset ${name} is missing from this skill install`);
    }
    const target = join(destination, name);
    const desired = readFileSync(source, "utf8");
    const unchanged =
      existsSync(target) && readFileSync(target, "utf8") === desired;
    if (!unchanged) writeFileSync(target, desired, { mode: 0o755 });
    chmodSync(target, 0o755);
    return { name, action: unchanged ? "current" : "written" };
  });
}

/**
 * The setup field, identical for every project and every surface.
 *
 * Names neither the repository nor its package manager, and deliberately not
 * `$HOME` either: the surfaces disagree about where the field runs. Codex Cloud
 * runs it inside the checkout, Claude Code web runs it from `$HOME` with the
 * checkout one level down, and on Codex Cloud the checkout is not under `$HOME`
 * at all — so a `$HOME` glob matched nothing there and bash was handed a path
 * still containing a literal asterisk.
 *
 * Candidates are therefore tried relative to cwd first, then under `$HOME` and
 * `/workspace` — the container roots the two surfaces actually use — because
 * cwd is not reliably either of them. A Claude environment reported `$HOME` as
 * `/root` with no checkout beneath it, which a cwd-only search cannot reach.
 *
 * EVERY match is prepared rather than the first. A Claude Code web environment
 * can hold more than one checkout, so stopping at the first hit would prepare
 * whichever repository sorts first and silently ignore the rest — arbitrary
 * rather than merely limited. Each script anchors itself on its own repository
 * root and each project materializes under its own `secrets.namespace`, so
 * preparing several is well defined rather than a collision. Matches are
 * deduplicated by resolved directory, since the candidate globs overlap
 * whenever cwd happens to be one of the roots.
 *
 * The status is the first failure and every checkout is still attempted: one
 * broken repository must neither hide the others nor report success. The
 * explicit `exit 1` on no matches matters because a `for` loop over a glob that
 * matches nothing otherwise exits 0 — the quiet success this guards against.
 *
 * Failure prints the layout it found rather than only the path it wanted. This
 * field lives in a vendor settings box with a slow edit-and-retry loop, and a
 * miss that reports nothing costs a whole round trip to learn one fact; the
 * listing means the next message names the layout instead of repeating it.
 *
 * A field that named the repository and package manager was a string a human
 * had to get right, in a settings box with no review, no version history and no
 * test — and the logic it encoded belongs in a file that has all three.
 */
export const SETUP_FIELD =
  'n=0; rc=0; seen=""; ' +
  "for f in scripts/lisa-remote-env/setup.sh */scripts/lisa-remote-env/setup.sh " +
  '"$HOME"/scripts/lisa-remote-env/setup.sh "$HOME"/*/scripts/lisa-remote-env/setup.sh ' +
  "/workspace/scripts/lisa-remote-env/setup.sh /workspace/*/scripts/lisa-remote-env/setup.sh; " +
  'do [ -f "$f" ] || continue; d=$(cd "$(dirname "$f")" && pwd -P); ' +
  'case " $seen " in *" $d "*) continue;; esac; seen="$seen $d"; ' +
  'n=$((n+1)); bash "$f" || rc=$?; done; ' +
  '[ "$n" -gt 0 ] || { echo "lisa-remote-env entrypoint not found. ' +
  'PWD=$PWD HOME=$HOME" >&2; ls -1 . "$HOME" /workspace 2>&1 | head -40 >&2; exit 1; }; ' +
  'exit "$rc"';

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
 * Pin which cloud environment this project's sessions use.
 *
 * `/remote-env` writes `remote.defaultEnvironmentId` into *user* settings, which
 * is one value for the whole machine. That is wrong as soon as a developer has
 * more than one project, because an environment's contents are project-shaped:
 * its setup script is a repository-relative path and its bootstrap is scoped to
 * that project's secrets. Pointing one project's session at another's
 * environment runs a setup script that may not exist there, and a non-zero setup
 * script means the session never starts.
 *
 * Written to `.claude/settings.local.json` for two reasons. It outranks user
 * settings, so the per-project choice wins over the machine-wide default; and it
 * is gitignored, which is correct because an environment belongs to one
 * developer's account and is meaningless in someone else's checkout.
 *
 * Merged rather than replaced — that file commonly holds permission grants a
 * developer has accumulated, and clobbering them to write one key would be a
 * poor trade.
 * @param {string} environmentId Cloud environment identifier.
 * @param {string} [cwd] Repository root.
 * @returns {string} The settings path written.
 */
export function pinEnvironment(environmentId, cwd = process.cwd()) {
  const path = join(cwd, ".claude", "settings.local.json");
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  const merged = {
    ...existing,
    remote: { ...(existing.remote ?? {}), defaultEnvironmentId: environmentId },
  };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return path;
}

/**
 * Produce the configuration a human pastes to provision a Claude cloud surface.
 *
 * This surface has no API tier and no console tier to fall back to: a Claude
 * cloud environment is configured only in the environment dialog, which has no
 * settings page, no direct URL, and no endpoint. Emit is not a degraded option
 * here, it is the only one — so the read-back in `verify-remote-env.mjs` is
 * what makes the result trustworthy, exactly as it would be at any other tier.
 * @param {{bootstrapKey: string|null}} options Project details.
 * @returns {string} Text to show the operator.
 */
export function emitClaudeWeb({ bootstrapKey }) {
  const key = bootstrapKey ?? "<secrets.bootstrap.key is not configured>";
  return [
    "Provisioning tier: EMIT — and for this surface that is the only tier.",
    "  A Claude cloud environment is account-scoped configuration edited in the",
    "  environment selector at claude.ai/code. There is no settings page, no",
    "  direct URL and no API, so nothing here can provision it for you.",
    "",
    "Paste into the environment dialog",
    "---------------------------------",
    "  Network access:  Custom plus your package registries, GitHub, cloud SDK",
    "                   hosts, and the bootstrap credential manager API",
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
    `    ${SETUP_FIELD}`,
    "",
    "    This line is identical for every project and every surface — nothing",
    "    in it names this repository or its package manager. The surfaces",
    "    disagree about where the field runs: Codex Cloud runs it inside the",
    "    checkout, Claude Code web runs it from $HOME with the checkout one",
    "    level down. So it tries the checkout itself and then one level down,",
    "    relative to cwd, and only then the same pair under $HOME and",
    "    /workspace, for the case where cwd is neither. The script anchors",
    "    itself on whichever matched and installs dependencies using whichever",
    "    lockfile the project actually commits.",
    "",
    "    Keeping it generic is the point. A field that named the repository and",
    "    the package manager was a string a human had to get right, in a box",
    "    with no review, no version history and no test.",
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

  if (process.argv.includes("--install")) {
    console.log(`Installing remote-environment scripts into ${INSTALL_DIR}/`);
    for (const { name, action } of installAssets()) {
      console.log(`  ${action.padEnd(8)} ${join(INSTALL_DIR, name)}`);
    }

    const pin = process.argv
      .find(arg => arg.startsWith("--pin-env="))
      ?.slice("--pin-env=".length);
    if (pin) {
      console.log(`\nPinned this project to environment ${pin}`);
      console.log(`  written  ${pinEnvironment(pin)}`);
      console.log(
        "  That file is gitignored and outranks the machine-wide default, so\n" +
          "  every project can name its own environment."
      );
    }
    console.log(
      "\nCommit these. They are repository files by design — a container that " +
        "has\njust cloned the repo has never seen the plugin they came from."
    );
    return;
  }

  if (emit) {
    if (emit !== "claude-web") {
      throw new Error(
        `no emit template for surface "${emit}".\n` +
          `Emitting is implemented for claude-web, which has no other tier.`
      );
    }
    console.log(emitClaudeWeb({ bootstrapKey: readBootstrapKey() }));
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
    // A remote container consents by construction: it is disposable, nobody is
    // watching, and provisioning it is why the script exists. Locally the
    // operator opts in per run.
    const remote = Boolean(materializeAt);
    applyToolchain(cfg.tools, dryRun, {
      surface: remote ? "remote" : "local",
      consent: remote || process.argv.includes("--install-tools"),
    });
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
