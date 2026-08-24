/** Install Lisa MCP servers into project-scoped Codex configuration. */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { ClaudeMcpServerEntry } from "../agy/mcp-installer.js";
import { CONFIG_FILENAME } from "./settings-installer.js";

/**
 * The frozen half of the block markers, plus the version this build writes.
 *
 * The recogniser below matches the FAMILY — the frozen identifier plus any
 * version — rather than one literal string. It used to match the exact text it
 * was about to write, and the failure that produces here is the INVERSE of the
 * usual one and much harder to see.
 *
 * `stripManagedBlock` returned the TOML unchanged when it could not find its
 * start marker, so an orphaned block survived. `hostMcpNames` then read that
 * orphan's server names and classified them as HOST-OWNED, and
 * `applicableEntries` filtered them out of what Lisa writes. So Lisa did not
 * duplicate the servers — it silently stopped managing servers it was
 * managing, because it now believed the host owned them. A tool that doubles
 * up announces itself; one that quietly relinquishes something it used to own
 * does not, because the config still looks plausible and the servers are still
 * listed.
 *
 * Following `core/apply-receipt`, which treats a `schema_version` it does not
 * recognise as NO RECEIPT rather than one it half-understands: on an
 * unrecognised marker, fail toward redoing the work, not toward assuming it is
 * done. Reclaiming an orphan is redoing the work; reading it as the host's is
 * assuming someone else did it.
 *
 * Changing `LISA_MCP_FAMILY` orphans blocks; changing `LISA_MCP_VERSION` does
 * not. That is the whole contract.
 */
const LISA_MCP_FAMILY = "LISA MANAGED MCP SERVERS";

/** Marker version this build writes. Bumping it is safe by construction. */
const LISA_MCP_VERSION = "v2";

/** Stable markers delimiting the Lisa-owned TOML block. */
const LISA_MCP_START = `# >>> ${LISA_MCP_FAMILY} ${LISA_MCP_VERSION} >>>`;
const LISA_MCP_END = `# <<< ${LISA_MCP_FAMILY} ${LISA_MCP_VERSION} <<<`;

/** Recognises a Lisa MCP block opener of any version. */
const LISA_MCP_START_RE = new RegExp(`# >>> ${LISA_MCP_FAMILY}[^\\n]*>>>`);

/** Recognises the matching closer of any version. */
const LISA_MCP_END_RE = new RegExp(`# <<< ${LISA_MCP_FAMILY}[^\\n]*<<<`);

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
  // Every block of the family, not just the first and not just this version's.
  // A config already carrying an orphan from a rename must come out with none,
  // or Lisa keeps reading its own past output as the host's.
  //
  // Recursive rather than a mutating loop: each pass removes one block and
  // hands the remainder back, so the "no blocks left" case is the base case
  // instead of a break.
  const opened = LISA_MCP_START_RE.exec(toml);
  if (opened === null) return toml;
  const rest = toml.slice(opened.index + opened[0].length);
  const closed = LISA_MCP_END_RE.exec(rest);
  if (closed === null) {
    // Malformed stays LOUD. A start without an end is the one shape that
    // cannot be reconciled — reclaiming it would swallow whatever follows,
    // which may be entirely the host's.
    throw new Error(
      `Invalid ${CONFIG_FILENAME}: found ${opened[0]} without closing marker`
    );
  }
  const end = opened.index + opened[0].length + closed.index + closed[0].length;
  const before = toml.slice(0, opened.index).trimEnd();
  const after = toml.slice(end).trimStart();
  return stripManagedBlock(
    [before, after].filter(part => part.length > 0).join("\n\n")
  );
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
