/**
 * What enforces on every file an agent writes — the `pre-tool` moment.
 *
 * No registry entry lists `pre-tool` in its moments, so no gate can be
 * declared there and the column renders as a wall of "not legal here". Read
 * literally that says nothing happens at this moment. What actually happens is
 * the more alarming state: six scripts fire on every edit — formatting,
 * linting, structural scanning, suppression blocking — running, ungoverned,
 * and impossible to declare.
 *
 * They live in the INSTALLED plugin rather than the project checkout, which is
 * why the emitter did not see them. That is a statement about where the
 * emitter was looking, not about whether the fact is knowable: which plugins a
 * project enables is in its own settings file, and which hooks those plugins
 * register is on the machine running the report. "Not where I was looking" and
 * "not derivable" are different answers and the three-state rule means the
 * difference has to be said rather than rendered as absence.
 *
 * Only file names are reported, never the absolute paths they were read from.
 * An absolute path differs per machine and would break the byte-identical
 * property the report is built on.
 * @module cli/gate-report-agent-hooks
 */
import { readFile } from "node:fs/promises";
import { homedir as defaultHomedir } from "node:os";
import * as path from "node:path";

import type { AgentHookEvidence, Finding } from "./gate-report-types.js";

/** The harness events that fire around a single tool call. */
const PRE_TOOL_EVENTS = ["PreToolUse", "PostToolUse"];

/** The tools that write a file, as a matcher spells them. */
const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/** File extensions a hook command's script carries. */
const SCRIPT_SUFFIXES = [".sh", ".mjs", ".js", ".py", ".ts"];

/** Injectable boundaries, so tests never read the real home directory. */
export interface AgentHookDependencies {
  /** Home directory holding the installed marketplaces. */
  readonly homedir?: () => string;
}

/**
 * Parse a JSON file, treating anything unreadable as absent.
 * @param file - Absolute path
 * @returns The parsed value, or undefined
 */
async function readJson(file: string): Promise<unknown> {
  const source = await readFile(file, "utf8").catch(() => undefined);
  if (source === undefined) return undefined;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The plugins the project's settings file switches on.
 * @param projectRoot - Project root
 * @returns Plugin references in `name@marketplace` form, sorted
 */
async function enabledPlugins(projectRoot: string): Promise<string[] | null> {
  const settings = await readJson(
    path.join(projectRoot, ".claude", "settings.json")
  );
  if (settings === null || typeof settings !== "object") return null;
  const enabled: unknown = Reflect.get(settings, "enabledPlugins");
  if (enabled === null || typeof enabled !== "object") return [];
  return Object.entries(enabled)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Where each installed marketplace was unpacked.
 * @param home - Home directory
 * @returns Marketplace name -> install location
 */
async function marketplaceLocations(
  home: string
): Promise<ReadonlyMap<string, string>> {
  const known = await readJson(
    path.join(home, ".claude", "plugins", "known_marketplaces.json")
  );
  if (known === null || typeof known !== "object" || Array.isArray(known)) {
    return new Map();
  }
  return new Map(
    Object.entries(known).flatMap(([name, entry]) => {
      if (entry === null || typeof entry !== "object") return [];
      const location: unknown = Reflect.get(entry, "installLocation");
      return typeof location === "string" && location.length > 0
        ? ([[name, location]] as const)
        : [];
    })
  );
}

/**
 * Whether a matcher selects a tool that writes a file.
 *
 * Compared alternative by alternative rather than by substring, because
 * `TodoWrite` contains `Write` and a substring test therefore reports a hook
 * on the task list as edit-time enforcement. Over-reporting here is not a
 * harmless surplus: the count it feeds is an operator's measure of how much
 * runs that they cannot govern.
 * @param matcher - The matcher as the manifest spells it
 * @returns True when it selects a file-writing tool
 */
export function matchesEditTool(matcher: string): boolean {
  return matcher
    .split("|")
    .map(part => part.trim())
    .some(part => EDIT_TOOLS.has(part));
}

/**
 * The script a hook command runs.
 *
 * A command is not always a bare path — some are a small shell pipeline — so
 * the last path-like token wins and a command with no script falls back to its
 * first word rather than to a slice of shell syntax.
 * @param command - The registered command
 * @returns A short, operator-readable name
 */
export function scriptNameOf(command: string): string {
  const tokens = command.split(/\s+/).filter(token => token.length > 0);
  const scripts = tokens.filter(token =>
    SCRIPT_SUFFIXES.some(suffix => token.endsWith(suffix))
  );
  const chosen = scripts[scripts.length - 1] ?? tokens[0] ?? command;
  return chosen.slice(chosen.lastIndexOf("/") + 1);
}

/**
 * Every command a hook group registers.
 * @param group - One entry of a hook event's array
 * @returns The commands, in declaration order
 */
function commandsOf(group: unknown): string[] {
  if (group === null || typeof group !== "object") return [];
  const hooks: unknown = Reflect.get(group, "hooks");
  if (!Array.isArray(hooks)) return [];
  return hooks.flatMap(hook => {
    if (hook === null || typeof hook !== "object") return [];
    const command: unknown = Reflect.get(hook, "command");
    return typeof command === "string" ? [command] : [];
  });
}

/**
 * The edit-time hooks one plugin manifest registers.
 * @param reference - The plugin as the settings file spells it
 * @param manifest - The parsed plugin manifest
 * @returns Evidence, one entry per registered command
 */
function hooksOfManifest(
  reference: string,
  manifest: unknown
): AgentHookEvidence[] {
  if (manifest === null || typeof manifest !== "object") return [];
  const hooks: unknown = Reflect.get(manifest, "hooks");
  if (hooks === null || typeof hooks !== "object") return [];
  return PRE_TOOL_EVENTS.flatMap(event => {
    const groups: unknown = Reflect.get(hooks, event);
    if (!Array.isArray(groups)) return [];
    return groups.flatMap(group => {
      const matcher: unknown =
        group !== null && typeof group === "object"
          ? Reflect.get(group, "matcher")
          : undefined;
      if (typeof matcher !== "string" || !matchesEditTool(matcher)) return [];
      return commandsOf(group).map(command => ({
        plugin: reference,
        event,
        matcher,
        script: scriptNameOf(command),
      }));
    });
  });
}

/**
 * Read one enabled plugin's manifest from its installed marketplace.
 * @param reference - `name@marketplace`
 * @param locations - Marketplace name -> install location
 * @returns Evidence from that plugin alone
 */
async function hooksOfPlugin(
  reference: string,
  locations: ReadonlyMap<string, string>
): Promise<AgentHookEvidence[]> {
  const separator = reference.lastIndexOf("@");
  if (separator <= 0) return [];
  const name = reference.slice(0, separator);
  const location = locations.get(reference.slice(separator + 1));
  if (location === undefined) return [];
  const manifest = await readJson(
    path.join(location, "plugins", name, ".claude-plugin", "plugin.json")
  );
  return hooksOfManifest(reference, manifest);
}

/**
 * Every edit-time hook proved installed and active for this project.
 *
 * Degrades to `unknown` rather than to an empty list. "No agent hooks run
 * here" and "this run could not see which plugins are installed" are different
 * answers, and only the first of them is a finding.
 * @param projectRoot - Project root
 * @param dependencies - Injectable boundaries
 * @returns The evidence, or an honest unknown
 */
export async function collectAgentHooks(
  projectRoot: string,
  dependencies: AgentHookDependencies = {}
): Promise<Finding<readonly AgentHookEvidence[]>> {
  const enabled = await enabledPlugins(projectRoot);
  if (enabled === null) {
    return {
      state: "unknown",
      reason: "agent-settings-unreadable",
      message:
        "This project's .claude/settings.json could not be read, so which agent hooks are active on every edit is unknown. It is not a claim that none are.",
    };
  }
  const home = (dependencies.homedir ?? defaultHomedir)();
  const locations = await marketplaceLocations(home);
  if (enabled.length > 0 && locations.size === 0) {
    return {
      state: "unknown",
      reason: "installed-plugins-unreadable",
      message:
        "This project enables plugins, but the installed marketplaces on this machine could not be read, so the hooks they register on every edit are unknown.",
    };
  }
  const found = await Promise.all(
    enabled.map(async reference => await hooksOfPlugin(reference, locations))
  );
  const flat = found.flat();
  return { state: "verified", value: [...flat].sort(byPluginThenScript) };
}

/**
 * Order two hooks so the report is stable across machines.
 * @param left - One hook
 * @param right - Another hook
 * @returns A comparison result
 */
function byPluginThenScript(
  left: AgentHookEvidence,
  right: AgentHookEvidence
): number {
  return (
    left.plugin.localeCompare(right.plugin) ||
    left.event.localeCompare(right.event) ||
    left.script.localeCompare(right.script)
  );
}
