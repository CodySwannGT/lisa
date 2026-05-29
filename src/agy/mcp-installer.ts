/**
 * Install Lisa's MCP server config into agy's user-level mcp_config.json.
 *
 * agy reads MCP server configs from `~/.gemini/config/mcp_config.json` (user
 * scope, shared with Antigravity 2.0 desktop) or `<project>/.agents/mcp_config.json`
 * (project scope). MCP is NOT a plugin component on agy — the file lives
 * outside any plugin and is consumed independently per
 * `wiki/architecture/coding-agent-parity.md` and
 * `reference_agy_plugin_capabilities` memory.
 *
 * Schema differences from Claude/Codex:
 *   - agy uses `serverUrl` for HTTP transport (NOT `url` or `httpUrl`).
 *   - stdio servers use the same `command`/`args`/`env` shape as Claude/Codex.
 *
 * Tagged-merge convention: Lisa-owned entries carry `_lisaManaged: true` at
 * the per-server level so the installer can rewrite Lisa's entries while
 * preserving host-authored entries on re-runs (mirrors the
 * `src/codex/hooks-merger.ts` pattern).
 * @module agy/mcp-installer
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Marker field tagged onto every Lisa-owned MCP server entry. */
export const LISA_MANAGED_MARKER = "_lisaManaged" as const;

/**
 * Where agy reads user-scope MCP config (shared with Antigravity desktop).
 * @returns Absolute path to `~/.gemini/config/mcp_config.json`.
 */
export function defaultUserMcpConfigPath(): string {
  return path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
}

/**
 * Where agy reads project-scope MCP config (per-workspace override).
 * @param destDir - Absolute path to the host project root.
 * @returns Absolute path to `<destDir>/.agents/mcp_config.json`.
 */
export function defaultProjectMcpConfigPath(destDir: string): string {
  return path.join(destDir, ".agents", "mcp_config.json");
}

/** MCP config scope: per-project workspace file or the shared user file. */
export type AgyMcpScope = "project" | "user";

/**
 * Resolve the agy MCP config path for a given scope.
 *
 * `lisa apply` operates on a single project, so the default scope is
 * `"project"` — it writes `<destDir>/.agents/mcp_config.json` rather than
 * polluting the user's global `~/.gemini/config/mcp_config.json` (shared with
 * the Antigravity desktop app). Pass `scope: "user"` to target the shared file.
 * @param opts - Scope selector and (for project scope) the host project root.
 * @param opts.scope - `"project"` (default) or `"user"`.
 * @param opts.destDir - Host project root; required for project scope.
 * @returns Absolute path to the mcp_config.json for the requested scope.
 */
export function resolveAgyMcpConfigPath(opts: {
  readonly scope?: AgyMcpScope;
  readonly destDir?: string;
}): string {
  const scope = opts.scope ?? "project";
  if (scope === "user") return defaultUserMcpConfigPath();
  if (opts.destDir === undefined || opts.destDir === "") {
    throw new Error(
      "resolveAgyMcpConfigPath: project scope requires a destDir (host project root)"
    );
  }
  return defaultProjectMcpConfigPath(opts.destDir);
}

/** A single MCP server entry in agy's mcp_config.json schema. */
export interface AgyMcpServerEntry {
  /** stdio: command to launch. Mutually exclusive with serverUrl. */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** HTTP transport: agy-specific key (NOT `url`). */
  readonly serverUrl?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Lisa ownership marker; only present on Lisa-managed entries. */
  readonly [LISA_MANAGED_MARKER]?: boolean;
}

/** Top-level mcp_config.json shape. */
export interface AgyMcpConfig {
  readonly mcpServers?: Readonly<Record<string, AgyMcpServerEntry>>;
}

/** Input MCP server entry in Claude/Codex shape, before agy translation. */
export interface ClaudeMcpServerEntry {
  /** stdio command. */
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  /** Claude/Codex HTTP shape: `{type:"http", url:"..."}`. */
  readonly type?: "stdio" | "http" | "sse";
  readonly url?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Translate a Claude/Codex-shape MCP entry to agy's shape.
 *
 * Rules:
 *   - stdio entries: pass through `command`/`args`/`env` unchanged.
 *   - http entries: rename `url` → `serverUrl`, drop the `type` field, keep
 *     `headers` if present.
 *   - sse entries: agy SSE support is unverified at the schema level; pass
 *     through `serverUrl` and headers for parity with HTTP. Caller should
 *     verify before relying on SSE on agy.
 *
 * The Lisa-managed marker is attached at write time, not in this pure transform.
 * @param input Claude/Codex-format MCP server entry.
 * @returns agy-format MCP server entry.
 */
export function translateMcpEntryToAgy(
  input: ClaudeMcpServerEntry
): AgyMcpServerEntry {
  if (input.command !== undefined) {
    return {
      command: input.command,
      ...(input.args !== undefined ? { args: input.args } : {}),
      ...(input.env !== undefined ? { env: input.env } : {}),
    };
  }
  if (input.url !== undefined) {
    return {
      serverUrl: input.url,
      ...(input.headers !== undefined ? { headers: input.headers } : {}),
    };
  }
  // Empty / unknown shape — return as-is minus the type field.
  return {};
}

/** Result of the agy MCP install pass. */
export interface AgyMcpInstallResult {
  /** Absolute path written. */
  readonly path: string;
  /** Number of Lisa-managed entries written. */
  readonly lisaEntryCount: number;
  /** Number of host-authored entries preserved. */
  readonly hostEntryCount: number;
}

/**
 * Read the existing mcp_config.json file (or empty when absent).
 * @param filePath - Absolute path to the config file.
 * @returns Parsed object or {} when the file is missing.
 */
async function readExistingConfig(filePath: string): Promise<AgyMcpConfig> {
  if (!existsSync(filePath)) return {};
  try {
    const raw = await readFile(filePath, "utf8");
    if (raw.trim() === "") return {};
    return JSON.parse(raw) as AgyMcpConfig;
  } catch {
    return {};
  }
}

/**
 * Install Lisa's MCP servers into agy's mcp_config.json using tagged-merge.
 *
 * Tagged-merge rules:
 *   1. Read existing mcpServers (if any).
 *   2. Strip every entry where `_lisaManaged === true`.
 *   3. Add Lisa's entries with `_lisaManaged: true` attached.
 *   4. Host entries (no marker) are preserved verbatim.
 *
 * The target path defaults to `~/.gemini/config/mcp_config.json`. Pass
 * `targetPath` to override (e.g. for the project-level `.agents/mcp_config.json`).
 * @param lisaMcpServers - Lisa's MCP servers in Claude/Codex shape, keyed by
 *   server name.
 * @param targetPath - Absolute path to the mcp_config.json file. Defaults to
 *   the user-level path.
 * @returns Result with the path written and entry counts.
 */
export async function installAgyMcpConfig(
  lisaMcpServers: Readonly<Record<string, ClaudeMcpServerEntry>>,
  targetPath: string = defaultUserMcpConfigPath()
): Promise<AgyMcpInstallResult> {
  await mkdir(path.dirname(targetPath), { recursive: true });

  const existing = await readExistingConfig(targetPath);
  const existingServers = existing.mcpServers ?? {};

  // Strip Lisa-managed entries from the existing config (immutable filter).
  const hostEntries: Readonly<Record<string, AgyMcpServerEntry>> =
    Object.fromEntries(
      Object.entries(existingServers).filter(
        ([, entry]) => entry?.[LISA_MANAGED_MARKER] !== true
      )
    );

  // Translate Lisa's entries and tag them (immutable map).
  const lisaEntries: Readonly<Record<string, AgyMcpServerEntry>> =
    Object.fromEntries(
      Object.entries(lisaMcpServers).map(([name, claudeEntry]) => [
        name,
        {
          ...translateMcpEntryToAgy(claudeEntry),
          [LISA_MANAGED_MARKER]: true,
        },
      ])
    );

  const merged: AgyMcpConfig = {
    ...existing,
    mcpServers: { ...hostEntries, ...lisaEntries },
  };

  await writeFile(targetPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  return {
    path: targetPath,
    lisaEntryCount: Object.keys(lisaEntries).length,
    hostEntryCount: Object.keys(hostEntries).length,
  };
}
