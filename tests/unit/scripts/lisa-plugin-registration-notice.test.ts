/**
 * Session-start pointer for a checkout whose Lisa plugins were never registered
 * (CodySwannGT/lisa#4504).
 *
 * Dependency install is hands-off by design (#4135), so a fresh clone opens in
 * Claude Code with none of the `@lisa` plugins it enables and `/lisa:implement`
 * simply does not exist. The plugin cannot warn about its own absence, so the
 * warning has to come from a repository hook that `lisa apply` writes into the
 * host's `.claude/settings.json`. These tests pin that the hook:
 *
 * - names `lisa apply .` when an enabled `@lisa` plugin is not registered for
 *   THIS folder (a sibling folder or nothing at all does not count);
 * - stays silent when the plugin is registered here, at user scope, or for the
 *   primary checkout of a linked worktree;
 * - never fails the session and never runs the Claude CLI (no network).
 * @module tests/unit/scripts/lisa-plugin-registration-notice
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { pluginRegistrationNotice } from "../../../all/copy-overwrite/scripts/lisa-plugin-registration-notice.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);
const SCRIPT = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-plugin-registration-notice.mjs"
);
const SCRIPT_NAME = "lisa-plugin-registration-notice.mjs";
const REMEDY = "lisa apply .";
const ENABLED = { "lisa@lisa": true, "lisa-typescript@lisa": true };

const roots: string[] = [];

/**
 * Make a canonical temporary directory.
 * @param prefix - Directory name prefix
 * @returns Real path of the directory
 */
function temp(prefix: string): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

/**
 * Write a project with the given enabled plugins.
 * @param enabled - `enabledPlugins` map, or undefined for no settings file
 * @returns Project root
 */
function project(enabled?: Record<string, boolean>): string {
  const root = temp("lisa-reg-project-");
  if (enabled !== undefined) {
    mkdirSync(path.join(root, ".claude"), { recursive: true });
    writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: enabled })
    );
  }
  return root;
}

/**
 * Write a Claude config dir whose plugin registry holds the given entries.
 * @param plugins - Registry `plugins` map, or a raw string body
 * @returns Config directory
 */
function configDir(
  plugins?: Record<string, readonly Record<string, string>[]> | string
): string {
  const dir = temp("lisa-reg-config-");
  if (plugins !== undefined) {
    mkdirSync(path.join(dir, "plugins"), { recursive: true });
    writeFileSync(
      path.join(dir, "plugins", "installed_plugins.json"),
      typeof plugins === "string"
        ? plugins
        : JSON.stringify({ version: 2, plugins })
    );
  }
  return dir;
}

/**
 * Evaluate the notice for a project and config directory.
 * @param projectDir - Project root
 * @param config - Claude config directory
 * @param env - Extra environment
 * @returns Notice text or undefined
 */
function notice(
  projectDir: string,
  config: string,
  env: Record<string, string> = {}
): string | undefined {
  return pluginRegistrationNotice({ projectDir, configDir: config, env });
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("session-start plugin registration notice", () => {
  it("names `lisa apply .` and every missing plugin when none is registered here", () => {
    const root = project(ENABLED);
    const sibling = temp("lisa-reg-sibling-");
    const config = configDir({
      "lisa@lisa": [{ scope: "project", projectPath: sibling }],
    });
    const text = notice(root, config) ?? "";
    expect(text).toContain(REMEDY);
    expect(text).toContain("lisa@lisa");
    expect(text).toContain("lisa-typescript@lisa");
    expect(text).toContain("/lisa:implement");
  });

  it("names `lisa apply .` when the plugin registry does not exist yet", () => {
    const text = notice(project(ENABLED), configDir()) ?? "";
    expect(text).toContain(REMEDY);
  });

  it("names only the plugins this folder is missing", () => {
    const root = project(ENABLED);
    const config = configDir({
      "lisa@lisa": [{ scope: "project", projectPath: root }],
    });
    const text = notice(root, config) ?? "";
    expect(text).toContain("lisa-typescript@lisa");
    expect(text).not.toContain("lisa@lisa,");
    expect(text).not.toMatch(/(^|[^-])lisa@lisa/);
  });

  it("is silent when every enabled plugin is registered for this folder or at user scope", () => {
    const root = project(ENABLED);
    const config = configDir({
      "lisa@lisa": [{ scope: "project", projectPath: root }],
      "lisa-typescript@lisa": [{ scope: "user" }],
    });
    expect(notice(root, config)).toBeUndefined();
  });

  it("accepts the primary checkout's registration from a linked worktree", () => {
    const primary = project(ENABLED);
    const worktree = project(ENABLED);
    writeFileSync(
      path.join(worktree, ".git"),
      `gitdir: ${path.join(primary, ".git", "worktrees", "wt")}\n`
    );
    const config = configDir({
      "lisa@lisa": [{ scope: "project", projectPath: primary }],
      "lisa-typescript@lisa": [{ scope: "local", projectPath: primary }],
    });
    expect(notice(worktree, config)).toBeUndefined();
  });

  it.each([
    ["no settings file", undefined],
    ["no enabled @lisa plugin", { "other@market": true, "lisa@lisa": false }],
  ])("is silent with %s", (_label, enabled) => {
    expect(notice(project(enabled), configDir())).toBeUndefined();
  });

  it("is silent when the registry cannot be parsed rather than guessing", () => {
    expect(notice(project(ENABLED), configDir("{ not json"))).toBeUndefined();
  });

  it("is silent in a cloud session, where the marketplace install is not the operator's to run", () => {
    expect(
      notice(project(ENABLED), configDir(), { CLAUDE_CODE_REMOTE: "true" })
    ).toBeUndefined();
  });
});

describe("session-start plugin registration hook entry point", () => {
  it("prints a SessionStart message, exits 0, and never runs the Claude CLI", () => {
    const root = project(ENABLED);
    const home = temp("lisa-reg-home-");
    const bin = temp("lisa-reg-bin-");
    const log = path.join(bin, "calls.log");
    writeFileSync(log, "");
    writeFileSync(
      path.join(bin, "claude"),
      `#!/bin/sh\necho "$@" >> "${log}"\n`
    );
    chmodSync(path.join(bin, "claude"), 0o755);
    const result = boundedSpawnSync({
      label: "plugin registration notice",
      command: process.execPath,
      args: [SCRIPT],
      cwd: root,
      input: JSON.stringify({ hook_event_name: "SessionStart" }),
      childMayExitBeforeReading: true,
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        HOME: home,
        CLAUDE_PROJECT_DIR: root,
      },
    });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      systemMessage: string;
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.systemMessage).toContain(REMEDY);
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toContain(REMEDY);
    expect(readFileSync(log, "utf8")).toBe("");
  });

  it("exits 0 silently when everything is registered", () => {
    const root = project({ "lisa@lisa": true });
    const home = temp("lisa-reg-home-");
    mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
    writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "lisa@lisa": [{ scope: "project", projectPath: root }] },
      })
    );
    const result = boundedSpawnSync({
      label: "plugin registration notice (registered)",
      command: process.execPath,
      args: [SCRIPT],
      cwd: root,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        CLAUDE_PROJECT_DIR: root,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("is registered as a SessionStart hook in the host settings template", () => {
    const settings = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, "all/merge/.claude/settings.json"),
        "utf8"
      )
    ) as {
      hooks: { SessionStart: { hooks: { command: string }[] }[] };
    };
    const commands = settings.hooks.SessionStart.flatMap(entry =>
      entry.hooks.map(hook => hook.command)
    );
    expect(commands.some(command => command.includes(SCRIPT_NAME))).toBe(true);
  });
});
