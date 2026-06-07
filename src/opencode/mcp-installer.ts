/**
 * Install Lisa's MCP servers into a host project's `opencode.json` `mcp` key.
 *
 * OpenCode does NOT load plugin-bundled MCP servers — they must be declared in
 * config (the "Wrap" pattern). So `processOpencodeEmit` collects Lisa's servers
 * from the built plugin `.mcp.json` files (base + each detected stack, via the
 * shared `collectLisaMcpServers`) and writes them into the `mcp` object of the
 * project's `opencode.json`, translated to OpenCode's transport shape:
 *
 *   - stdio  → `{ type: "local",  command: [...], environment: {...}, enabled }`
 *     (`command` is a single ARRAY — argv[0] is the binary, the rest are args).
 *   - http   → `{ type: "remote", url: "...", headers: {...}, enabled }`
 *
 * See opencode.ai/docs/mcp-servers and /docs/config.
 *
 * Tagged-merge convention (mirrors `src/agy/mcp-installer.ts`): every Lisa-owned
 * server entry carries `_lisaManaged: true`, so a re-run strips Lisa's previous
 * entries and rewrites them while preserving any host-authored servers verbatim.
 * The edit is surgical (only the `mcp` key is rewritten via `jsonc-parser`), so
 * sibling keys, comments, and formatting elsewhere in `opencode.json` survive.
 * @module opencode/mcp-installer
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  applyEdits,
  modify,
  parse as parseJsonc,
  type ParseError,
} from "jsonc-parser";
import type { ClaudeMcpServerEntry } from "../agy/mcp-installer.js";
import { CONFIG_FILENAME, OPENCODE_SCHEMA_URL } from "./settings-installer.js";

/** Marker field tagged onto every Lisa-owned MCP server entry. */
export const LISA_MANAGED_MARKER = "_lisaManaged" as const;

/** JSONC edit formatting — 2-space indent, matching the repo's JSON style. */
const FORMATTING_OPTIONS = {
  formattingOptions: { tabSize: 2, insertSpaces: true },
} as const;

/** A stdio MCP server in OpenCode's shape (`command` is an argv array). */
export interface OpencodeLocalMcpEntry {
  readonly type: "local";
  readonly command: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  readonly [LISA_MANAGED_MARKER]?: boolean;
}

/** An HTTP MCP server in OpenCode's shape (`url`, not `command`). */
export interface OpencodeRemoteMcpEntry {
  readonly type: "remote";
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly enabled: boolean;
  readonly [LISA_MANAGED_MARKER]?: boolean;
}

/** Any MCP server entry in OpenCode's `mcp` map. */
export type OpencodeMcpServerEntry =
  | OpencodeLocalMcpEntry
  | OpencodeRemoteMcpEntry;

/** Top-level `opencode.json` shape, narrowed to the keys this module touches. */
export interface OpencodeConfigShape {
  readonly mcp?: Readonly<Record<string, OpencodeMcpServerEntry>>;
}

/** Result of the OpenCode MCP install pass. */
export interface OpencodeMcpInstallResult {
  /** Absolute path written. */
  readonly path: string;
  /** Number of Lisa-managed entries written. */
  readonly lisaEntryCount: number;
  /** Number of host-authored entries preserved. */
  readonly hostEntryCount: number;
}

/**
 * Resolve the absolute path to a project's `opencode.json`.
 * @param destDir - Absolute path to the host project root.
 * @returns Absolute path to `<destDir>/opencode.json`.
 */
export function resolveOpencodeConfigPath(destDir: string): string {
  return path.join(destDir, CONFIG_FILENAME);
}

/**
 * Translate a Claude/Codex-shape MCP entry to OpenCode's shape.
 *
 * Rules:
 *   - stdio (`command` present): `type: "local"`, fold `command` + `args` into
 *     a single argv array, rename `env` → `environment`, set `enabled: true`.
 *   - http/sse (`url` present): `type: "remote"`, keep `url` + `headers`, set
 *     `enabled: true`.
 *
 * The `_lisaManaged` marker is attached at write time, not in this pure transform.
 * Throws if the entry has neither `command` nor `url` (un-translatable).
 * @param input - Claude/Codex-format MCP server entry.
 * @returns OpenCode-format MCP server entry.
 */
export function translateMcpEntryToOpencode(
  input: ClaudeMcpServerEntry
): OpencodeMcpServerEntry {
  if (input.command !== undefined) {
    return {
      type: "local",
      command: [input.command, ...(input.args ?? [])],
      ...(input.env !== undefined ? { environment: input.env } : {}),
      enabled: true,
    };
  }
  if (input.url !== undefined) {
    return {
      type: "remote",
      url: input.url,
      ...(input.headers !== undefined ? { headers: input.headers } : {}),
      enabled: true,
    };
  }
  throw new Error(
    "translateMcpEntryToOpencode: entry has neither `command` (stdio) nor `url` (http)"
  );
}

/**
 * Install Lisa's MCP servers into `<destDir>/opencode.json` using tagged-merge.
 *
 * Always call this — even with an empty `lisaMcpServers` — so previously written
 * `_lisaManaged` entries are stripped when a project stops shipping MCP servers.
 * @param lisaMcpServers - Lisa's MCP servers in Claude/Codex shape, keyed by name.
 * @param configPath - Absolute path to the target `opencode.json`.
 * @returns Result with the path written and entry counts.
 */
export async function installOpencodeMcpConfig(
  lisaMcpServers: Readonly<Record<string, ClaudeMcpServerEntry>>,
  configPath: string
): Promise<OpencodeMcpInstallResult> {
  const exists = existsSync(configPath);
  const existingContent = exists ? await readFile(configPath, "utf8") : "";
  const merged = mergeMcpServers(existingContent, lisaMcpServers);

  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, merged.text, "utf8");

  return {
    path: configPath,
    lisaEntryCount: merged.lisaEntryCount,
    hostEntryCount: merged.hostEntryCount,
  };
}

/** Merge outcome: the rewritten document plus Lisa/host entry counts. */
interface McpMergeResult {
  readonly text: string;
  readonly lisaEntryCount: number;
  readonly hostEntryCount: number;
}

/**
 * Merge Lisa's MCP servers into the `mcp` key of an `opencode.json` document.
 * Pure function for testability; `installOpencodeMcpConfig` is the I/O wrapper.
 *
 * Tagged-merge rules:
 *   1. Translate + tag Lisa's entries with `_lisaManaged: true`.
 *   2. Drop every existing entry already tagged `_lisaManaged` (Lisa's prior run).
 *   3. Preserve host-authored entries (untagged) verbatim.
 *   4. Rewrite only the `mcp` key; the rest of the document is untouched.
 *
 * Throws on invalid JSONC so a corrupt host file is surfaced, not overwritten.
 * @param existingJsonc - Current contents of `opencode.json` (or "").
 * @param lisaMcpServers - Lisa's MCP servers in Claude/Codex shape, keyed by name.
 * @returns The merged document text and entry counts.
 */
export function mergeMcpServers(
  existingJsonc: string,
  lisaMcpServers: Readonly<Record<string, ClaudeMcpServerEntry>>
): McpMergeResult {
  const lisaEntries: Record<string, OpencodeMcpServerEntry> =
    Object.fromEntries(
      Object.entries(lisaMcpServers).map(([name, entry]) => [
        name,
        { ...translateMcpEntryToOpencode(entry), [LISA_MANAGED_MARKER]: true },
      ])
    );

  if (existingJsonc.trim().length === 0) {
    const doc = { $schema: OPENCODE_SCHEMA_URL, mcp: lisaEntries };
    return {
      text: `${JSON.stringify(doc, null, 2)}\n`,
      lisaEntryCount: Object.keys(lisaEntries).length,
      hostEntryCount: 0,
    };
  }

  const current = parseJsoncOrThrow(existingJsonc);
  const existingMcp =
    current.mcp !== null &&
    typeof current.mcp === "object" &&
    !Array.isArray(current.mcp)
      ? (current.mcp as Record<string, OpencodeMcpServerEntry>)
      : {};

  const hostEntries: Record<string, OpencodeMcpServerEntry> =
    Object.fromEntries(
      Object.entries(existingMcp).filter(
        ([, entry]) => entry?.[LISA_MANAGED_MARKER] !== true
      )
    );

  const mergedMcp = { ...hostEntries, ...lisaEntries };
  const edits = modify(existingJsonc, ["mcp"], mergedMcp, FORMATTING_OPTIONS);
  const applied = applyEdits(existingJsonc, edits);

  return {
    text: applied.endsWith("\n") ? applied : `${applied}\n`,
    lisaEntryCount: Object.keys(lisaEntries).length,
    hostEntryCount: Object.keys(hostEntries).length,
  };
}

/**
 * Parse JSONC, throwing a descriptive error on the first syntax problem so a
 * corrupt host `opencode.json` is surfaced rather than silently overwritten.
 * @param jsonc - Raw `opencode.json` contents.
 * @returns The parsed object (empty object if the root is a non-object).
 */
function parseJsoncOrThrow(
  jsonc: string
): Record<string, unknown> & { readonly mcp?: unknown } {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(jsonc, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    throw new Error(
      `opencode.json is not valid JSONC (offset ${errors[0]?.offset ?? 0}); ` +
        `refusing to overwrite host config`
    );
  }
  return parsed !== null && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}
