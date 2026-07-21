/**
 * Default harness-scheduler seams for the Automations live-status probe.
 *
 * Loads the shared Codex/Claude automation-status adapters dynamically so the
 * TypeScript build root stays under `src/` while reusing the plugin scripts.
 * @module cli/ui-automations-adapters
 */
import { existsSync, constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { JsonObject } from "../sync/json-path.js";
import { readConfinedMergedConfig } from "./ui-confined-project-read.js";
import type {
  AutomationProjectIdentity,
  ClaudeAutomationLister,
  ClaudeScheduleListingReader,
  CodexAutomationLister,
  CodexDirReadableCheck,
  HarnessAutomationObservation,
  ProjectIdentityResolver,
} from "./ui-automations.js";

const execFileAsync = promisify(execFile);

/**
 * Walk parents until a package-root-relative file exists.
 * @param startDir - Directory to start searching from
 * @param relativePath - Path under the package root
 * @returns Absolute path
 */
function findPackageFileWalk(startDir: string, relativePath: string): string {
  const candidate = path.join(startDir, relativePath);
  if (existsSync(candidate)) {
    return candidate;
  }
  const parent = path.dirname(startDir);
  if (parent === startDir) {
    throw new Error(`Unable to locate ${relativePath}`);
  }
  return findPackageFileWalk(parent, relativePath);
}

/**
 * Resolve a script under `plugins/src/base/scripts/` from src or dist.
 * @param scriptName - File name inside the scripts directory
 * @returns Absolute path to the script
 */
function resolveAutomationStatusScript(scriptName: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const relative = path.join("plugins", "src", "base", "scripts", scriptName);
  const fromPackageRoot = path.join(moduleDir, "..", "..", relative);
  if (existsSync(fromPackageRoot)) {
    return fromPackageRoot;
  }
  return findPackageFileWalk(moduleDir, relative);
}

/**
 * Default Codex automations directory (`$CODEX_HOME/automations` or `~/.codex/automations`).
 * @returns Absolute directory path
 */
export function resolveDefaultCodexAutomationsDir(): string {
  // eslint-disable-next-line no-restricted-syntax -- harness path follows Codex's CODEX_HOME contract
  const codexHome = process.env.CODEX_HOME;
  return path.join(
    codexHome ?? path.join(os.homedir(), ".codex"),
    "automations"
  );
}

/**
 * Dynamically load a shared automation-status adapter module.
 * @param scriptName - Adapter filename
 * @returns Imported module
 */
async function loadAdapterModule<T>(scriptName: string): Promise<T> {
  const scriptPath = resolveAutomationStatusScript(scriptName);
  return import(pathToFileURL(scriptPath).href) as Promise<T>;
}

/** Minimal expected-fleet entry consumed by setup readiness. */
export interface ExpectedAutomationEntry {
  readonly id: string;
  readonly automationId: string;
}

/**
 * Resolve applicable automations through setup-automations' shared contract.
 * @param config - Current merged Lisa config
 * @param detectedTypes - Authoritatively detected project types
 * @param gitRemoteUrl - Optional origin fallback for repository identity
 * @returns Applicable expected entries; unsupported loops are excluded
 */
export async function resolveExpectedAutomationEntries(
  config: JsonObject,
  detectedTypes: readonly string[],
  gitRemoteUrl?: string
): Promise<readonly ExpectedAutomationEntry[]> {
  const { resolveExpectedAutomationFleet } = await loadAdapterModule<{
    resolveExpectedAutomationFleet: (input: {
      readonly config: JsonObject;
      readonly detectedTypes: readonly string[];
      readonly gitRemoteUrl?: string;
    }) => { readonly expected: readonly ExpectedAutomationEntry[] };
  }>("automation-status-expected-fleet.mjs");
  return resolveExpectedAutomationFleet({
    config,
    detectedTypes,
    ...(gitRemoteUrl === undefined ? {} : { gitRemoteUrl }),
  }).expected;
}

/**
 * Read merged Lisa config for identity resolution.
 * @param cwd - Project root
 * @returns Merged config object
 */
async function readMergedConfig(cwd: string): Promise<JsonObject> {
  return await readConfinedMergedConfig(cwd);
}

/**
 * Read the origin remote URL via git without a shell.
 * @param cwd - Project root
 * @param signal - Abort signal
 * @returns Origin URL, or undefined when unavailable
 */
export async function readOriginRemote(
  cwd: string,
  signal: AbortSignal
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "remote", "get-url", "origin"],
      { cwd, signal, timeout: 2_500, encoding: "utf8" }
    );
    const remote = stdout.trim();
    return remote.length > 0 ? remote : undefined;
  } catch {
    return undefined;
  }
}

/** Raw adapter fields normalized by {@link toObservation}. */
export interface AdapterObservationInput {
  readonly automationId: string;
  readonly observedCadence?: string;
  readonly status?: string;
  readonly lastRunAt?: string | null;
}

/**
 * Normalize adapter observations into the probe's observation shape.
 * @param entry - Adapter observation fields
 * @returns Probe observation without invented cadence/status
 */
export function toObservation(
  entry: AdapterObservationInput
): HarnessAutomationObservation {
  return {
    automationId: entry.automationId,
    lastRunAt: entry.lastRunAt ?? null,
    ...(typeof entry.observedCadence === "string"
      ? { observedCadence: entry.observedCadence }
      : {}),
    ...(typeof entry.status === "string" ? { status: entry.status } : {}),
  };
}

/**
 * Default identity resolver: config + origin remote → `lisa-auto-<project>-`.
 * @param cwd - Project root
 * @param signal - Abort signal
 * @returns Automation project identity
 */
export const defaultResolveIdentity: ProjectIdentityResolver = async (
  cwd,
  signal
) => {
  const { resolveAutomationProjectIdentity } = await loadAdapterModule<{
    resolveAutomationProjectIdentity: (input: {
      readonly config?: Record<string, unknown>;
      readonly gitRemoteUrl?: string;
    }) => AutomationProjectIdentity;
  }>("automation-status-expected-fleet.mjs");
  const config = await readMergedConfig(cwd);
  const gitRemoteUrl = await readOriginRemote(cwd, signal);
  return resolveAutomationProjectIdentity(
    gitRemoteUrl === undefined ? { config } : { config, gitRemoteUrl }
  );
};

/**
 * Default Codex directory readability check.
 * @param automationsDir - Directory to probe
 * @param signal - Probe cancellation signal
 * @returns Whether the directory is readable
 */
export const defaultCodexDirReadable: CodexDirReadableCheck = async (
  automationsDir,
  signal
) => {
  signal.throwIfAborted();
  try {
    await access(automationsDir, fsConstants.R_OK);
    signal.throwIfAborted();
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
};

/**
 * Default Claude `/schedule` reader — Node cannot invoke the interactive
 * `/schedule` surface, so the default is honest unavailability.
 * @returns Always null
 */
export const defaultReadClaudeScheduleListing: ClaudeScheduleListingReader =
  async () => null;

/**
 * Default Codex lister via the shared automation-status adapter.
 * @param input - Prefix and optional directory override
 * @returns Observed Codex automations
 */
export const defaultListCodexAutomations: CodexAutomationLister =
  async input => {
    const { listCodexAutomations } = await loadAdapterModule<{
      listCodexAutomations: CodexAutomationLister;
    }>("automation-status-codex-adapter.mjs");
    const observed = await listCodexAutomations(input);
    return observed.map(toObservation);
  };

/**
 * Load the default Claude lister from the shared adapter.
 * @returns Claude automation lister
 */
export async function loadDefaultListClaudeAutomations(): Promise<ClaudeAutomationLister> {
  const { listClaudeAutomations } = await loadAdapterModule<{
    listClaudeAutomations: ClaudeAutomationLister;
  }>("automation-status-claude-adapter.mjs");
  return ({ scheduleListing, automationPrefix }) =>
    listClaudeAutomations({ scheduleListing, automationPrefix }).map(
      toObservation
    );
}
