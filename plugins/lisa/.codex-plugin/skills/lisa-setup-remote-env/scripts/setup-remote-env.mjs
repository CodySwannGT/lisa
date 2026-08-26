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

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reaching across to the workstation skill, the same sibling layout
// `siblingScript` asserts at runtime. Static rather than dynamic because the
// emitted field is a module-level constant: it must exist before anything can
// read it, and the alternative is restating the install directories here, where
// they would drift the first time a tool ships with a new one.
import { pathDirs } from "../../lisa-setup-workstation/scripts/catalogue.mjs";

import { assertPinned, extractVersion, planToolchain } from "./toolchain.mjs";

import { boundedChildOutput } from "../../lisa-setup-workstation/scripts/bounded-child.mjs";

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
    tools: { require: [], install: [], ...cfg.tools },
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
export function probe(name, exec = boundedChildOutput) {
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
 * Refuse an archive whose contents are not exactly what was pinned.
 *
 * Hashed in-process rather than by shelling out. `sha256sum` is a GNU coreutils
 * program: it is not present on a stock macOS, where the equivalent is
 * `shasum -a 256`, and it was never in the manifest's `require` list either — so
 * the verification step depended on a tool nothing asserted, on every surface.
 * Doing it here removes the dependency instead of adding a second name to probe
 * for, and the check can then be tested without a real archive or a real binary.
 * @param {string} archive Path to the downloaded file.
 * @param {string} expected Pinned lowercase hex digest.
 * @param {string} name Tool name, for the message.
 */
export function verifyChecksum(archive, expected, name) {
  const actual = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  if (actual !== String(expected).trim().toLowerCase()) {
    throw new Error(
      `${name}: checksum mismatch — refusing to install.\n` +
        `  expected ${expected}\n` +
        `  actual   ${actual}\n` +
        `The URL served something other than the reviewed artifact. Do not ` +
        `update the pin to match without establishing why it changed.`
    );
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
    boundedChildOutput("curl", ["-fsSL", tool.url, "-o", archive], {
      stdio: "inherit",
    });
    // Verify before unpacking, not after. An unexpected archive must fail
    // before any of its contents reach a directory that is on PATH.
    verifyChecksum(archive, tool.sha256, tool.name);
    boundedChildOutput("unzip", ["-q", "-o", archive, "-d", temporary], {
      stdio: "inherit",
    });
    const binary = join(temporary, tool.binary ?? tool.name);
    boundedChildOutput(
      "install",
      ["-m", "0755", binary, join(binDir, tool.name)],
      {
        stdio: "inherit",
      }
    );
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
    boundedChildOutput("curl", ["-fsSL", tool.url, "-o", archive], {
      stdio: "inherit",
    });
    verifyChecksum(archive, tool.sha256, tool.name);
    boundedChildOutput("tar", ["-xzf", archive, "-C", temporary], {
      stdio: "inherit",
    });
    // Release tarballs usually nest under a versioned directory, so `binary` is
    // a path within the archive rather than a bare name.
    const binary = join(temporary, tool.binary ?? tool.name);
    boundedChildOutput(
      "install",
      ["-m", "0755", binary, join(binDir, tool.name)],
      {
        stdio: "inherit",
      }
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Where a tree-shaped tool's extracted contents live.
 *
 * Versioned so a re-pin lands beside the old copy rather than on top of it, and
 * outside `binDir` because only the entry point belongs on PATH.
 * @param {object} tool Manifest entry.
 * @param {string} binDir Directory holding the symlink.
 * @returns {string} Absolute prefix for this tool and version.
 */
export function treePrefix(tool, binDir) {
  return join(binDir, "..", "share", tool.name, String(tool.version));
}

/**
 * Install a pinned archive that is a DIRECTORY, not a single binary.
 *
 * `release-zip` and `release-tar` extract and then copy one file onto PATH,
 * which is right for a static binary and silently wrong for anything that
 * resolves its own siblings at run time. Maestro is the case that forced this:
 *
 *     maestro/bin/maestro   <- launcher
 *     maestro/lib/*.jar     <- 100+ MB of classpath
 *
 * and the launcher computes `CLASSPATH=$APP_HOME/lib/*` where `APP_HOME` is the
 * parent of wherever the script itself sits. Copy that launcher to
 * `~/.local/bin` and APP_HOME becomes `~/.local`, so the classpath resolves to
 * an empty directory. The install reports success and the tool fails at first
 * use — the failure this manifest exists to turn into a loud setup error.
 *
 * So the whole tree is extracted and the entry point is SYMLINKED. A symlink,
 * not a copy, precisely so that resolution walks back into the extracted tree.
 * @param {object} tool Manifest entry.
 * @param {string} binDir Directory to link the entry point into.
 */
function installReleaseTree(tool, binDir) {
  const temporary = join(binDir, `.${tool.name}-download`);
  const prefix = treePrefix(tool, binDir);
  mkdirSync(temporary, { recursive: true });
  try {
    const archive = join(temporary, "download.archive");
    boundedChildOutput("curl", ["-fsSL", tool.url, "-o", archive], {
      stdio: "inherit",
    });
    // Verify before unpacking, as everywhere else here: an unexpected archive
    // must fail before any of its contents reach the filesystem.
    verifyChecksum(archive, tool.sha256, tool.name);

    // Replace rather than layer. Extracting over a previous version leaves both
    // sets of jars on the classpath, which fails in a way that looks like a
    // version bug rather than a stale install.
    rmSync(prefix, { recursive: true, force: true });
    mkdirSync(prefix, { recursive: true });
    if (tool.url.endsWith(".zip")) {
      boundedChildOutput("unzip", ["-q", "-o", archive, "-d", prefix], {
        stdio: "inherit",
      });
    } else {
      boundedChildOutput("tar", ["-xzf", archive, "-C", prefix], {
        stdio: "inherit",
      });
    }

    const entry = join(prefix, tool.binary);
    if (!existsSync(entry)) {
      throw new Error(
        `${tool.name}: "binary" points at ${tool.binary}, which is not in the ` +
          `archive.\nList the archive and use the path to the entry point ` +
          `inside it, such as "maestro/bin/maestro".`
      );
    }
    chmodSync(entry, 0o755);

    // A WRAPPER, not a symlink. Both keep the tree intact, but a symlink only
    // works for launchers that resolve symlinks before computing their own
    // location — gradle's template does, and plenty of others do not. One that
    // does not sees the link's directory as its home and looks for its
    // classpath beside the link instead of beside itself, which is the same
    // broken install this kind exists to prevent, reintroduced for a subset of
    // tools. Exec'ing the absolute path removes the assumption entirely.
    const shim = join(binDir, tool.name);
    rmSync(shim, { force: true });
    writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(entry)} "$@"\n`);
    chmodSync(shim, 0o755);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Install a pinned artifact that IS the binary, with no archive around it.
 *
 * Several tools worth pinning publish a raw executable rather than an archive —
 * jq ships `jq-linux-amd64` and a `sha256sum.txt`, which is ideal material for a
 * checksummed pin and fits none of the archive kinds.
 *
 * Without this the only entry that passes `assertPinned` is `release-zip`, which
 * then fails at install when `unzip` is handed a binary. A manifest entry that
 * validates and cannot install is worse than one that is rejected outright: the
 * error arrives during provisioning rather than during review.
 *
 * There is no `binary` field here, deliberately — the download is the binary,
 * so there is nothing inside it to name.
 * @param {object} tool Manifest entry.
 * @param {string} binDir Directory to install into.
 */
function installReleaseBinary(tool, binDir) {
  const temporary = join(binDir, `.${tool.name}-download`);
  mkdirSync(temporary, { recursive: true });
  try {
    const artifact = join(temporary, tool.name);
    boundedChildOutput("curl", ["-fsSL", tool.url, "-o", artifact], {
      stdio: "inherit",
    });
    // Verify before it reaches a directory on PATH. For this kind that ordering
    // matters more than for the archives: the downloaded file is directly
    // executable, so a wrong artifact placed first is a wrong artifact that can
    // be run.
    verifyChecksum(artifact, tool.sha256, tool.name);
    boundedChildOutput(
      "install",
      ["-m", "0755", artifact, join(binDir, tool.name)],
      {
        stdio: "inherit",
      }
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Install a pinned global npm package.
 * @param {object} tool Manifest entry.
 */
function installNpmGlobal(tool) {
  boundedChildOutput(
    "npm",
    ["install", "--global", `${tool.package}@${tool.version}`],
    {
      stdio: "inherit",
    }
  );
}

/**
 * Execute one install decision.
 *
 * Exported because the local-environment flow installs from the same manifest
 * with the same pins and the same checksum refusal. A second installer would be
 * a second thing to keep honest, and the one people run least would rot.
 * @param {object} tool Manifest entry, already resolved to this platform.
 * @param {string} binDir Directory for downloaded binaries.
 */
export function installTool(tool, binDir) {
  assertPinned(tool);
  if (tool.install === "release-zip") installReleaseZip(tool, binDir);
  else if (tool.install === "release-tar") installReleaseTar(tool, binDir);
  else if (tool.install === "release-tree") installReleaseTree(tool, binDir);
  else if (tool.install === "release-binary")
    installReleaseBinary(tool, binDir);
  else installNpmGlobal(tool);
}

/**
 * Create the directory installs land in, and make sure PATH will find it.
 *
 * Installing a binary somewhere nothing looks is the same as not installing it.
 * `~/.local/bin` is on PATH by default on a developer workstation and is NOT on
 * a minimal container, so the toolchain step reported `install bws`, the file
 * landed at ~/.local/bin/bws mode 755, and the very next step died with
 * `spawnSync bws ENOENT`.
 *
 * This was invisible in every local test because a workstation shell already
 * exports the directory — the environment doing the hiding was the one used to
 * verify the fix.
 *
 * Prepended, not appended: a pinned-and-checksummed binary must win over
 * whatever an image happens to ship under the same name.
 * @returns {string} The directory installs are written to.
 */
export function ensureBinDir() {
  const binDir = join(process.env.HOME ?? "", ".local", "bin");
  mkdirSync(binDir, { recursive: true, mode: 0o755 });
  if (!pathContains(binDir)) {
    process.env.PATH = `${binDir}${delimiter}${process.env.PATH ?? ""}`;
  }
  return binDir;
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

  const binDir = ensureBinDir();
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

  for (const step of plan) {
    console.log(`  ${step.action.padEnd(8)} ${step.reason}`);
    // The planner already resolved this entry to the running platform, so use
    // what it decided rather than looking the raw entry up again. `byName` is
    // the pre-platform shape and would hand the installer a url that belongs to
    // whichever platform happened to be written first.
    if (step.action === "install" && !dryRun)
      installTool(step.tool ?? byName.get(step.name), binDir);
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
  boundedChildOutput("bash", [path], { stdio: "inherit" });
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
 * broken repository must neither hide the others nor report success.
 *
 * Preparing nothing has two causes, and they are not the same failure:
 *
 *   - A checkout is present but carries no entrypoint. That is a
 *     misconfiguration, and a `for` loop over a glob that matches nothing exits
 *     0 on its own — the quiet success this has always guarded against. It
 *     still fails loudly, printing the layout it found rather than only the
 *     path it wanted.
 *   - There is NO checkout. A Claude Tag channel session runs as the
 *     organization with no user account, and a repository does not enter the
 *     session until a request names one, so this is an ordinary state rather
 *     than an error. Failing here would be severe: a setup script that exits
 *     non-zero stops the session from starting at all, so the old blanket
 *     `exit 1` would have killed every repo-less channel session.
 *
 * With no checkout, `LISA_SECRETS_NAMESPACE` decides whether there is anything
 * to do: it names the tenant, which is the one value no default can supply.
 * Given it, the machine itself is prepared — tools and credentials, no repo
 * required. Without it there is nothing to prepare and nothing to fail about.
 *
 * Those two preparation steps report their failures and do not propagate them,
 * which is deliberate and is NOT the same as hiding them. A setup script that
 * exits non-zero stops the session from starting at all, so propagating turns
 * "no credentials this session" into "no session" — strictly worse, and the
 * exact regression that killed every repo-less channel session once already.
 * What was wrong before was the silence: a bare `|| true` let a container come
 * up with a bootstrap token and nothing able to use it, looking identical to
 * success. Each phase's status is now captured and named on stderr, which the
 * vendor surfaces, so the session still starts and the operator can see which
 * half is missing.
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
/**
 * The exact Lisa the emitted field runs, pinned to the version that emitted it.
 *
 * `@latest` in a field that executes with `npx -y` is remote code execution
 * against a moving target: whatever is newest when the session starts, run as
 * root before Claude launches. That contradicts the rule this project applies
 * to everything else — `assertPinned` refuses a tool whose version is not fixed
 * and checksummed, and it would be strange to hold third-party binaries to a
 * standard Lisa exempts itself from.
 *
 * Pinning to the emitting version keeps the field honest without freezing it:
 * regenerating the field after an upgrade produces a new pin, which is the same
 * "a version bump moves in one reviewed commit" contract as the toolchain.
 * Falling back to `latest` only when the version cannot be read keeps a broken
 * install from turning into an unrunnable field.
 */
const SELF_SPEC = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(HERE, "../../../../../../package.json"), "utf8")
    );
    return pkg.version ? `@codyswann/lisa@${pkg.version}` : "@codyswann/lisa";
  } catch {
    return "@codyswann/lisa";
  }
})();

/**
 * Every directory the catalogue installs into, as a `$HOME`-relative PATH.
 *
 * The field used to hardcode `~/.local/bin`, which is only where the *pinned*
 * binaries land. A vendor script may install anywhere it likes — SonarQube's
 * puts `sonar` under `~/.local/share/sonarqube-cli/bin` — so the tool installed
 * successfully and then could not be found, which reads to an operator exactly
 * like an install that never happened.
 *
 * The bootstrap already writes these into the shell rc files, and on this
 * surface that is inert: a cloud container's tool shell is not a login shell
 * and reads no profile. Exporting them here is what makes the install visible
 * to the session that asked for it.
 *
 * Derived from the catalogue rather than restated, so a tool added with a new
 * `binDir` reaches this field without anyone remembering to come back here.
 * `$HOME` stays a shell variable — the field runs as a different user, in a
 * different container, than whatever machine emitted it.
 */
const FIELD_PATH = pathDirs("$HOME").join(":");

export const SETUP_FIELD =
  'n=0; rc=0; seen=""; ' +
  "for f in scripts/lisa-remote-env/setup.sh */scripts/lisa-remote-env/setup.sh " +
  '"$HOME"/scripts/lisa-remote-env/setup.sh "$HOME"/*/scripts/lisa-remote-env/setup.sh ' +
  "/workspace/scripts/lisa-remote-env/setup.sh /workspace/*/scripts/lisa-remote-env/setup.sh; " +
  'do [ -f "$f" ] || continue; d=$(cd "$(dirname "$f")" && pwd -P); ' +
  'case " $seen " in *" $d "*) continue;; esac; seen="$seen $d"; ' +
  // `rc` keeps the FIRST failure, which is what the contract below promises.
  //
  // A bare `rc=$?` keeps the last one, so with two broken checkouts the
  // operator is shown the second and the first is lost — the precise hiding the
  // documented behaviour exists to prevent. A success never overwrites, because
  // `||` only fires on failure, so the bug was confined to the multiple-failure
  // case that the rule was written for.
  'n=$((n+1)); bash "$f" || { s=$?; [ "$rc" -ne 0 ] || rc=$s; }; done; ' +
  '[ "$n" -gt 0 ] && exit "$rc"; ' +
  'g=0; for c in ./.git ./*/.git "$HOME"/*/.git /workspace/*/.git; ' +
  'do [ -e "$c" ] && g=1; done; ' +
  'if [ "$g" -eq 1 ]; then ' +
  'echo "lisa-remote-env entrypoint not found, but a checkout is present. ' +
  'PWD=$PWD HOME=$HOME" >&2; ls -1 . "$HOME" /workspace 2>&1 | head -40 >&2; exit 1; fi; ' +
  'ten="${LISA_TENANT:-${LISA_SECRETS_NAMESPACE:-}}"; ' +
  'if [ -n "$ten" ]; then ' +
  'echo "No checkout; preparing tools and credentials for $ten."; ' +
  "tw=0; tt=0; ts=0; tp=0; " +
  // `--agents=none` is load-bearing, not tidiness.
  //
  // The bootstrap's default is every coding agent it knows: claude, codex,
  // cursor-agent, opencode, agy, copilot. `agy` alone is ~193MB and `gh` ~55MB,
  // and a setup script has roughly five minutes before the vendor kills it and
  // reports "Session failed to start: Setup script failed" — which is exactly
  // what a Claude Tag channel did, killing the session outright rather than
  // starting it without tools.
  //
  // A remote container needs the provider CLI and the tools; it does not need
  // agents, because it IS one. No AGENTS entry is named "none", so the filter
  // selects nothing — pinned by a test, since it reads like a magic word.
  // Two passes, credentials in between, because the vault is what knows which
  // CLIs this container needs — and it cannot be asked until it has been read.
  //
  // The first pass installs only the provider CLI (`--tools=none`, the same
  // idiom as `--agents=none`), because that is all materialization requires.
  `npx -y ${SELF_SPEC} workstation --install --agents=none --tools=none ` +
  '--provider="${LISA_PROVIDER:-${LISA_SECRETS_PROVIDER:-bitwarden}}" || tw=$?; ' +
  // Exported BEFORE the secrets phase, not after: the toolchain installs into
  // ~/.local/bin, and materialization spawns the provider CLI by name. Ordered
  // the other way it gets ENOENT on a binary that is sitting right there.
  `export PATH="${FIELD_PATH}:$PATH"; ` +
  `npx -y ${SELF_SPEC} remote-env --phase=secrets || ts=$?; ` +
  // Now the notes can answer it. A vault that names nothing yields an empty
  // string, and `--tools=` with an empty value selects the whole catalogue —
  // so annotating the notes NARROWS what gets installed, and not annotating
  // them leaves this field behaving exactly as it did before.
  //
  // stderr is dropped and only the last line kept: npx narrates to stderr, and
  // this is a command substitution whose output becomes a flag value.
  //
  // The status is captured BEFORE the pipe, because `tail` exits 0 whatever
  // happened upstream. A failed lookup still falls through to the whole
  // catalogue — installing too much is the safe direction, and it is what this
  // field did before the vault had any say — but it says so, rather than being
  // indistinguishable from a vault that simply names nothing.
  `w=$(npx -y ${SELF_SPEC} remote-env --print-tools 2>/dev/null) || tp=$?; ` +
  'w=$(printf "%s\\n" "$w" | tail -1); ' +
  '[ "$tp" -eq 0 ] || echo "SETUP INCOMPLETE: could not read the tool list ' +
  'from the vault (exit $tp). Installing the full catalogue." >&2; ' +
  `npx -y ${SELF_SPEC} workstation --install --agents=none --tools="$w" ` +
  '--provider="${LISA_PROVIDER:-${LISA_SECRETS_PROVIDER:-bitwarden}}" || tt=$?; ' +
  '[ "$tw" -eq 0 ] && [ "$tt" -eq 0 ] || echo "SETUP INCOMPLETE: tool install ' +
  'failed (exit $tw/$tt). The session will start WITHOUT the pinned tools." >&2; ' +
  '[ "$ts" -eq 0 ] || echo "SETUP INCOMPLETE: secrets did not materialize ' +
  '(exit $ts). The session will start WITHOUT credentials." >&2; ' +
  'else echo "No checkout and no tenant configured; nothing to prepare."; fi; ' +
  "exit 0";

/**
 * Register the session-start hook at USER scope, so it fires wherever the
 * session opens.
 *
 * The committed `.claude/settings.json` hook is *project*-scoped: it loads only
 * when Claude Code's project directory is that repository. A cloud session does
 * not reliably start there. With several repositories it starts in the shared
 * parent, which is not a git repository at all; even with one, the checkout sits
 * at `$HOME/<repo>` while the session may open at `$HOME`. In those sessions no
 * project settings load, the hook never registers, and nothing materializes —
 * the failure that `materializeAt: "both"` was introduced to paper over, and
 * which it could not fix, because the setup phase cannot see the bootstrap
 * credential in the first place.
 *
 * A user-scoped hook has neither problem: `~/.claude/settings.json` is read for
 * every session regardless of project directory, and it runs in-session where
 * the vendor's configured variables ARE present.
 *
 * Only ever on a remote surface. This writes machine state in an ephemeral
 * container, which is fine there and would be an intrusion on a developer's
 * laptop, where the project hook already works and the user owns that file.
 *
 * Merged, never clobbered, and idempotent on the exact command — an existing
 * user settings file may carry hooks this knows nothing about.
 * @param {string} repoRoot Absolute path to the checkout.
 * @param {object} options Home directory, dry-run flag, and file seams.
 * @returns {{action: string, path: string, reason?: string}} What was done.
 */
export function installUserSessionHook(repoRoot, options = {}) {
  const {
    home = process.env.HOME || homedir(),
    dryRun = false,
    exists = existsSync,
    read = readFileSync,
    write = writeFileSync,
    mkdir = mkdirSync,
  } = options;

  const script = join(repoRoot, "scripts/lisa-remote-env/session-start.sh");
  if (!exists(script)) {
    return { action: "skipped", path: script, reason: "no session-start.sh" };
  }

  const dir = join(home, ".claude");
  const settingsPath = join(dir, "settings.json");
  const command = `bash ${script}`;

  let settings = {};
  if (exists(settingsPath)) {
    try {
      settings = JSON.parse(String(read(settingsPath, "utf8"))) || {};
    } catch {
      // Refuse rather than overwrite. A settings file that does not parse is
      // still someone's configuration, and replacing it would be the careless
      // destruction this whole function is written to avoid.
      return {
        action: "failed",
        path: settingsPath,
        reason: "existing settings.json is not valid JSON; left untouched",
      };
    }
  }

  const hooks = settings.hooks ?? {};
  const sessionStart = Array.isArray(hooks.SessionStart)
    ? hooks.SessionStart
    : [];
  const already = sessionStart.some(entry =>
    (entry?.hooks ?? []).some(hook => hook?.command === command)
  );
  if (already) {
    return { action: "present", path: settingsPath };
  }

  const updated = {
    ...settings,
    hooks: {
      ...hooks,
      SessionStart: [
        ...sessionStart,
        {
          matcher: "startup|resume",
          hooks: [{ type: "command", command }],
        },
      ],
    },
  };

  if (dryRun) return { action: "would-register", path: settingsPath };

  mkdir(dir, { recursive: true });
  write(settingsPath, `${JSON.stringify(updated, null, 2)}\n`);
  return { action: "registered", path: settingsPath };
}

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
    remote: { ...existing.remote, defaultEnvironmentId: environmentId },
  };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return path;
}

/**
 * The lines an operator puts above the field, for a session with no checkout.
 *
 * Emitted as shell that runs, not as a template with holes: every hole is a
 * hand substitution in a settings box with no review, which is the failure this
 * whole file exists to prevent. So a provider that cannot be bootstrapped by an
 * environment variable gets a sentence explaining that, not an `export` of a
 * placeholder — a line that would be a syntax error if pasted.
 *
 * `LISA_PROVIDER` is exported even though the field defaults it, because the
 * field's default is Bitwarden. A Doppler tenant that omits it gets `bws`
 * installed and its own CLI missing, having configured everything correctly.
 * @param {object} options Resolved identity and display strings.
 * @returns {string[]} Lines to include in the emitted guidance.
 */
function repoLessExports({ namespace, key, provider, bootstrapKey, tenant }) {
  // Two different reasons the key can be missing, and telling them apart is the
  // whole value of the message. "Nothing was named" is the operator's to fix by
  // re-running; "this provider has no such variable" is not fixable at all and
  // must not read as an omission.
  if (!tenant) {
    return [
      "      # Re-run with --tenant=<name> and these are filled in for you.",
      `      export LISA_TENANT=${namespace}`,
      "      export <bootstrap variable>='<read from your credential manager>'",
      "      export LISA_SECRETS_SURFACE=claude-web",
    ];
  }
  if (!bootstrapKey) {
    return [
      `      # ${provider} has no environment-variable bootstrap, so there is`,
      "      # nothing to export for it. Authenticate it the way its own CLI",
      "      # expects, then set the three below.",
      `      export LISA_TENANT=${namespace}`,
      `      export LISA_PROVIDER=${provider}`,
      "      export LISA_SECRETS_SURFACE=claude-web",
    ];
  }
  return [
    `      export LISA_TENANT=${namespace}`,
    `      export ${key}='<the same value as above>'`,
    ...(provider ? [`      export LISA_PROVIDER=${provider}`] : []),
    "      export LISA_SECRETS_SURFACE=claude-web",
  ];
}

/**
 * Produce the configuration a human pastes to provision a Claude cloud surface.
 *
 * This surface has no API tier and no console tier to fall back to: a Claude
 * cloud environment is configured only in the environment dialog, which has no
 * settings page, no direct URL, and no endpoint. Emit is not a degraded option
 * here, it is the only one — so the read-back in `verify-remote-env.mjs` is
 * what makes the result trustworthy, exactly as it would be at any other tier.
 * @param {{bootstrapKey: string|null, tenant?: string|null, provider?: string}} options Project details.
 * @returns {string} Text to show the operator.
 */
export function emitClaudeWeb({
  bootstrapKey,
  tenant = null,
  provider = null,
}) {
  const key = bootstrapKey ?? "<not resolved>";
  const namespace = tenant ?? "<your namespace>";
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
    "",
    "    A setup script sees NONE of the variables configured above — it runs",
    "    while the image is being built, before the environment exists. So a",
    "    session with no checkout has to be told its tenant inside the script",
    "    itself, or the field finds nothing to prepare and exits 0 looking like",
    "    success. Put the lines below FIRST, then the field after them:",
    "",
    ...repoLessExports({ namespace, key, provider, bootstrapKey, tenant }),
    "",
    "    LISA_SECRETS_SURFACE is set explicitly rather than left to detection:",
    "    detection keys off CLAUDE_CODE_REMOTE, and a surface that does not set",
    "    it falls through to `local`, which writes no credentials to disk at all.",
    "",
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
 * Emit the configuration for a surface Lisa cannot reach.
 *
 * Dispatch rather than four call sites, so `environment` names a surface and
 * nothing downstream has to know which of them has an API and which does not.
 * @param {string} target Surface name.
 * @param {object} identity Resolved tenant, provider and bootstrap key.
 * @returns {string} Text to show the operator.
 */
export function emitFor(target, identity) {
  if (target === "claude-web") return emitClaudeWeb(identity);
  if (target === "codex-cloud") return emitCodexCloud(identity);
  if (target === "container") return emitContainer(identity);
  throw new Error(`no emit template for surface "${target}".`);
}

/**
 * Produce the configuration a human pastes into a Codex Cloud environment.
 *
 * Differs from Claude's in three ways that are properties of the vendor rather
 * than of Lisa, and each has cost someone a debugging session.
 * @param {{bootstrapKey: string|null, tenant?: string|null, provider?: string}} options Project details.
 * @returns {string} Text to show the operator.
 */
export function emitCodexCloud({
  bootstrapKey,
  tenant = null,
  provider = null,
}) {
  const key = bootstrapKey ?? "<not resolved>";
  const namespace = tenant ?? "<your namespace>";
  return [
    "Provisioning tier: EMIT — Codex Cloud exposes no environment API.",
    "  `codex cloud` offers exec, status and list; nothing that writes an",
    "  environment. So this is text for the settings page.",
    "",
    "Paste into the environment settings",
    "-----------------------------------",
    "  Repository:        the DEFAULT checkout for this environment",
    "",
    "  Environment variables — NOT task secrets:",
    // Written as name=value, not as `export name='value'`. This is a settings
    // form, not a shell: the quotes would be stored as part of the value, and
    // the surface named must be this one rather than the shell block's.
    `    LISA_TENANT=${namespace}`,
    ...(bootstrapKey
      ? [`    ${key}=<read this from your credential manager>`]
      : [`    (${provider} has no environment-variable bootstrap)`]),
    ...(provider ? [`    LISA_PROVIDER=${provider}`] : []),
    "    LISA_SECRETS_SURFACE=codex-cloud",
    "",
    "    Setup and cache-resume maintenance both run BEFORE task secrets",
    "    exist, so a bootstrap placed in the secrets box is invisible to the",
    "    only two steps that need it.",
    "",
    "  Setup script:",
    `    ${SETUP_FIELD}`,
    "",
    "  Maintenance script:",
    "    The SAME line. It runs when a container resumes from cache, and every",
    "    step is idempotent and version-aware — so running it again is how a",
    "    rotated value, an edited note, or a changed pin gets picked up.",
    "",
    "Watch for",
    "---------",
    "  CODEX_ENV_NODE_VERSION overrides the repository's own .nvmrc and",
    "  engines. An environment left on an older major breaks setup for a repo",
    "  that requires a newer one, and the error blames the package manager.",
    "",
    "  Codex clones `main`, not the repository's default branch. If those",
    "  differ here, that is where the confusion starts.",
    "",
    "  Setup logs are visible only in the Codex UI; no CLI retrieves them.",
  ].join("\n");
}

/**
 * Produce an image definition and a run command for a container.
 *
 * Split across build and run on purpose: the binaries are baked once, and the
 * credential arrives at `docker run`. Baking it would put it in an image layer,
 * readable by anyone who can pull the image and surviving every
 * `docker history` — so the Dockerfile deliberately contains no secret.
 * @param {{bootstrapKey: string|null, tenant?: string|null, provider?: string}} options Project details.
 * @returns {string} Text to show the operator.
 */
export function emitContainer({
  bootstrapKey,
  tenant = null,
  provider = null,
}) {
  const key = bootstrapKey ?? "<not resolved>";
  const namespace = tenant ?? "<your namespace>";
  return [
    "Provisioning tier: EMIT — an image is built from a file you own.",
    "",
    "Dockerfile",
    "----------",
    "  Generate it with the bootstrap's own emitter, so the image and this",
    "  machine install the identical set:",
    "",
    "    npx -y @codyswann/lisa@latest workstation --print-dockerfile \\",
    `      --provider=${provider ?? "bitwarden"} > Dockerfile.lisa`,
    "    docker build -f Dockerfile.lisa -t lisa-workstation .",
    "",
    "  Nothing secret belongs in it. An image layer is readable by anyone who",
    "  can pull the image and survives every `docker history`, so the",
    "  credential arrives at run time instead.",
    "",
    "docker run",
    "----------",
    "  docker run --rm -it \\",
    `    -e LISA_TENANT=${namespace} \\`,
    `    -e ${key}="<this image's own access token>" \\`,
    ...(provider ? [`    -e LISA_PROVIDER=${provider} \\`] : []),
    "    -e LISA_SECRETS_SURFACE=container \\",
    '    -v "$PWD:/work" -w /work \\',
    "    lisa-workstation",
    "",
    "  LISA_SECRETS_SURFACE=container is what makes credentials materialize.",
    "  Left to detection a container reads as `local`, which is",
    "  materialized:false — right for a human at a keyboard whose provider CLI",
    "  is authenticated, wrong for a container that has no keychain and dies",
    "  with its filesystem.",
    "",
    "  Give the image its own access token rather than reusing this machine's.",
    "  If the image is shared, so is anything its token can read.",
    "",
    "Mounted repositories need nothing further",
    "-----------------------------------------",
    "  A checkout you have already run `apply` and `sync` on carries its",
    "  .lisa.config.json with it. Cloning INSIDE the container instead means",
    "  running those there.",
  ].join("\n");
}

/**
 * Report tooling the project appears to need but has not declared.
 *
 * Called before the toolchain is applied, because the manifest is the only
 * thing that puts a binary on PATH and nothing populates it — so provisioning
 * "the declared toolchain" happily succeeds while the tool a project actually
 * uses is absent, and fails later at the moment of use instead of here.
 *
 * Informational, never blocking. The detector proposes and a human decides, so
 * an undeclared tool must not stop a setup that was asked to provision what IS
 * declared; failing here would make a advisory signal into a gate nobody chose.
 * Its own absence is silent for the same reason: an older installed copy of the
 * skills has no detector, and that is not a reason to refuse to provision.
 * @param {Function} [exec] Seam for tests.
 */
function reportUndeclaredTooling(exec = boundedChildOutput) {
  let script;
  try {
    script = siblingScript("lisa-detect-tooling", "detect-tooling.mjs");
  } catch {
    return;
  }
  try {
    const out = exec("node", [script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const text = String(out).trim();
    if (text) console.log(`\n${text}\n`);
  } catch {
    // A detector that cannot run is a missing hint, not a failed setup.
  }
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
    if (requested === "secrets" && !materializesAtSessionStart(materializeAt)) {
      // Not an error: the hook is committed to the repository and runs on every
      // surface the project is ever checked out on. Refusing loudly would make
      // a correct local session look broken every time it started.
      return [];
    }
    return [requested];
  }
  return PHASES.filter(
    phase => phase !== "secrets" || materializesAtSetup(materializeAt)
  );
}

/**
 * Whether the setup run itself should materialize.
 *
 * `"both"` means the surface materializes in the setup run AND from the
 * session-start hook, because on that surface either one alone has a hole: the
 * setup run is skipped when a cached environment is reused, and the hook cannot
 * fire when Claude Code's project directory is not the repository — which is
 * every cloud environment configured with more than one repo.
 * @param {string|null} materializeAt Surface capability.
 * @returns {boolean} Whether to materialize during setup.
 */
export function materializesAtSetup(materializeAt) {
  return materializeAt === "setup" || materializeAt === "both";
}

/**
 * Whether the committed session-start hook should materialize.
 * @param {string|null} materializeAt Surface capability.
 * @returns {boolean} Whether the hook does the work.
 */
export function materializesAtSessionStart(materializeAt) {
  return materializeAt === "session-start" || materializeAt === "both";
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

/**
 * Work out what to tell the operator to export, for a surface that has no repo.
 *
 * Emitting used to read the key out of `.lisa.config.json` in the working
 * directory, which made the command that configures a REPO-LESS environment
 * require a repository — so it was run from a checkout that happened to be
 * nearby, or it printed a placeholder the operator substituted by hand.
 *
 * Explicit flags win, then the environment, then a checkout if the caller
 * happens to be standing in one, then the convention. The provider matters
 * because it decides the variable's name: `bws` reads `BWS_ACCESS_TOKEN` and
 * `doppler` reads `DOPPLER_TOKEN`, so a tenant on one told to export the
 * other's name gets "Missing access token" from a CLI it did configure.
 * @param {string[]} argv Process arguments.
 * @param {Record<string, string|undefined>} [env] Environment to read.
 * @param {string} [cwd] Directory to look for a config in.
 * @returns {Promise<{tenant: string|null, provider: string, bootstrapKey: string|null}>} Resolved identity.
 */
export async function resolveEmitTarget(
  argv,
  env = process.env,
  cwd = process.cwd()
) {
  const flag = name =>
    argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

  const tenant =
    flag("tenant") ||
    (env.LISA_TENANT ?? env.LISA_SECRETS_NAMESPACE ?? "").trim() ||
    null;
  const provider =
    flag("provider") ||
    (env.LISA_PROVIDER ?? env.LISA_SECRETS_PROVIDER ?? "").trim() ||
    "bitwarden";

  // Validated before it can reach the output, by the same rule the runtime path
  // applies. This one becomes `export LISA_TENANT=<value>` in a block an
  // operator pastes verbatim, so `my tenant` or `has$var` would emit shell that
  // breaks — or worse, expands — where nothing reviews it. Refusing here costs
  // a re-run; emitting it costs a container nobody can explain.
  if (tenant) {
    const { assertNamespace } = await import(
      pathToFileURL(siblingScript("lisa-secrets-access", "surfaces.mjs")).href
    );
    assertNamespace(tenant);
  }

  // A configured key outranks the convention: a project may legitimately use a
  // name that is not derivable, and this command must not tell its operator to
  // set a different one from the one their sessions actually read.
  const configured = readBootstrapKey(cwd);
  if (configured) return { tenant, provider, bootstrapKey: configured };
  if (!tenant) return { tenant, provider, bootstrapKey: null };

  const { bootstrapKeyFor } = await import(
    pathToFileURL(siblingScript("lisa-secrets-access", "providers.mjs")).href
  );
  return { tenant, provider, bootstrapKey: bootstrapKeyFor(provider, tenant) };
}

async function main() {
  // `--print-tools` answers "which CLIs does this secret set imply", reading
  // the notes materialized alongside the values.
  //
  // It exists so a repo-less setup can install what the container actually
  // needs. Without a checkout there is no `remoteEnv.tools`, and the fallback
  // was the whole catalogue — which spends a five-minute setup budget on CLIs
  // that may never be used, and a blown budget is a session that never starts.
  //
  // Printing rather than installing keeps the two skills decoupled: the secrets
  // side knows what the vault says, the workstation side knows how to install,
  // and neither grows a dependency on the other.
  if (process.argv.includes("--print-tools")) {
    const { readConfig, materializedPaths } = await import(
      pathToFileURL(siblingScript("lisa-secrets-access", "surfaces.mjs")).href
    );
    const { toolsFromNotes } = await import(
      pathToFileURL(
        siblingScript("lisa-secrets-access", "tools-from-notes.mjs")
      ).href
    );
    const { TOOLS } = await import(
      pathToFileURL(siblingScript("lisa-setup-workstation", "catalogue.mjs"))
        .href
    );

    const { notesFile } = materializedPaths(readConfig().namespace);
    // Silence rather than failure when nothing has been materialized: the
    // caller is a shell substitution in a setup script, and an error there
    // would abort provisioning over a question that simply has no answer yet.
    if (!existsSync(notesFile)) return;

    const notes = JSON.parse(readFileSync(notesFile, "utf8")).secrets ?? {};
    const known = TOOLS.filter(t => t.kind !== "required").map(t => t.name);
    console.log(toolsFromNotes(notes, known).join(","));
    return;
  }

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
    console.log(emitClaudeWeb(await resolveEmitTarget(process.argv)));
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
    reportUndeclaredTooling();
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
    // A failure here is fatal only when nothing else will try again.
    //
    // On a surface that materializes at BOTH setup and session start, this run
    // is the floor and the hook is the authority. The two run in different
    // environments: a cloud vendor can expose its configured variables to the
    // agent session while the setup phase — which runs earlier, during image
    // construction — never sees them. That is not an error state, it is the
    // normal shape of `materializeAt: "both"`, and the hook materializes
    // correctly moments later.
    //
    // Treating it as fatal cost an entire environment: setup.sh `exec`s this
    // script, so a non-zero exit fails the vendor's setup step and Claude Code
    // never starts at all. Trading "secrets arrive one phase later" for "the
    // container will not boot" is a bad trade, and it regressed a case that
    // used to work — before this surface materialized at setup, setup simply
    // never attempted it.
    //
    // Every other case keeps the hard failure: an explicit `--phase=secrets`
    // (the hook's own authoritative run) and a setup-only surface such as
    // codex-cloud both have no second chance, so a silent pass there would
    // hand back a session with no credentials and call it ready.
    const retried = !requested && materializesAtSessionStart(materializeAt);

    // If the hook is what will retry, make sure the hook can actually fire.
    // Registering it at user scope is what makes the retry real rather than
    // assumed: the committed project hook does not load when the session opens
    // above the checkout, which is the norm in a cloud container.
    // `materializeAt` being set is what "remote surface" means here. The
    // toolchain phase derives a local `remote` from it, but that binding is
    // scoped to its own block and is not in scope in this one.
    if (retried && Boolean(materializeAt)) {
      const hook = installUserSessionHook(process.cwd(), { dryRun });
      console.log(`  session-start hook: ${hook.action} (${hook.path})`);
      if (hook.reason) console.log(`    ${hook.reason}`);
    }
    try {
      boundedChildOutput(
        "node",
        dryRun ? [materialize, "--dry-run"] : [materialize],
        { stdio: "inherit" }
      );
    } catch (err) {
      if (!retried) throw err;
      console.log(
        `\n  Secrets were not materialized during setup, and that is not fatal ` +
          `here.\n  This surface also materializes at session start, which runs ` +
          `with the\n  session's own environment — the usual reason setup cannot ` +
          `see the\n  bootstrap credential. The session-start hook will retry.\n` +
          `  If secrets are still missing INSIDE a session, that run is the one ` +
          `to debug.`
      );
    }
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
  // Awaited rather than called bare: main is async, so a synchronous try/catch
  // would let a rejected promise escape as an unhandled rejection and exit 0 —
  // reporting a prepared environment that was never prepared.
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
