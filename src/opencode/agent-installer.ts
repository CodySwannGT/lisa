/**
 * Install Lisa-bundled agents into a host project's `.opencode/agents/`.
 *
 * Pipeline per agent:
 *   1. Read the source `.md` from the Lisa plugin (discovered via the shared
 *      `discoverLisaAgents` walker, identical to the Codex overlay).
 *   2. Transform Markdown + YAML frontmatter → OpenCode subagent Markdown
 *      (frontmatter `description` + `mode: subagent`; body is the prompt). This
 *      is a near-passthrough — OpenCode agents are Markdown like Claude's, so it
 *      is simpler than the Codex TOML transform.
 *   3. Write the result to `.opencode/agents/lisa-<id>.md`.
 *
 * The `lisa-` filename prefix is the ownership boundary: OpenCode derives an
 * agent's name from its filename and reads `.opencode/agents/` flat (verified on
 * opencode 1.16.2 — `opencode agent list` surfaces files placed there), so a
 * prefix — rather than a `lisa/` subdir as used for skills — is what keeps Lisa
 * agents from colliding with host-authored agents and gives stale cleanup a safe
 * scope. Host agents (any file NOT starting with `lisa-`) are never touched.
 *
 * Stale agents (in the previous manifest but no longer shipped by Lisa) are
 * deleted so renames in the source tree don't leave orphans behind.
 * @module opencode/agent-installer
 */
import * as fse from "fs-extra";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  type AgentSource,
  discoverLisaAgents,
} from "../codex/agent-installer.js";
import { isHarnessVariantPlugin } from "../core/lisa-skill-sources.js";
import { transformAgentMarkdownToOpencode } from "./agent-transformer.js";
import { OPENCODE_CONFIG_DIR } from "./manifest.js";

export {
  type AgentSource,
  discoverLisaAgents,
} from "../codex/agent-installer.js";

/** Subdirectory inside `.opencode/` where Lisa-owned agents live */
export const LISA_AGENTS_SUBDIR = "agents";

/**
 * Filename prefix marking an agent file as Lisa-owned. OpenCode reads
 * `.opencode/agents/` flat, so the prefix (not a subdirectory) is the ownership
 * boundary used for collision avoidance and stale cleanup.
 */
export const LISA_AGENT_FILE_PREFIX = "lisa-";

/** Result of installing one agent */
export interface InstalledAgent {
  /** Agent id (source filename basename, without the `lisa-` prefix) */
  readonly id: string;
  /** Path written, relative to the destination project's `.opencode/` directory */
  readonly relativePath: string;
}

/** Aggregated result of an install pass */
export interface AgentInstallResult {
  readonly installed: readonly InstalledAgent[];
  /** Stale agent files deleted from `.opencode/agents/` (relative to `.opencode/`) */
  readonly deleted: readonly string[];
  /** Files written, relative to `.opencode/`. Used to update the manifest. */
  readonly managedFiles: readonly string[];
}

/**
 * Install all discovered agents into `<destDir>/.opencode/agents/`.
 *
 * Returns a result describing what was written and what stale files were
 * deleted, so the caller can update the Lisa-managed manifest.
 * @param sources - Agent sources from discoverLisaAgents
 * @param destDir - Absolute path to the destination project root
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.opencode/`); used to detect stale agents to delete
 * @returns Result describing installed/deleted/managedFiles
 */
export async function installAgents(
  sources: readonly AgentSource[],
  destDir: string,
  previousManagedFiles: readonly string[]
): Promise<AgentInstallResult> {
  const agentsDir = path.join(destDir, OPENCODE_CONFIG_DIR, LISA_AGENTS_SUBDIR);
  await fse.ensureDir(agentsDir);

  const installed: readonly InstalledAgent[] = await Promise.all(
    sources.map(source => installSingleAgent(source, agentsDir))
  );
  const managedFiles: readonly string[] = installed.map(
    agent => agent.relativePath
  );

  const deleted = await deleteStaleAgents(
    previousManagedFiles,
    managedFiles,
    destDir
  );

  return {
    installed: Object.freeze(installed),
    deleted: Object.freeze(deleted),
    managedFiles: Object.freeze(managedFiles),
  };
}

/**
 * Transform + write a single agent file.
 * @param source - Discovered agent source (id, plugin, source path)
 * @param agentsDir - Absolute path to `.opencode/agents/` in the host project
 * @returns Result describing the installed file
 */
async function installSingleAgent(
  source: AgentSource,
  agentsDir: string
): Promise<InstalledAgent> {
  const sourceContent = await readFile(source.sourcePath, "utf8");
  const markdown = transformAgentMarkdownToOpencode(sourceContent);
  const filename = `${LISA_AGENT_FILE_PREFIX}${source.id}.md`;
  await writeFile(path.join(agentsDir, filename), markdown, "utf8");
  return {
    id: source.id,
    relativePath: path.join(LISA_AGENTS_SUBDIR, filename),
  };
}

/**
 * Delete files that were Lisa-managed last run but aren't shipped this run.
 * Only deletes files inside `.opencode/agents/` whose basename carries the
 * `lisa-` prefix, so host-authored agents are never removed even if the
 * previous manifest somehow references them.
 * @param previousManagedFiles - Files Lisa managed on the previous run
 *   (relative to `.opencode/`)
 * @param currentManagedFiles - Files Lisa is shipping this run (relative
 *   to `.opencode/`)
 * @param destDir - Absolute path to the host project root
 * @returns The list of relative paths that were deleted
 */
async function deleteStaleAgents(
  previousManagedFiles: readonly string[],
  currentManagedFiles: readonly string[],
  destDir: string
): Promise<readonly string[]> {
  const currentSet = new Set(currentManagedFiles);
  const lisaAgentPrefix = `${LISA_AGENTS_SUBDIR}${path.sep}${LISA_AGENT_FILE_PREFIX}`;
  const stale = previousManagedFiles.filter(
    file => !currentSet.has(file) && file.startsWith(lisaAgentPrefix)
  );
  await Promise.all(
    stale.map(async file => {
      const absPath = path.join(destDir, OPENCODE_CONFIG_DIR, file);
      if (await fse.pathExists(absPath)) {
        await unlink(absPath);
      }
    })
  );
  return Object.freeze(stale);
}

/**
 * Convenience one-shot: discover Lisa agents from `lisaDir` and install them.
 *
 * Discovery is restricted to canonical plugins — the per-harness fanout variants
 * (`*-agy`, `*-copilot`, `*-cursor`) are skipped. The copilot variants rename
 * agents to `*.agent.md`, which would otherwise slip past id-dedup and ship a
 * duplicate `lisa-<name>.agent` for every agent; the cursor/agy variants are
 * just reformatted copies of the base agents.
 * @param lisaDir - Absolute path to the Lisa repo / installed package
 * @param destDir - Absolute path to the destination project root
 * @param previousManagedFiles - Files Lisa managed on the previous run
 * @returns Result describing installed/deleted/managedFiles
 */
export async function discoverAndInstallAgents(
  lisaDir: string,
  destDir: string,
  previousManagedFiles: readonly string[]
): Promise<AgentInstallResult> {
  const sources = await discoverLisaAgents(
    lisaDir,
    name => !isHarnessVariantPlugin(name)
  );
  return installAgents(sources, destDir, previousManagedFiles);
}
