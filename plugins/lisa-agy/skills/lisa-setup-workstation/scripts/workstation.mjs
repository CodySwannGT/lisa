#!/usr/bin/env node
/**
 * Prepare a machine — or a throwaway container — to run coding agents.
 *
 * This is the layer beneath `lisa-setup-local-env`, which reads a project's
 * `remoteEnv.tools` and therefore needs a checkout to exist first. That left
 * the machine most likely to be missing a tool — a fresh laptop, or an empty
 * container — with nothing to ask.
 *
 * Nothing here reads a repository. The composition is:
 *
 *     workstation  ->  git clone  ->  lisa-detect-tooling  ->  lisa-setup-local-env
 *
 * ## Ephemerality is not a mode
 *
 * There is no Docker branch. A container gets a throwaway `$HOME` and dies with
 * it; a laptop keeps its own. Same code path, so the rarely-run one cannot rot
 * — the failure mode a second install path always eventually has.
 *
 * ## Already-installed wins, however it got there
 *
 * A tool present by ANY means is reported and left alone. That dissolves the
 * "Homebrew or ~/.local/bin" question: we never contend for ownership of a tool
 * someone else's package manager installed, and never shadow it with an earlier
 * PATH entry that would silently win over their upgrades.
 *
 * Usage:
 *   workstation.mjs                     report what is present and missing
 *   workstation.mjs --install           install everything missing
 *   workstation.mjs --install --agents=claude,codex   only these agents
 *   workstation.mjs --json              machine-readable plan
 *   workstation.mjs --print-dockerfile  an image that runs this same script
 * @module workstation
 */

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

import {
  boundedChildOutput,
  SETUP_OPERATION_BUDGET_MS,
} from "./bounded-child.mjs";

import {
  AGENTS,
  CHECKSUMMED,
  INSTALLABLE,
  PROVIDERS,
  TOOLS,
} from "./catalogue.mjs";

/**
 * Locate a command without running it.
 *
 * Presence and version are different questions, and conflating them has bitten
 * this codebase before: probing with `--version` reported `unzip` missing on
 * machines that had it, because Info-ZIP exits 10 on an unknown flag. So
 * presence is `command -v` and nothing else.
 * @param {string} name Executable name.
 * @param {Function} [exec] Runner, injectable for tests.
 * @returns {string|null} Absolute path, or null when absent.
 */
export function locate(name, exec = boundedChildOutput) {
  try {
    return String(
      exec("command", ["-v", name], { encoding: "utf8", shell: true })
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Read a tool's version, tolerating tools that dislike `--version`.
 *
 * A non-zero exit does NOT mean absent — only a failure to spawn does. Version
 * text is still recovered from a failed invocation where there is any, because
 * a tool that refuses the flag often prints its banner anyway.
 * @param {string} name Executable name.
 * @param {Function} [exec] Runner, injectable for tests.
 * @returns {string|null} A dotted version, or null.
 */
export function version(name, exec = boundedChildOutput) {
  const read = out => {
    const match = /(\d+(?:\.\d+)+)/.exec(String(out ?? ""));
    return match ? match[1] : null;
  };
  try {
    return read(
      exec(name, ["--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      })
    );
  } catch (error) {
    if (error.code === "ENOENT") return null;
    return read(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

/**
 * Where a tool came from, so the report can say why it is being left alone.
 * @param {string|null} path Absolute path to the executable.
 * @returns {string} A short provenance label.
 */
export function provenance(path) {
  if (!path) return "absent";
  if (path.includes("/homebrew/") || path.startsWith("/usr/local/Cellar"))
    return "homebrew";
  if (path.includes("/.local/bin/")) return "~/.local/bin";
  if (path.includes("/node_modules/")) return "node_modules";
  if (path.startsWith("/usr/bin") || path.startsWith("/bin")) return "system";
  return "other";
}

/**
 * Decide what to do about one catalogue entry.
 * @param {object} entry Catalogue entry.
 * @param {object} [deps] Injected probes, for tests.
 * @returns {object} A plan row.
 */
export function planEntry(entry, deps = {}) {
  const find = deps.locate ?? locate;
  const read = deps.version ?? version;

  const path = find(entry.name);
  const found = path ? read(entry.name) : null;
  const base = {
    name: entry.name,
    label: entry.label,
    kind: entry.kind,
    path,
    version: found,
    from: provenance(path),
    checksummed: CHECKSUMMED.has(entry.kind),
  };

  if (path) {
    // Present by any means: report and leave alone. Re-installing over a
    // vendor's own layout is how a self-updater gets broken.
    return {
      ...base,
      action: "present",
      reason: `already installed (${base.from})`,
    };
  }
  if (entry.kind === "required") {
    return {
      ...base,
      action: "blocked",
      reason: `${entry.name} is required but absent — ${entry.note}`,
    };
  }
  if (!INSTALLABLE.has(entry.kind)) {
    return {
      ...base,
      action: "manual",
      reason: entry.note ?? "no headless installer available",
    };
  }
  return { ...base, action: "install", reason: "absent" };
}

/**
 * Build the full plan across agents and tools.
 * @param {object} [options] Selection and injected probes.
 * @returns {object[]} Plan rows.
 */
export function planWorkstation(options = {}) {
  const wanted = options.agents ?? null;
  const agents = AGENTS.filter(a => !wanted || wanted.includes(a.name)).map(
    a => ({
      ...planEntry(a, options),
      group: "agent",
    })
  );
  // Tools are selectable for the same reason agents are, and it matters more
  // here: a remote container has a setup-script time budget, and installing a
  // CLI nothing in that container uses spends it for nothing.
  //
  // A `required` tool is never filtered out. Those are not installs — they are
  // assertions about the machine (git, node), and hiding them would turn a
  // missing prerequisite into a silent one.
  const wantedTools = options.tools ?? null;
  const tools = TOOLS.filter(
    t => t.kind === "required" || !wantedTools || wantedTools.includes(t.name)
  ).map(t => ({ ...planEntry(t, options), group: "tool" }));

  // Only the SELECTED provider is planned. Installing every credential CLI
  // would leave four unused ones on the machine, each needing patching for no
  // benefit — and would contradict the secrets contract, where the provider is
  // a per-project axis rather than a fixed vendor.
  const provider = resolveProvider(options.provider);
  const credential = provider
    ? [{ ...planProvider(provider, options), group: "provider" }]
    : [];

  return [...agents, ...credential, ...tools];
}

/**
 * Resolve a requested provider name to its catalogue entry.
 *
 * An unknown name is an error rather than a silent fallback to Bitwarden: a
 * typo that quietly provisions the wrong credential manager is worse than one
 * that stops.
 * @param {string|null|undefined} name Requested provider.
 * @returns {object|null} Entry, or null when none was requested.
 */
export function resolveProvider(name) {
  if (name === null || name === undefined) return null;
  const entry = PROVIDERS.find(p => p.name === name);
  if (!entry) {
    throw new Error(
      `unknown credential manager "${name}". Supported: ` +
        `${PROVIDERS.map(p => p.name).join(", ")}`
    );
  }
  return entry;
}

/**
 * Plan the selected credential manager.
 * @param {object} provider Catalogue entry.
 * @param {object} [deps] Injected probes, for tests.
 * @returns {object} A plan row.
 */
export function planProvider(provider, deps = {}) {
  if (provider.kind === "none") {
    // A first-class answer, not an absence. Reported so the operator can see
    // the machine is deliberately on plain environment variables.
    return {
      name: "none",
      label: provider.label,
      kind: "none",
      path: null,
      version: null,
      from: "n/a",
      checksummed: false,
      action: "present",
      reason: "no credential manager selected",
    };
  }
  return planEntry({ ...provider, name: provider.binary }, deps);
}

/**
 * Render the plan for a human.
 * @param {object[]} plan Plan rows.
 * @returns {string} Report text.
 */
export function renderPlan(plan) {
  const lines = [];
  const heading = {
    agent: "Coding agents:",
    provider: "\nCredential manager:",
    tool: "\nTools:",
  };
  for (const group of ["agent", "provider", "tool"]) {
    const rows = plan.filter(r => r.group === group);
    if (!rows.length) continue;
    lines.push(heading[group]);
    for (const row of rows) {
      const mark = {
        present: "  ok     ",
        install: "  install",
        manual: "  manual ",
        blocked: "  BLOCKED",
      }[row.action];
      // `none` is present-but-not-a-binary, so it has no version to show; a
      // bare "?" there reads as a failed probe rather than a chosen answer.
      const detail =
        row.action !== "present"
          ? row.reason
          : row.path
            ? `${row.version ?? "unknown version"}  (${row.from})`
            : row.reason;
      lines.push(`${mark} ${row.label.padEnd(22)} ${detail}`);
    }
  }

  // Say plainly which installs carry a checksum and which trust a vendor.
  const unverified = plan.filter(r => r.action === "install" && !r.checksummed);
  if (unverified.length) {
    lines.push(
      `\nNot checksummed: ${unverified.map(r => r.name).join(", ")} — these run a` +
        ` vendor installer, which is weaker than the pinned entries. Installing` +
        ` them trusts the vendor's script at fetch time.`
    );
  }
  return lines.join("\n");
}

/**
 * Install one entry by its own preferred method.
 *
 * Each vendor owns its layout; we invoke their installer rather than placing a
 * binary ourselves. `release-zip`/`release-tar` are the exception and the only
 * checksummed path — they are reused from the remote-env installer rather than
 * reimplemented, because a second installer is a second thing to keep honest.
 * @param {object} entry Catalogue entry.
 * @param {object} row Plan row for it.
 * @param {object} [deps] Injected runner, for tests.
 * @returns {object} Result row.
 */
/**
 * Make a tool that installed elsewhere reachable from `~/.local/bin`.
 *
 * A vendor script installs where it likes — SonarQube's puts `sonar` under
 * `~/.local/share/sonarqube-cli/bin` — and the catalogue records that in
 * `binDir`. Until now the only thing that put those directories on PATH was an
 * edit to the shell rc files, which a cloud container never reads: its tool
 * shell is not a login shell. So the tool installed, and the session that asked
 * for it could not find it. Observed on a live Claude Tag channel, where
 * `~/.local/share/sonarqube-cli` existed and `command -v sonar` came back empty.
 *
 * Exporting PATH from the setup script does not fix that either — those exports
 * die with the process that ran them. Only the filesystem survives into the
 * session, so the fix has to be a file.
 *
 * A symlink into `~/.local/bin` is the shape the AWS installer already uses
 * (`aws -> ~/.local/aws-cli/v2/current/bin/aws`), and that directory is the one
 * place every surface agrees is on PATH.
 *
 * Deliberately never fatal. A tool that is already reachable does not need the
 * link, and one that cannot be linked is caught a moment later by the probe —
 * which reports the real problem instead of a symlink error standing in for it.
 * @param {object} entry Catalogue entry just installed.
 * @param {object} [deps] Injected seams, for tests.
 */
export function linkIntoBinDir(entry, deps = {}) {
  if (!entry.binDir) return;

  const home = deps.home ?? process.env.HOME ?? "";
  const link = deps.link ?? symlinkSync;
  const exists = deps.exists ?? existsSync;
  const remove = deps.remove ?? rmSync;
  const makeDir = deps.mkdir ?? mkdirSync;
  // Two different questions, and they need two different probes.
  //
  // The SOURCE must be followed: a link pointing at a binary that is not there
  // means the install did not produce one, whatever the link says.
  //
  // The TARGET must NOT be followed. `existsSync` reports false for a dangling
  // symlink, which is precisely the case this function claims to repair — the
  // vendor moved and the old link now points at nothing. Following it would
  // skip the removal, `symlinkSync` would throw EEXIST, the catch below would
  // swallow it, and the broken link would survive the fix meant to replace it.
  const present = deps.present ?? (path => lstatPresent(path));

  const source = join(
    entry.binDir.replace(/^~/, home),
    entry.binary ?? entry.name
  );
  const target = join(home, ".local", "bin", entry.name);
  if (source === target || !exists(source)) return;

  try {
    makeDir(join(home, ".local", "bin"), { recursive: true });
    // Replaced rather than skipped-if-present: a stale link left by an earlier
    // version pointing at a path the vendor has since moved is worse than none,
    // because it resolves and then fails at the moment of use.
    if (present(target)) remove(target, { force: true });
    link(source, target);
  } catch {
    // See above: the probe is the authority on whether this worked.
  }
}

/**
 * Whether a path exists WITHOUT following it, so a dangling link counts.
 * @param {string} path Path to inspect.
 * @returns {boolean} True when something occupies the path.
 */
function lstatPresent(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function installEntry(entry, row, deps = {}) {
  const run =
    deps.run ??
    ((cmd, args, opts) =>
      boundedChildOutput(cmd, args, { stdio: "inherit", ...opts }));
  const find = deps.locate ?? locate;

  try {
    if (entry.kind === "npm-global") {
      run("npm", ["install", "-g", entry.package], {
        timeout: SETUP_OPERATION_BUDGET_MS,
      });
    } else if (entry.kind === "vendor-script") {
      if (!entry.script) {
        return {
          ...row,
          action: "manual",
          reason: entry.note ?? "no installer",
        };
      }
      // Piping a fetched script to a shell is exactly the unverified path the
      // report warns about. It is the vendor's supported route for these
      // tools, and the alternative — repackaging their binaries ourselves —
      // would break the self-updaters that own those directories.
      //
      // bash, NOT sh. On Ubuntu `/bin/sh` is dash, and every one of these
      // vendor scripts is a bash script: piping them to sh in a container gave
      // `Syntax error: "(" unexpected` and `set: Illegal option -o pipefail`
      // while the same command worked on a Mac, where sh is bash.
      //
      // `set -o pipefail` matters as much as the shell does: without it the
      // exit status is the SHELL's, not curl's, so a 404 feeds an empty script
      // to bash, bash exits 0, and a tool that was never installed is reported
      // as installed. That is exactly what `sonarsource.com/install` did.
      run(
        "bash",
        ["-o", "pipefail", "-c", `curl -fsSL ${entry.script} | bash`],
        { timeout: SETUP_OPERATION_BUDGET_MS }
      );
    } else if (entry.kind === "aws-cli") {
      // macOS ships a .pkg that wants an administrator, which a headless run
      // has no business prompting for. Reported as manual with the one-line
      // fix rather than attempted and failed halfway.
      if ((deps.platform ?? process.platform) === "darwin") {
        return {
          ...row,
          action: "manual",
          reason:
            "macOS installs from a .pkg needing admin — `brew install awscli`",
        };
      }
      // Unprivileged by construction: the vendor installer defaults to /usr/local,
      // which needs root and would put a container and a laptop on different
      // paths. An explicit prefix under $HOME keeps one code path for both and
      // survives a throwaway container, which is where $HOME dies anyway.
      const home = deps.home ?? process.env.HOME;
      const url = `https://awscli.amazonaws.com/awscli-exe-linux-${
        process.arch === "arm64" ? "aarch64" : "x86_64"
      }.zip`;
      run(
        "bash",
        [
          "-o",
          "pipefail",
          "-c",
          [
            "set -e",
            'tmp="$(mktemp -d)"',
            `curl -fsSL "${url}" -o "$tmp/awscli.zip"`,
            'unzip -q "$tmp/awscli.zip" -d "$tmp"',
            `"$tmp/aws/install" --install-dir "${home}/.local/aws-cli" ` +
              `--bin-dir "${home}/.local/bin" --update`,
            'rm -rf "$tmp"',
          ].join("\n"),
        ],
        { timeout: SETUP_OPERATION_BUDGET_MS }
      );
    } else if (CHECKSUMMED.has(entry.kind)) {
      // The pinned, checksummed path belongs to the remote-env installer. It is
      // borrowed rather than reimplemented so the pins and checksums cannot
      // drift between the two — a second installer is a second thing to keep
      // honest, and the one run least often is the one that rots.
      if (!deps.installPinned) {
        return {
          ...row,
          action: "failed",
          reason:
            "pinned installer unavailable — cannot verify a checksum here",
        };
      }
      deps.installPinned(entry);
    } else {
      return {
        ...row,
        action: "manual",
        reason: entry.note ?? "no headless installer",
      };
    }
  } catch (error) {
    return {
      ...row,
      action: "failed",
      reason: String(error.message).slice(0, 160),
    };
  }

  // Link it into ~/.local/bin BEFORE probing, because that is what makes the
  // probe meaningful for a tool the vendor put somewhere else.
  linkIntoBinDir(entry, deps);

  // Verify by looking, not by exit status. Every installer above can exit 0
  // having installed nothing, so a claim of success is only as good as a fresh
  // probe — reporting a tool as installed when it is absent is worse than
  // reporting the failure, because it moves the error to the moment of use.
  if (!find(entry.name)) {
    return {
      ...row,
      action: "failed",
      reason: `installer exited 0 but ${entry.name} is still not on PATH`,
    };
  }
  return { ...row, action: "installed", reason: "ok" };
}
