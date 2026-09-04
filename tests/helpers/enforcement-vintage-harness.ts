/**
 * Fabricated session-equivalents for the `enforcement-vintage.sh` hook.
 *
 * The suites drive the SHIPPED shell script with a plugin root that is a real
 * directory on disk holding a real copy of the renderer — because that is the
 * only construction that reproduces the defect. A session executes one resolved
 * copy of Lisa for its whole life, so a test that imports the renderer from the
 * checkout proves the module works and leaves the thing that actually runs
 * untested: the copy in the cache, dating itself from where it was loaded.
 *
 * `pluginCopy` therefore builds exactly that — `<root>/.claude-plugin/plugin.json`
 * stating a version, `<root>/hooks/` holding the real script and renderer — so a
 * fabricated 4.32.2 copy is indistinguishable, from inside, from the eleven-hour-old
 * lane that measured 4.32.2 while the marketplace sat at 4.35.1.
 *
 * The inherited environment arrives as a parameter rather than being read here,
 * matching `inject-resolved-config-harness`: a test file may reach for
 * `process.env`, a shared helper may not.
 * @module tests/helpers/enforcement-vintage-harness
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "./io-latency-budget.js";

/** The shipped hook, as a harness invokes it. */
export const HOOK = "plugins/src/base/hooks/enforcement-vintage.sh";
/** The renderer the hook delegates to. */
export const RENDERER = "plugins/src/base/hooks/enforcement-vintage.mjs";
/** Directory every plugin payload keeps its hooks in. */
const HOOKS = "hooks";
/** Manifest directory a Claude plugin dates itself from. */
const MANIFEST_DIR = ".claude-plugin";
/** Manifest filename inside it. */
const MANIFEST = "plugin.json";
/** Guard whose presence decides which repository tree resolves first. */
const GUARD = "block-no-verify.sh";
/** The monorepo's own guard tree, relative to a project root. */
const PLUGIN_TREE = ["plugins", "lisa"];
/** A guard body that resolves and does nothing. */
const NO_OP_GUARD = "#!/usr/bin/env bash\nexit 0\n";

/** The envelope a context-injection hook emits. */
export type HookOutput = {
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
  };
};

/** What one hook invocation produced. */
export type HookRun = {
  output: HookOutput;
  status: number | null;
  stdout: string;
};

/** How a suite drives the hook. */
export type HookRunner = {
  runHook: (options: {
    pluginRoot: string;
    projectDir: string;
    configDir: string;
    input?: Record<string, unknown>;
  }) => HookRun;
  contextFor: (options: {
    pluginRoot: string;
    projectDir: string;
    configDir: string;
    input?: Record<string, unknown>;
  }) => string;
};

/**
 * Make a throwaway directory.
 * @param prefix - Name prefix for the directory
 * @returns Absolute path to an empty directory
 */
export function scratch(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `lisa-vintage-${prefix}-`));
}

/**
 * A self-dating copy of the plugin, at a chosen version.
 *
 * This is the session-equivalent. The renderer is COPIED rather than symlinked:
 * a symlink resolves back to the checkout, the renderer would date itself from
 * there, and the fixture would silently test the checkout's version instead of
 * the one it claims to be.
 * @param version - Version the copy declares, or "" for an undateable copy
 * @returns Absolute path to the plugin root
 */
export function pluginCopy(version: string): string {
  const root = scratch("copy");
  mkdirSync(path.join(root, HOOKS), { recursive: true });
  copyFileSync(path.resolve(HOOK), path.join(root, HOOKS, path.basename(HOOK)));
  copyFileSync(
    path.resolve(RENDERER),
    path.join(root, HOOKS, path.basename(RENDERER))
  );
  if (version) {
    mkdirSync(path.join(root, MANIFEST_DIR), { recursive: true });
    writeFileSync(
      path.join(root, MANIFEST_DIR, MANIFEST),
      JSON.stringify({ name: "lisa", version }),
      "utf8"
    );
  }
  return root;
}

/**
 * A harness config directory whose marketplace clone declares a version.
 *
 * The marketplace clone is the copy `claude plugin` put on this machine and is
 * what a RESTART would resolve, which is what makes it the meaningful
 * comparison: it names a Lisa that is present and unreachable.
 * @param version - Version the marketplace clone declares, or "" for none
 * @returns Absolute path to the config directory
 */
export function configDir(version: string): string {
  const root = scratch("config");
  if (version) {
    const manifest = path.join(
      root,
      "plugins",
      "marketplaces",
      "lisa",
      "plugins",
      "lisa",
      MANIFEST_DIR
    );
    mkdirSync(manifest, { recursive: true });
    writeFileSync(
      path.join(manifest, MANIFEST),
      JSON.stringify({ name: "lisa", version }),
      "utf8"
    );
  }
  return root;
}

/**
 * A host project whose `scripts/lisa-hooks/` tree was written by `lisa apply`.
 *
 * The apply receipt IS that tree's vintage: the same run produced both, so they
 * cannot disagree.
 * @param version - Version recorded in the apply receipt, or "" for no receipt
 * @returns Absolute path to the project root
 */
export function hostProject(version: string): string {
  const root = scratch("project");
  mkdirSync(path.join(root, "scripts", "lisa-hooks"), { recursive: true });
  writeFileSync(
    path.join(root, "scripts", "lisa-hooks", GUARD),
    NO_OP_GUARD,
    "utf8"
  );
  if (version) {
    mkdirSync(path.join(root, ".lisa"), { recursive: true });
    writeFileSync(
      path.join(root, ".lisa", "apply-receipt.json"),
      JSON.stringify({ lisa_version: version }),
      "utf8"
    );
  }
  return root;
}

/**
 * A monorepo checkout that carries BOTH guard trees.
 *
 * Resolution is first-wins, so `scripts/lisa-hooks/` governs and
 * `plugins/lisa/hooks/` never runs — regardless of which is newer. A fixture
 * where the shadowed tree is the NEWER one is the only construction that tells
 * "reports the tree in force" apart from "reports the newest tree".
 * @param hostVersion - Version recorded in the apply receipt
 * @param pluginVersion - Version the shadowed plugin manifest declares
 * @returns Absolute path to the project root
 */
export function bothTreesProject(
  hostVersion: string,
  pluginVersion: string
): string {
  const root = hostProject(hostVersion);
  mkdirSync(path.join(root, ...PLUGIN_TREE, HOOKS), { recursive: true });
  writeFileSync(
    path.join(root, ...PLUGIN_TREE, HOOKS, GUARD),
    NO_OP_GUARD,
    "utf8"
  );
  mkdirSync(path.join(root, ...PLUGIN_TREE, MANIFEST_DIR), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, ...PLUGIN_TREE, MANIFEST_DIR, MANIFEST),
    JSON.stringify({ name: "lisa", version: pluginVersion }),
    "utf8"
  );
  return root;
}

/**
 * A monorepo checkout carrying ONLY its own `plugins/lisa/hooks/` tree.
 *
 * The other half of the repair split: `lisa apply` wrote the host tree and can
 * rewrite it, but this tree IS the checkout's source, so only moving the branch
 * refreshes it. A fixture for each is what stops the two remedies being tested
 * as one.
 * @param version - Version the plugin manifest declares
 * @returns Absolute path to the project root
 */
export function pluginTreeProject(version: string): string {
  const root = scratch("monorepo");
  mkdirSync(path.join(root, ...PLUGIN_TREE, HOOKS), { recursive: true });
  writeFileSync(
    path.join(root, ...PLUGIN_TREE, HOOKS, GUARD),
    NO_OP_GUARD,
    "utf8"
  );
  mkdirSync(path.join(root, ...PLUGIN_TREE, MANIFEST_DIR), { recursive: true });
  writeFileSync(
    path.join(root, ...PLUGIN_TREE, MANIFEST_DIR, MANIFEST),
    JSON.stringify({ name: "lisa", version }),
    "utf8"
  );
  return root;
}

/**
 * Run the renderer directly, so the loaded copy and `CLAUDE_PLUGIN_ROOT` can
 * disagree.
 *
 * Through the wrapper they cannot: it uses the variable to FIND the renderer,
 * so whatever it names is what gets loaded. Invoking node against one copy while
 * the variable names another is the only way to ask whether the vintage is an
 * observation of where the code came from or a claim the environment made.
 * @param baseEnv - Environment to inherit (callers pass process.env)
 * @param options - Which copy to load, and what the environment should claim
 * @param options.loadedCopy - Plugin copy the renderer is actually loaded from
 * @param options.claimedRoot - Plugin copy `CLAUDE_PLUGIN_ROOT` names instead
 * @param options.configDir - Harness config directory holding the marketplace clone
 * @returns The injected context
 */
export function contextFromLoadedCopy(
  baseEnv: NodeJS.ProcessEnv,
  options: { loadedCopy: string; claimedRoot: string; configDir: string }
): string {
  const result = boundedSpawnSync({
    label: "enforcement-vintage renderer",
    command: process.execPath,
    args: [
      path.join(options.loadedCopy, HOOKS, path.basename(RENDERER)),
      "--project-dir",
      options.loadedCopy,
      "--config-dir",
      options.configDir,
    ],
    env: { ...baseEnv, CLAUDE_PLUGIN_ROOT: options.claimedRoot },
    input: "{}",
  });
  const parsed = result.stdout
    ? (JSON.parse(result.stdout) as HookOutput)
    : ({} as HookOutput);
  return parsed.hookSpecificOutput?.additionalContext ?? "";
}

/**
 * Bind a hook runner to an inherited environment.
 * @param baseEnv - Environment to inherit (callers pass process.env)
 * @returns A runner bound to that environment
 */
export function hookRunner(baseEnv: NodeJS.ProcessEnv): HookRunner {
  const runHook = (options: {
    pluginRoot: string;
    projectDir: string;
    configDir: string;
    input?: Record<string, unknown>;
  }): HookRun => {
    const result = boundedSpawnSync({
      label: "enforcement-vintage hook",
      command: "/bin/bash",
      args: [path.join(options.pluginRoot, HOOKS, path.basename(HOOK))],
      env: {
        ...baseEnv,
        CLAUDE_PLUGIN_ROOT: options.pluginRoot,
        CLAUDE_PROJECT_DIR: options.projectDir,
        CLAUDE_CONFIG_DIR: options.configDir,
      },
      input: options.input ? JSON.stringify(options.input) : "",
    });
    return {
      output: result.stdout ? (JSON.parse(result.stdout) as HookOutput) : {},
      status: result.status,
      stdout: result.stdout,
    };
  };

  return {
    runHook,
    contextFor: options =>
      runHook(options).output.hookSpecificOutput?.additionalContext ?? "",
  };
}
