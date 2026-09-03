/**
 * Fixture projects and a runner for the `inject-resolved-config.sh` hook.
 *
 * Shared by the behaviour suite and the wiring suite so both drive the hook the
 * way a harness does — through the shipped shell script, with the real
 * `plugins/src/base` payload as the plugin root — rather than by importing the
 * renderer, which would prove the module works and leave the thing that
 * actually runs at session start untested.
 *
 * The inherited environment arrives as a parameter rather than being read here,
 * matching `verification-gate-harness` and `safety-net-guard-harness`: a test
 * file may reach for `process.env`, a shared helper may not.
 * @module tests/helpers/inject-resolved-config-harness
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedSpawnSync } from "./io-latency-budget.js";

/** The shipped hook, as a harness invokes it. */
export const HOOK = "plugins/src/base/hooks/inject-resolved-config.sh";
/** The renderer the hook delegates to. */
export const RENDERER = "plugins/src/base/hooks/inject-resolved-config.mjs";
/** Committed config filename. */
export const MAIN_CONFIG = ".lisa.config.json";
/** Local per-developer override filename. */
export const LOCAL_CONFIG = ".lisa.config.local.json";

/**
 * A developer identity of exactly the shape `.lisa.config.local.json` is
 * documented to carry. Deliberately unlike any real address.
 */
export const DEVELOPER_IDENTITY = "fixture-developer@example.invalid";

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

/** The two ways a suite drives the hook. */
export type HookRunner = {
  runHook: (
    projectDir: string,
    input?: Record<string, unknown>,
    pluginRoot?: string
  ) => HookRun;
  contextFor: (projectDir: string, input?: Record<string, unknown>) => string;
};

/**
 * Make a throwaway project root.
 * @returns Absolute path to an empty directory
 */
export function project(): string {
  return mkdtempSync(path.join(tmpdir(), "lisa-resolved-config-"));
}

/**
 * Write a config file verbatim, so malformed content survives to the hook.
 * @param root - Project root
 * @param name - Config filename
 * @param body - Exact file contents
 */
export function write(root: string, name: string, body: string): void {
  writeFileSync(path.join(root, name), body, "utf8");
}

/**
 * Write a config file from an object.
 * @param root - Project root
 * @param name - Config filename
 * @param value - Config to serialize
 */
export function writeJson(root: string, name: string, value: unknown): void {
  write(root, name, JSON.stringify(value));
}

/**
 * A plugin payload that has the hook script but not its renderer.
 *
 * The shape a partial or interrupted install leaves behind. Nothing about it
 * may reach the session: the hook has to notice and stay quiet.
 * @returns Absolute path to a plugin root with an empty `hooks/` directory
 */
export function partialPluginRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-partial-plugin-"));
  mkdirSync(path.join(root, "hooks"), { recursive: true });
  return root;
}

/**
 * Bind a hook runner to an inherited environment.
 *
 * `CLAUDE_PROJECT_DIR` is how a harness names the root and is what the hook is
 * expected to honour, so it is set explicitly rather than relying on the
 * process working directory.
 * @param baseEnv - Environment to inherit (callers pass process.env)
 * @returns A runner bound to that environment
 */
export function hookRunner(baseEnv: NodeJS.ProcessEnv): HookRunner {
  const runHook = (
    projectDir: string,
    input?: Record<string, unknown>,
    pluginRoot: string = path.resolve("plugins/src/base")
  ): HookRun => {
    const result = boundedSpawnSync({
      label: "inject-resolved-config hook",
      command: "/bin/bash",
      args: [path.resolve(HOOK)],
      env: {
        ...baseEnv,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        CLAUDE_PROJECT_DIR: projectDir,
      },
      input: input ? JSON.stringify(input) : "",
    });
    return {
      output: result.stdout ? (JSON.parse(result.stdout) as HookOutput) : {},
      status: result.status,
      stdout: result.stdout,
    };
  };

  return {
    runHook,
    contextFor: (projectDir, input) =>
      runHook(projectDir, input).output.hookSpecificOutput?.additionalContext ??
      "",
  };
}
