/** Install Lisa MCP servers into project-scoped Codex configuration. */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { ClaudeMcpServerEntry } from "../agy/mcp-installer.js";
import { CONFIG_FILENAME } from "./settings-installer.js";

/** Stable markers delimiting the Lisa-owned TOML block. */
const LISA_MCP_START = "# >>> LISA MANAGED MCP SERVERS >>>";
const LISA_MCP_END = "# <<< LISA MANAGED MCP SERVERS <<<";

/** Result of one project MCP reconciliation. */
export interface CodexMcpInstallResult {
  readonly managedFiles: readonly string[];
  readonly serverCount: number;
}

/**
 * Remove the previous Lisa-managed MCP block from TOML source.
 * @param toml Existing Codex TOML.
 * @returns TOML without Lisa's marked block.
 */
function stripManagedBlock(toml: string): string {
  const start = toml.indexOf(LISA_MCP_START);
  if (start === -1) return toml;
  const endMarker = toml.indexOf(LISA_MCP_END, start);
  if (endMarker === -1) {
    throw new Error(
      `Invalid ${CONFIG_FILENAME}: found ${LISA_MCP_START} without closing marker`
    );
  }
  const end = endMarker + LISA_MCP_END.length;
  const before = toml.slice(0, start).trimEnd();
  const after = toml.slice(end).trimStart();
  return [before, after].filter(part => part.length > 0).join("\n\n");
}

/**
 * Escape a string as a TOML basic string.
 * @param value Raw string value.
 * @returns TOML string literal.
 */
function tomlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Render a string map as a TOML inline table.
 * @param values String map.
 * @returns TOML inline table.
 */
function renderStringMap(values: Readonly<Record<string, string>>): string {
  return `{ ${Object.entries(values)
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
    .join(", ")} }`;
}

/**
 * Render one Claude/Codex-shape MCP entry as a Codex TOML table.
 * @param name MCP server name.
 * @param entry Server definition.
 * @returns Codex TOML table.
 */
function renderServer(name: string, entry: ClaudeMcpServerEntry): string {
  const header = `[mcp_servers.${tomlString(name)}]`;
  if (entry.command !== undefined) {
    return [
      header,
      `command = ${tomlString(entry.command)}`,
      ...(entry.args !== undefined
        ? [`args = [${entry.args.map(tomlString).join(", ")}]`]
        : []),
      ...(entry.env !== undefined
        ? [`env = ${renderStringMap(entry.env)}`]
        : []),
    ].join("\n");
  }
  if (entry.url !== undefined) {
    return [
      header,
      `url = ${tomlString(entry.url)}`,
      ...(entry.headers !== undefined
        ? [`http_headers = ${renderStringMap(entry.headers)}`]
        : []),
    ].join("\n");
  }
  throw new Error(`MCP server ${name} has neither command nor url`);
}

/**
 * Read host-owned MCP names from TOML with Lisa's old block removed.
 * @param toml Host-owned TOML.
 * @returns Existing host MCP names.
 */
function hostMcpNames(toml: string): ReadonlySet<string> {
  if (toml.trim().length === 0) return new Set();
  const parsed = parseToml(toml) as Record<string, unknown>;
  const servers = parsed.mcp_servers;
  return servers !== null && typeof servers === "object"
    ? new Set(Object.keys(servers as Record<string, unknown>))
    : new Set();
}

/**
 * Reconcile the marked Lisa MCP block while preserving host TOML verbatim.
 * Host-authored servers win on a name collision.
 * @param existingToml Existing project Codex configuration.
 * @param lisaServers Selected Lisa MCP servers.
 * @returns Merged TOML with one trailing newline.
 */
export function mergeCodexMcpServers(
  existingToml: string,
  lisaServers: Readonly<Record<string, ClaudeMcpServerEntry>>
): string {
  const hostToml = stripManagedBlock(existingToml);
  const hostNames = hostMcpNames(hostToml);
  const applicableEntries = Object.entries(lisaServers).filter(
    ([name]) => !hostNames.has(name)
  );
  const block =
    applicableEntries.length === 0
      ? ""
      : [
          LISA_MCP_START,
          ...applicableEntries.flatMap(([name, entry], index) => [
            ...(index > 0 ? [""] : []),
            renderServer(name, entry),
          ]),
          LISA_MCP_END,
        ].join("\n");
  const merged = [hostToml.trimEnd(), block]
    .filter(part => part.length > 0)
    .join("\n\n");
  return `${merged}\n`;
}

/**
 * Install selected Lisa MCP servers into `<project>/.codex/config.toml`.
 * @param destDir Host project root.
 * @param lisaServers Selected Lisa MCP servers.
 * @returns Managed file and server counts.
 */
export async function installCodexMcpConfig(
  destDir: string,
  lisaServers: Readonly<Record<string, ClaudeMcpServerEntry>>
): Promise<CodexMcpInstallResult> {
  const configPath = path.join(destDir, ".codex", CONFIG_FILENAME);
  await fse.ensureDir(path.dirname(configPath));
  const existing = (await fse.pathExists(configPath))
    ? await readFile(configPath, "utf8")
    : "";
  await writeFile(
    configPath,
    mergeCodexMcpServers(existing, lisaServers),
    "utf8"
  );
  return {
    managedFiles: Object.freeze([CONFIG_FILENAME]),
    serverCount: Object.keys(lisaServers).length,
  };
}
