#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * SessionStart pointer for a checkout whose Lisa plugins are not registered
 * (CodySwannGT/lisa#4504).
 *
 * Dependency install deliberately registers nothing (#4135), so a fresh clone
 * opens in Claude Code without the `@lisa` plugins its settings enable, and
 * commands such as `/lisa:implement` simply do not exist. The plugin cannot
 * report its own absence, so this check is a REPOSITORY hook: `lisa apply`
 * writes it into the host's `.claude/settings.json`, which travels with the
 * clone whether or not any plugin ever installs.
 *
 * It is advisory and cheap by contract: it reads two local JSON files, never
 * runs the Claude CLI, never touches the network, never writes, and always
 * exits 0. Anything it cannot read confidently makes it stay silent — a false
 * alarm at every session start would teach operators to ignore it.
 *
 * Agent parity: Claude Code is the only agent with a per-folder plugin
 * registry (`~/.claude/plugins/installed_plugins.json`, keyed by projectPath).
 * Codex reads its project-local `.codex-plugin` pointer, and Cursor, OpenCode,
 * Antigravity, Copilot and Devin load Lisa's surfaces from files `lisa apply`
 * writes into the checkout, so none of them has an "enabled but unregistered
 * for this folder" state for an equivalent hook to detect.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Read and parse a JSON file.
 * @param {string} file Absolute path.
 * @returns {{ ok: true, value: unknown } | { ok: false, missing: boolean }}
 */
function readJson(file) {
  if (!existsSync(file)) return { ok: false, missing: true };
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { ok: false, missing: false };
  }
}

/**
 * Canonical spelling of a path, falling back to its resolved form.
 * @param {string} value Path to canonicalise.
 * @returns {string}
 */
function canonical(value) {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

/**
 * Enabled `<name>@lisa` plugin ids from the project's committed settings.
 * @param {string} projectDir Project root.
 * @returns {string[]}
 */
function enabledLisaPlugins(projectDir) {
  const settings = readJson(path.join(projectDir, ".claude", "settings.json"));
  if (!settings.ok) return [];
  const enabled = /** @type {Record<string, unknown>} */ (settings.value)
    ?.enabledPlugins;
  if (enabled === null || typeof enabled !== "object" || Array.isArray(enabled))
    return [];
  return Object.entries(enabled)
    .filter(([id, on]) => on === true && id.endsWith("@lisa"))
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Folders whose project-scope registration serves this session: the project
 * itself and, for a linked git worktree, its primary checkout (Lisa defers a
 * worktree's registration to the primary's sync — see `computePluginSyncPlan`).
 * Read from the `.git` file directly so no git process is spawned.
 * @param {string} projectDir Project root.
 * @returns {Set<string>}
 */
function servingFolders(projectDir) {
  const folders = new Set([canonical(projectDir)]);
  try {
    const pointer = readFileSync(path.join(projectDir, ".git"), "utf8");
    const gitdir = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
    const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
    const at = gitdir?.lastIndexOf(marker) ?? -1;
    if (gitdir && at > 0) folders.add(canonical(gitdir.slice(0, at)));
  } catch {
    // Not a linked worktree (a `.git` directory, or no git at all).
  }
  return folders;
}

/**
 * Whether one registry entry makes the plugin available in this folder.
 * @param {unknown} entry Registry entry.
 * @param {Set<string>} folders Folders that serve this session.
 * @returns {boolean}
 */
function servesHere(entry, folders) {
  if (entry === null || typeof entry !== "object") return false;
  const { scope, projectPath } = /** @type {Record<string, unknown>} */ (entry);
  if (scope === "user") return true;
  return typeof projectPath === "string" && folders.has(canonical(projectPath));
}

/**
 * Decide what, if anything, to tell the operator at session start.
 * @param {{ projectDir: string, configDir: string, env?: Record<string, string | undefined> }} options
 *   Project root, Claude config directory, and environment.
 * @returns {string | undefined} The notice, or undefined when nothing is missing.
 */
export function pluginRegistrationNotice({ projectDir, configDir, env = {} }) {
  // A cloud session installs plugins from the marketplace itself; running
  // `lisa apply .` there is not the operator's remedy.
  if (env.CLAUDE_CODE_REMOTE === "true") return undefined;
  const enabled = enabledLisaPlugins(projectDir);
  if (enabled.length === 0) return undefined;
  const registry = readJson(
    path.join(configDir, "plugins", "installed_plugins.json")
  );
  if (!registry.ok && !registry.missing) return undefined;
  const plugins = registry.ok
    ? /** @type {Record<string, unknown>} */ (registry.value)?.plugins
    : {};
  if (plugins === null || typeof plugins !== "object") return undefined;
  const folders = servingFolders(projectDir);
  const missing = enabled.filter(id => {
    const entries = /** @type {Record<string, unknown>} */ (plugins)[id];
    return !(
      Array.isArray(entries) &&
      entries.some(entry => servesHere(entry, folders))
    );
  });
  if (missing.length === 0) return undefined;
  return (
    `Lisa: this project turns on ${missing.length} Claude Code plugin(s) that are not ` +
    `set up for this folder yet (${missing.join(", ")}), so Lisa commands such as ` +
    `/lisa:implement are unavailable in this session. Installing dependencies does not ` +
    "set them up. Run `lisa apply .` in this project, then restart Claude Code."
  );
}

/**
 * Hook entry point: print a SessionStart message when plugins are missing.
 * @returns {void}
 */
function main() {
  try {
    const env = process.env;
    const message = pluginRegistrationNotice({
      projectDir: env.CLAUDE_PROJECT_DIR?.trim() || process.cwd(),
      configDir:
        env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), ".claude"),
      env,
    });
    if (message === undefined) return;
    process.stdout.write(
      `${JSON.stringify({
        systemMessage: message,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: message,
        },
      })}\n`
    );
  } catch {
    // Advisory only: never fail or block a session over this pointer.
  }
}

if (invokedAsScript(import.meta.url)) {
  main();
  process.exitCode = 0;
}
