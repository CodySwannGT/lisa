#!/usr/bin/env node
/**
 * Command-line entry for the workstation bootstrap.
 *
 * Kept separate from `workstation.mjs` so the planning logic stays importable
 * and testable without a process boundary — a test should be able to ask "what
 * would this do" without any risk of it doing it.
 *
 * Usage:
 *   cli.mjs                                report present vs missing
 *   cli.mjs --install                      provision what is missing
 *   cli.mjs --install --agents=claude,codex   only these agents
 *   cli.mjs --install --tools=aws,sonar    only these tools (empty selects all)
 *   cli.mjs --provider=bitwarden           credential manager (asked if a TTY)
 *   cli.mjs --json                         machine-readable plan
 *   cli.mjs --print-dockerfile             an image that runs this same script
 * @module cli
 */

import { closeSync, existsSync, openSync, readSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AGENTS, PROVIDERS, TOOLS, pathDirs } from "./catalogue.mjs";
import { installEntry, planWorkstation, renderPlan } from "./workstation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where pinned binaries land, and what must therefore be on PATH. */
export const BIN_DIR = `${process.env.HOME}/.local/bin`;

/**
 * Borrow the pinned, checksummed installer the remote-env skill owns.
 *
 * Composed rather than reimplemented: the pins and checksums must be the same
 * ones the remote surfaces use, or the two drift and only one gets fixed.
 * Returns null when the sibling is absent, so a machine can still install the
 * unpinned entries instead of failing wholesale — the report says which ones
 * were skipped rather than passing them off as done.
 * @returns {Promise<Function|null>} An installer, or null.
 */
export async function loadPinnedInstaller() {
  const sibling = name =>
    resolve(HERE, "..", "..", "lisa-setup-remote-env", "scripts", name);
  const setup = sibling("setup-remote-env.mjs");
  const toolchain = sibling("toolchain.mjs");
  if (!existsSync(setup) || !existsSync(toolchain)) return null;

  const { installTool, ensureBinDir } = await import(pathToFileURL(setup).href);
  const { resolvePlatform } = await import(pathToFileURL(toolchain).href);
  if (typeof installTool !== "function") return null;

  return entry => {
    // resolvePlatform must run first: installTool calls assertPinned, which
    // refuses an entry that still carries a `platforms` map. Skipping it failed
    // bws and gh with "platform-specific entry was not resolved before install"
    // — the guard doing exactly its job.
    const resolved = resolvePlatform(toManifestEntry(entry));
    installTool(resolved, ensureBinDir ? ensureBinDir() : BIN_DIR);
  };
}

/**
 * Translate a catalogue entry into the manifest shape the installer expects.
 *
 * The two vocabularies differ — the catalogue describes a machine, the manifest
 * describes a project — so the seam is made explicit here rather than by giving
 * the catalogue a shape it does not otherwise need. `kind` becomes `install`;
 * everything else the manifest reads is already named the same.
 * @param {object} entry Catalogue entry.
 * @returns {object} A `remoteEnv.tools` style entry.
 */
export function toManifestEntry(entry) {
  const { kind, label, binDir, note, selfUpdates, ...rest } = entry;
  return { ...rest, install: kind };
}

/**
 * Decide which credential manager to provision.
 *
 * Asked, never assumed. Defaulting to Bitwarden because that is what this repo
 * happens to use would install a vendor CLI on a machine whose project resolves
 * secrets some other way — and would make `none`, a supported configuration,
 * reachable only by accident.
 *
 * Headless is the primary mode, so a missing answer without a TTY is `none`
 * rather than a prompt that would hang a container build forever.
 * @param {string|null} requested Value of --provider, if given.
 * @param {object} io Injected ask/tty, for tests.
 * @returns {string} A provider name from the catalogue.
 */
export function chooseProvider(requested, io = {}) {
  if (requested) return requested;

  const ask = io.ask ?? null;
  const interactive = io.interactive ?? Boolean(process.stdin.isTTY);
  if (!ask || !interactive) return "none";

  const names = PROVIDERS.map(p => p.name);
  const menu = PROVIDERS.map((p, i) => `  ${i + 1}) ${p.label}`).join("\n");
  const answer = String(
    ask(`Which credential manager does this machine use?\n${menu}\nChoice: `) ??
      ""
  ).trim();

  // Accept either the menu number or the name, because an operator reading the
  // list will reach for whichever is in front of them.
  const index = Number.parseInt(answer, 10);
  if (Number.isInteger(index) && index >= 1 && index <= names.length) {
    return names[index - 1];
  }
  return names.includes(answer) ? answer : "none";
}

/**
 * A Dockerfile that runs this same script, for a throwaway environment.
 *
 * Emitted rather than committed so it cannot drift from the catalogue it
 * provisions. There is no Docker-specific code path anywhere in this skill —
 * the image simply gives the script a `$HOME` that dies with the container.
 *
 * Deliberately bakes in NO repository. Clone inside the container, then run
 * lisa-detect-tooling and lisa-setup-local-env for that project's own tools.
 * @param {string[]} agents Agent names to install.
 * @param {string} [provider] Credential manager to provision.
 * @returns {string} Dockerfile text.
 */
export function renderDockerfile(agents, provider = "none") {
  const list = agents.length ? agents.join(",") : "claude,codex";
  const clean = "apt-get clean";
  return [
    "# Ephemeral coding environment. Build, use, discard.",
    "#   docker build -t lisa-workstation .",
    "#   docker run --rm -it lisa-workstation",
    "FROM ubuntu:24.04",
    "ENV DEBIAN_FRONTEND=noninteractive",
    "RUN apt-get update -qq \\",
    "  && apt-get install -y -qq curl git unzip ca-certificates python3 \\",
    "  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\",
    `  && apt-get install -y -qq nodejs && ${clean}`,
    // The whole skills/ tree, not just this skill: the checksummed installs are
    // borrowed from lisa-setup-remote-env, and copying only this directory left
    // bws and gh silently unprovisioned.
    "COPY skills/ /opt/lisa/skills/",
    // Set BEFORE the install, not after. Installers write into ~/.local/bin and
    // the post-install check looks for the binary by bare name, so a PATH set
    // afterwards would fail every verification in the image while passing on a
    // laptop that already exports the directory.
    `ENV PATH="${pathDirs("/root").join(":")}:\${PATH}"`,
    // --provider is passed explicitly: the build has no TTY, so an omitted flag
    // would resolve to `none` and produce an image with no way to reach secrets.
    `RUN node /opt/lisa/skills/lisa-setup-workstation/scripts/cli.mjs \\`,
    `  --install --agents=${list} --provider=${provider}`,
    'CMD ["bash"]',
  ].join("\n");
}

/**
 * Run the CLI.
 * @param {string[]} argv Arguments after the script name.
 * @param {object} [io] Injected output sinks, for tests.
 * @returns {number} Process exit code.
 */
export async function run(argv, io = {}) {
  const out = io.log ?? console.log;
  const err = io.error ?? console.error;
  const flag = name => argv.includes(`--${name}`);
  const value = name => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };

  const selected = value("agents");
  const agents = selected
    ? selected
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    : null;

  // `--tools=` with nothing after it selects everything, deliberately.
  //
  // Its caller is a shell substitution — a repo-less setup script asking the
  // vault which CLIs its secrets imply — and a vault that names none must leave
  // the container exactly as it was before this flag existed. Reading an empty
  // value as "install nothing" would make adopting the convention a silent
  // regression for every environment that has not annotated its notes yet.
  const requested = value("tools");
  const tools = requested
    ? requested
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
    : null;

  const provider = chooseProvider(value("provider"), io);

  if (flag("print-dockerfile")) {
    out(renderDockerfile(agents ?? [], provider));
    return 0;
  }

  let plan;
  try {
    plan = planWorkstation({ agents, tools, provider, ...(io.probes ?? {}) });
  } catch (error) {
    // A misspelled provider stops here rather than silently provisioning the
    // wrong credential manager.
    err(String(error.message));
    return 1;
  }

  if (flag("json")) {
    out(JSON.stringify({ plan }, null, 2));
    return 0;
  }

  out(renderPlan(plan));

  const blocked = plan.filter(r => r.action === "blocked");
  if (blocked.length) {
    err(
      `\n${blocked.length} required tool(s) absent. These come from the OS or ` +
        `base image and cannot be installed here.`
    );
    return 1;
  }

  const pending = plan.filter(r => r.action === "install");
  if (!pending.length) {
    // Idempotence made visible. A second run states it rather than going quiet,
    // because silence reads as "did nothing because it broke".
    out("\nNothing to install — this workstation is already prepared.");
    return 0;
  }

  if (!flag("install")) {
    out(
      `\n${pending.length} missing. Re-run with --install to provision them. ` +
        `Nothing has been installed or written.`
    );
    return 0;
  }

  out("");
  // Provider entries are keyed by vendor name but planned under their BINARY
  // name (`bitwarden` -> `bws`), so they are re-keyed here or the lookup below
  // silently finds nothing and the install is skipped without a word.
  const catalogue = [
    ...AGENTS,
    ...TOOLS,
    ...PROVIDERS.filter(p => p.binary).map(p => ({ ...p, name: p.binary })),
  ];
  const probes = io.probes ?? {};
  const installPinned =
    probes.installPinned ?? (await loadPinnedInstaller()) ?? undefined;

  const results = [];
  for (const row of pending) {
    results.push(
      installEntry(
        catalogue.find(e => e.name === row.name),
        row,
        { ...probes, installPinned }
      )
    );
  }
  for (const result of results) {
    out(`  ${result.action.padEnd(10)} ${result.label}  ${result.reason}`);
  }

  const failed = results.filter(r => r.action === "failed");
  if (failed.length) {
    err(
      `\n${failed.length} install(s) failed: ${failed
        .map(r => r.name)
        .join(", ")}. Nothing above was reported as installed unless the ` +
        `binary was found on PATH afterwards.`
    );
  }
  return failed.length ? 1 : 0;
}

/**
 * Prompt on the terminal, synchronously.
 *
 * Reads `/dev/tty` rather than stdin so the question still works when the
 * script is being piped — the ordinary way a bootstrap gets run.
 * @param {string} prompt Text to display.
 * @returns {string|null} The answer, or null if no terminal is attached.
 */
export function askTty(prompt) {
  let fd;
  try {
    fd = openSync("/dev/tty", "r+");
  } catch {
    return null;
  }
  try {
    writeSync(fd, prompt);
    const buffer = Buffer.alloc(256);
    const read = readSync(fd, buffer, 0, buffer.length, null);
    return buffer.toString("utf8", 0, read).trim();
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Put the install directory on PATH before anything probes it.
 *
 * Installers write into `~/.local/bin`, and the post-install check then looks
 * for the binary by bare name. That directory is on PATH by default on a
 * developer workstation and is NOT on a minimal container, so without this
 * every install in a container would report "exited 0 but still not on PATH"
 * while every laptop run passed — the environment doing the verifying hiding
 * the bug. Prepended, and compared entry-by-entry rather than by substring.
 * @param {string} dir Directory to ensure is present.
 * @param {object} [env] Environment to mutate.
 */
export function ensureOnPath(dir, env = process.env) {
  const entries = (env.PATH ?? "").split(":").filter(Boolean);
  if (!entries.includes(dir)) env.PATH = [dir, ...entries].join(":");
}

if (process.argv[1] && process.argv[1].endsWith("cli.mjs")) {
  for (const dir of pathDirs(process.env.HOME ?? "")) ensureOnPath(dir);
  process.exitCode = await run(process.argv.slice(2), { ask: askTty });
}
