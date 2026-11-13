/** Bounded actual plugin-installation inspection for deterministic health. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns -- typed plugin readers are self-describing */
import { execFile } from "node:child_process";
import path from "node:path";

import {
  DEFAULT_HARNESS,
  harnessIncludesAgent,
  type Harness,
  type ProjectType,
} from "../core/config.js";
import { selectProjectLisaPluginsFromState } from "../core/lisa-plugin-selection.js";
import { PLUGIN_LIST_MAX_CAPTURE_BYTES } from "../core/plugin-command.js";
import { getPackageVersion } from "../cli/version.js";
import { readProjectJsonObject, readProjectText } from "./read-only-fs.js";

// `claude plugin list --json` lists every project-scope registration on the
// machine, so a long-lived workstation's list runs to thousands of entries and
// megabytes (measured: 3,338 entries, 1.6 MB). Lower caps made this reader
// fail there, and every plugin check silently reported "unavailable" on the
// machines it exists for (#4504). Share the apply path's capture cap (#4645)
// and bound entries by what that many bytes can hold.
const MAX_PLUGIN_OUTPUT_BYTES = PLUGIN_LIST_MAX_CAPTURE_BYTES;
const MAX_INSTALLED_PLUGINS = 200_000;
const PLUGIN_TIMEOUT_MS = 15_000;

/**
 * Injectable fixed-argv reader for actual project plugin installation.
 * Implementations must honor `signal` and release any owned handles before
 * settling.
 */
export type InstalledPluginReader = (
  projectRoot: string,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<readonly string[]>;

/** Structured plugin inspection outcome. */
export type PluginInspection =
  | { readonly status: "pass"; readonly drift: readonly string[] }
  | { readonly status: "warn"; readonly drift: readonly string[] }
  | { readonly status: "fail"; readonly drift: readonly string[] };

/**
 * Default fixed-argv Claude installed-plugin reader.
 * @param projectRoot
 * @param timeoutMs
 * @param signal
 */
export const readInstalledClaudePlugins: InstalledPluginReader = async (
  projectRoot,
  timeoutMs,
  signal
) =>
  new Promise((resolve, reject) => {
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed Claude executable
      "claude",
      ["plugin", "list", "--json"],
      {
        cwd: projectRoot,
        encoding: "utf8",
        maxBuffer: MAX_PLUGIN_OUTPUT_BYTES,
        signal,
        killSignal: "SIGKILL",
        timeout: Math.max(1, Math.min(timeoutMs, PLUGIN_TIMEOUT_MS)),
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as unknown;
          if (!Array.isArray(parsed) || parsed.length > MAX_INSTALLED_PLUGINS) {
            throw new Error("Installed plugin response exceeded its contract");
          }
          const ids = parsed.flatMap(entry => {
            if (entry === null || typeof entry !== "object") return [];
            const id = Reflect.get(entry, "id");
            const projectPath = Reflect.get(entry, "projectPath");
            return typeof id === "string" && projectPath === projectRoot
              ? [id]
              : [];
          });
          resolve(
            [...new Set(ids)].sort((left, right) => left.localeCompare(right))
          );
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });

/**
 * Resolve configured harness without accepting invalid strings.
 * @param config
 */
export function configuredHarness(
  config: Readonly<Record<string, unknown>>
): Harness | undefined {
  const harness = config.harness ?? DEFAULT_HARNESS;
  return typeof harness === "string" &&
    [
      "claude",
      "codex",
      "cursor",
      "agy",
      "copilot",
      "opencode",
      "devin",
      "fleet",
    ].includes(harness)
    ? (harness as Harness)
    : undefined;
}

/**
 * Inspect settings, marker, and actual installed plugin state.
 * @param projectRoot - Canonical host root
 * @param config - Safe project config
 * @param types - Safely detected project types
 * @param reader - Actual installed-plugin reader
 * @param timeoutMs - Remaining shared deadline
 * @param signal - Shared cancellation signal
 * @returns Pass, fail, or optional-harness warning
 */
export async function inspectPlugins(
  projectRoot: string,
  config: Readonly<Record<string, unknown>>,
  types: readonly ProjectType[],
  reader: InstalledPluginReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<PluginInspection> {
  const harness = configuredHarness(config);
  if (harness === undefined || !harnessIncludesAgent(harness, "claude")) {
    return { status: "warn", drift: ["unsupported harness"] };
  }
  const settings = await readProjectJsonObject(
    projectRoot,
    path.join(".claude", "settings.json")
  );
  if (settings === undefined) {
    return { status: "fail", drift: [".claude/settings.json"] };
  }
  const enabled = settings.enabledPlugins;
  if (
    enabled === null ||
    typeof enabled !== "object" ||
    Array.isArray(enabled)
  ) {
    return { status: "fail", drift: ["plugin settings"] };
  }
  const expected = [...selectProjectLisaPluginsFromState(config, types)]
    .map(plugin => `${plugin}@lisa`)
    .sort((left, right) => left.localeCompare(right));
  const settingsDrift = expected.filter(
    plugin => Reflect.get(enabled, plugin) !== true
  );
  const marker = await readProjectText(
    projectRoot,
    path.join(".claude", ".lisa-plugins-synced")
  );
  const drift = [
    ...settingsDrift,
    ...(marker?.trim() === getPackageVersion()
      ? []
      : ["plugin version marker"]),
  ];
  if (drift.length > 0) return { status: "fail", drift };
  const installed = await reader(projectRoot, timeoutMs, signal).catch(
    () => undefined
  );
  if (installed === undefined) {
    return {
      status: "warn",
      drift: ["actual plugin installation unavailable"],
    };
  }
  const installedSet = new Set(installed);
  const missing = expected.filter(plugin => !installedSet.has(plugin));
  return missing.length === 0
    ? { status: "pass", drift: [] }
    : { status: "fail", drift: missing };
}
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns -- restore repository documentation defaults */
