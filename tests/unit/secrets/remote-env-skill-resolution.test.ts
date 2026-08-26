/**
 * Regression tests for how the remote-env entrypoint locates its skill.
 *
 * The entrypoint originally searched only the three agent skill directories,
 * on the assumption that a checkout carries the skills. That holds for OpenCode
 * and Antigravity, where `lisa apply` writes them into the repository, and is
 * false for Claude and Codex, which receive them as an installed plugin living
 * in the user's home directory.
 *
 * A remote container is always the second case: it clones the repository and
 * has never run a plugin install. So every Claude or Codex project hit "Cannot
 * find the lisa-setup-remote-env skill in this checkout" on its first container
 * and provisioned an environment that failed on first dispatch.
 *
 * `node_modules/@codyswann/lisa` is the copy that is present, at the version
 * the project pins. These tests pin both that it is searched and that the
 * agent directories still win when they exist.
 * @module tests/unit/secrets/remote-env-skill-resolution
 */
import type { SpawnSyncReturns } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const ENTRYPOINT_PATH =
  "plugins/src/base/skills/lisa-setup-remote-env/assets/setup.sh";

/**
 * Absolute, so the interpreter cannot be resolved through a writable PATH
 * entry. These tests deliberately do not shim PATH, so there is no reason to
 * take the lookup.
 */
const BASH = "/bin/bash";

/** Where the npm package carries the skill on a fresh container. */
const NODE_MODULES_RUNNER =
  "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** The in-checkout location that must keep taking precedence. */
const CLAUDE_RUNNER =
  ".claude/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** OpenCode's checked-in skill copy, which must beat the installed package. */
const OPENCODE_RUNNER =
  ".opencode/skills/lisa/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** Where the Lisa monorepo itself keeps the skill, at HEAD. */
const CHECKOUT_PLUGIN_RUNNER =
  "plugins/lisa/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** Distinct marker for the checkout's own plugin copy. */
const CHECKOUT_PLUGIN_MARKER = "ran-from-checkout-plugins";

/** Distinct markers, so a test can tell which runner actually executed. */
const NODE_MODULES_MARKER = "ran-from-node-modules";
const CLAUDE_MARKER = "ran-from-claude-skills";
const OPENCODE_MARKER = "ran-from-opencode-skills";

const temporaryDirectories: string[] = [];

/**
 * Create and register a disposable project directory.
 * @returns Absolute path to the disposable directory
 */
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "lisa-remote-env-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Plant a stub runner that announces itself and echoes its arguments.
 * @param root Project directory
 * @param relativePath Runner location relative to root
 * @param marker Text the stub prints on stdout
 */
function plantRunner(root: string, relativePath: string, marker: string): void {
  const absolute = path.join(root, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(
    absolute,
    `console.log(${JSON.stringify(marker)});\n` +
      `console.log(process.argv.slice(2).join(" "));\n`
  );
}

/**
 * Run the entrypoint in a project directory.
 * @param root Project directory
 * @param args Arguments forwarded to the entrypoint
 * @returns The completed process
 */
function runEntrypoint(
  root: string,
  args: readonly string[] = []
): SpawnSyncReturns<string> {
  const script = path.join(root, "setup.sh");
  writeFileSync(script, readFileSync(ENTRYPOINT_PATH, "utf8"));
  return boundedSpawnSync({
    label: "the remote-env setup.sh entrypoint",
    command: BASH,
    args: [script, ...args],
    cwd: root,
    // Never run a real package manager. This test plants a FABRICATED lockfile
    // to assert which manager the script chooses; without this it also ran
    // `yarn install` against that lockfile — passing on a machine with no yarn
    // and doing a real network install on a CI runner that has one.
    env: { ...process.env, LISA_SKIP_INSTALL: "1" },
  });
}

/**
 * Install the entrypoint at its real repository path and invoke it from outside
 * the checkout, the way Claude cloud runs an environment setup field.
 * @param root Project directory
 * @param cwd Directory to run from
 * @param args Arguments forwarded to the entrypoint
 * @returns The completed process
 */
function runInstalledEntrypointFrom(
  root: string,
  cwd: string,
  args: readonly string[] = []
): SpawnSyncReturns<string> {
  const script = path.join(root, "scripts", "lisa-remote-env", "setup.sh");
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, readFileSync(ENTRYPOINT_PATH, "utf8"));
  return boundedSpawnSync({
    label: "the installed remote-env setup.sh entrypoint",
    command: BASH,
    args: [script, ...args],
    cwd,
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("remote-env entrypoint skill resolution", () => {
  it("resolves the runner from node_modules when no agent directory carries it", () => {
    const root = temporaryDirectory();
    plantRunner(root, NODE_MODULES_RUNNER, NODE_MODULES_MARKER);

    const result = runEntrypoint(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(NODE_MODULES_MARKER);
  });

  it("locates itself from an unrelated directory, as the vendor field does", () => {
    // The environment setup field is one identical line for every project:
    //   bash "$HOME"/*/scripts/lisa-remote-env/setup.sh
    // Claude runs it from $HOME while the checkout is one level down, so the
    // script has to find the repository rather than assume the caller cd'd.
    const root = temporaryDirectory();
    plantRunner(root, NODE_MODULES_RUNNER, NODE_MODULES_MARKER);
    const installed = path.join(root, "scripts", "lisa-remote-env", "setup.sh");
    mkdirSync(path.dirname(installed), { recursive: true });
    writeFileSync(installed, readFileSync(ENTRYPOINT_PATH, "utf8"));

    const result = boundedSpawnSync({
      label: "the remote-env entrypoint run from an unrelated directory",
      command: BASH,
      args: [installed],
      cwd: os.tmpdir(),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(NODE_MODULES_MARKER);
  });

  it("skips the dependency install when node_modules is already present", () => {
    // What makes the script cheap on a resumed container and correct to run
    // twice. Without this it would reinstall on every session start.
    const root = temporaryDirectory();
    plantRunner(root, NODE_MODULES_RUNNER, NODE_MODULES_MARKER);
    writeFileSync(path.join(root, "package-lock.json"), "{}");

    const result = runEntrypoint(root);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Installing dependencies");
  });

  it.each([
    ["# yarn lockfile v1", "yarn install --frozen-lockfile"],
    ["__metadata:\n  version: 8", "yarn install --immutable"],
  ])(
    "picks the right yarn flag for the lockfile it finds (%j)",
    (header, expected) => {
      // Classic and Berry spell the same intent differently and each rejects
      // the other's flag, so a single hardcoded one breaks half of all Yarn
      // projects. The lockfile header is what distinguishes them.
      const root = temporaryDirectory();
      plantRunner(root, CLAUDE_RUNNER, CLAUDE_MARKER);
      writeFileSync(
        path.join(root, "yarn.lock"),
        `# THIS IS AN AUTOGENERATED FILE.\n${header}\n`
      );

      const result = runEntrypoint(root);

      expect(result.stdout).toContain(
        `Installing dependencies with: ${expected}`
      );
    }
  );

  it("says so rather than guessing when no lockfile identifies the manager", () => {
    // A guessed package manager fails on the container's first command with an
    // error that blames the project rather than the guess.
    const root = temporaryDirectory();
    plantRunner(root, CLAUDE_RUNNER, CLAUDE_MARKER);

    const result = runEntrypoint(root);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("No lockfile found");
  });

  it("resolves from the checkout's own plugins directory (Lisa on Lisa)", () => {
    // Lisa applied to Lisa is the case every other rung misses. The checkout
    // IS Lisa, at HEAD; node_modules holds whatever its own lockfile pins,
    // which was four months and a hundred skills behind — so this file did not
    // exist there and setup aborted saying the skill could not be found. The
    // one place it was is the one place that was not searched.
    const root = temporaryDirectory();
    plantRunner(root, CHECKOUT_PLUGIN_RUNNER, CHECKOUT_PLUGIN_MARKER);

    const result = runEntrypoint(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(CHECKOUT_PLUGIN_MARKER);
  });

  it("prefers the checkout's plugins directory over a stale node_modules", () => {
    // A checkout that builds this skill is by construction newer than any
    // published copy of it, so HEAD wins over the pinned release.
    const root = temporaryDirectory();
    plantRunner(root, NODE_MODULES_RUNNER, NODE_MODULES_MARKER);
    plantRunner(root, CHECKOUT_PLUGIN_RUNNER, CHECKOUT_PLUGIN_MARKER);

    const result = runEntrypoint(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(CHECKOUT_PLUGIN_MARKER);
    expect(result.stdout).not.toContain(NODE_MODULES_MARKER);
  });

  it("names the resolved package version when nothing matches", () => {
    // "Not installed" and "installed, but predates this skill" read identically
    // and are fixed differently — the second is what happened, and the message
    // sent the operator to fix an install that had worked.
    const root = temporaryDirectory();
    const pkg = path.join(root, "node_modules", "@codyswann", "lisa");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "@codyswann/lisa", version: "2.195.6" })
    );

    const result = runEntrypoint(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("2.195.6");
    expect(result.stderr).toMatch(/pin is the problem/i);
  });

  it("prefers an agent skill directory over node_modules", () => {
    const root = temporaryDirectory();
    plantRunner(root, NODE_MODULES_RUNNER, NODE_MODULES_MARKER);
    plantRunner(root, CLAUDE_RUNNER, CLAUDE_MARKER);

    const result = runEntrypoint(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(CLAUDE_MARKER);
    expect(result.stdout).not.toContain(NODE_MODULES_MARKER);
  });

  it("prefers OpenCode's checked-in runner over node_modules", () => {
    const root = temporaryDirectory();
    plantRunner(root, NODE_MODULES_RUNNER, NODE_MODULES_MARKER);
    plantRunner(root, OPENCODE_RUNNER, OPENCODE_MARKER);

    const result = runEntrypoint(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(OPENCODE_MARKER);
    expect(result.stdout).not.toContain(NODE_MODULES_MARKER);
  });

  it("forwards its arguments to the resolved runner", () => {
    const root = temporaryDirectory();
    plantRunner(root, NODE_MODULES_RUNNER, NODE_MODULES_MARKER);

    const result = runEntrypoint(root, ["--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--dry-run");
  });

  it("re-anchors to the repository root when installed script runs from its parent", () => {
    const parent = temporaryDirectory();
    const root = path.join(parent, "lisa");
    mkdirSync(root);
    plantRunner(root, NODE_MODULES_RUNNER, `${NODE_MODULES_MARKER}:${root}`);

    const result = runInstalledEntrypointFrom(root, parent, ["--dry-run"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`${NODE_MODULES_MARKER}:${root}`);
    expect(result.stdout).toContain("--dry-run");
  });

  it("names the missing dependency install when nothing resolves", () => {
    const root = temporaryDirectory();

    const result = runEntrypoint(root);

    expect(result.status).toBe(1);
    // The operator's actual next action, not just the symptom. A bare "run
    // lisa apply" sent them to fix a checkout that was never the problem.
    //
    // The action changed when the script started installing dependencies
    // itself: "run the install first" is no longer something anyone can do, so
    // it now names what the install failed to produce.
    expect(result.stderr).toContain("@codyswann/lisa");
    expect(result.stderr).toContain("lockfile is committed");
    expect(result.stderr).toContain("node_modules");
  });
});
