/**
 * Manage Lisa-required settings in `.codex/config.toml`.
 *
 * Codex configuration is TOML, layered system → user → project; Lisa writes
 * only the project-level file (`<destDir>/.codex/config.toml`). The merge
 * preserves any host-authored keys, comments, blank lines, and key ordering
 * by using `@decimalturn/toml-patch` — the only Node TOML library that
 * round-trips comments correctly (verified during round-3 research).
 *
 * Lisa-managed keys (currently a small set; expand as needs arise):
 *   - `project_doc_max_bytes`: bumped to 65536 so AGENTS.md content beyond
 *     Codex's 32 KiB default isn't truncated.
 *   - `[features].codex_hooks`: enabled so Lisa lifecycle checks actually run.
 * @module codex/settings-installer
 */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  parse as parseToml,
  patch as patchToml,
} from "@decimalturn/toml-patch";

/** Filename of the Codex config file inside `.codex/` */
export const CONFIG_FILENAME = "config.toml";

/**
 * Lisa-required settings to merge into `.codex/config.toml`. Host wins on
 * conflict for any key NOT in this list; for these keys, Lisa wins.
 *
 * Why these specific keys:
 * - `project_doc_max_bytes`: Codex truncates AGENTS.md / project doc walks
 *   at 32 KiB by default; Lisa's bundled rules can exceed that, so bump to
 *   64 KiB. Hosts can override upward if they need more headroom.
 */
export const LISA_REQUIRED_SETTINGS: Readonly<Record<string, unknown>> = {
  project_doc_max_bytes: 65536,
};

/** Lisa-required feature flags under `[features]` */
export const LISA_REQUIRED_FEATURES: Readonly<Record<string, boolean>> = {
  codex_hooks: true,
};

/** Result of a settings install pass */
export interface SettingsInstallResult {
  /** Files written, relative to `.codex/`. Used to update the manifest. */
  readonly managedFiles: readonly string[];
  /** Whether the config file was newly created (vs. patched in place) */
  readonly created: boolean;
}

/**
 * Install or update Lisa's required settings in `.codex/config.toml`.
 *
 * Uses `patch` semantics: only keys that differ are written; everything else
 * (comments, blank lines, key order, host-authored keys) is preserved
 * byte-for-byte.
 * @param destDir - Absolute path to the host project root
 * @returns Result describing what was written
 */
export async function installSettings(
  destDir: string
): Promise<SettingsInstallResult> {
  const codexDir = path.join(destDir, ".codex");
  await fse.ensureDir(codexDir);
  const configPath = path.join(codexDir, CONFIG_FILENAME);
  const exists = await fse.pathExists(configPath);
  const existingContent = exists ? await readFile(configPath, "utf8") : "";

  const merged = mergeSettings(existingContent);
  await writeFile(configPath, merged, "utf8");

  return {
    managedFiles: Object.freeze([CONFIG_FILENAME]),
    created: !exists,
  };
}

/**
 * Merge Lisa-required settings into a TOML document. Pure function for
 * testability; the installer above is the I/O wrapper.
 *
 * If the existing content is empty, we synthesize a minimal TOML document
 * containing only Lisa's required keys.
 *
 * Subtle TOML correctness note: `toml-patch.patch()` appends new root-level
 * keys at the end of the document, which in TOML semantically attaches them
 * to the last `[section]` header — a bug for our use case. To work around
 * this, root keys that aren't already present are PREPENDED above the first
 * section header instead of going through `patch()`. Existing keys that
 * differ in value are still patched in place, preserving surrounding
 * comments and key order.
 * @param existingToml - Current contents of `.codex/config.toml` (or "")
 * @returns Merged TOML string with comments/format preserved
 */
export function mergeSettings(existingToml: string): string {
  if (existingToml.trim().length === 0) {
    // Nothing to preserve — emit a clean Lisa-managed file
    return `${formatLisaSettings()}\n`;
  }
  const parsed = parseToml(existingToml) as Record<string, unknown>;
  const partitioned = partitionRequiredKeys(parsed);
  const afterUpdates = applyUpdatedKeys(
    existingToml,
    parsed,
    partitioned.updated
  );
  const afterPrepend = applyNewKeys(afterUpdates, partitioned.added);
  const afterFeatures = applyRequiredFeatures(afterPrepend);
  return afterFeatures.endsWith("\n") ? afterFeatures : `${afterFeatures}\n`;
}

/**
 * Split Lisa's required settings into "already-present-but-different" (which
 * we update in place via toml-patch to preserve comments) and "wholly new"
 * (which need careful insertion above the first table to avoid TOML's
 * "attach to last section" semantics).
 * @param parsed - Existing TOML parsed as a JS object
 * @returns Two records: keys to update, keys to add
 */
function partitionRequiredKeys(parsed: Record<string, unknown>): {
  readonly updated: Record<string, unknown>;
  readonly added: Record<string, unknown>;
} {
  const entries = Object.entries(LISA_REQUIRED_SETTINGS);
  const updated = Object.fromEntries(
    entries.filter(([key, value]) => key in parsed && parsed[key] !== value)
  );
  const added = Object.fromEntries(entries.filter(([key]) => !(key in parsed)));
  return { updated, added };
}

/**
 * Patch in-place updates via `toml-patch` so surrounding comments, blank
 * lines, and key order survive untouched. No-op when nothing to update.
 * @param toml - Existing TOML source
 * @param parsed - Existing TOML parsed as a JS object
 * @param updated - Keys whose values should change
 * @returns Patched TOML, or `toml` unchanged if no updates were needed
 */
function applyUpdatedKeys(
  toml: string,
  parsed: Record<string, unknown>,
  updated: Record<string, unknown>
): string {
  if (Object.keys(updated).length === 0) {
    return toml;
  }
  return patchToml(toml, { ...parsed, ...updated });
}

/**
 * Add wholly new root keys ABOVE the first table header, sidestepping
 * `toml-patch`'s default behavior of appending at the end (which would
 * silently nest the new keys under the trailing section).
 * @param toml - TOML source after in-place updates were applied
 * @param added - Keys to insert
 * @returns TOML with the new keys prepended (or unchanged if `added` is empty)
 */
function applyNewKeys(toml: string, added: Record<string, unknown>): string {
  if (Object.keys(added).length === 0) {
    return toml;
  }
  return prependRootKeys(toml, added);
}

/**
 * Insert root-level key=value lines above the first `[section]` header in
 * the provided TOML string. If no section header exists, append at the end.
 *
 * Required because TOML attaches every key to the most-recent table header,
 * so naively appending a root key at the end of a document with sections
 * silently nests it under the last section.
 *
 * Quote-state-aware: a line whose first non-whitespace char is `[` does
 * NOT count as a section header if it sits inside an open multi-line string
 * (`"""..."""` or `'''...'''`). Without this guard, a host config like
 * `notes = """\n[release-notes]\nv1\n"""` would have Lisa keys spliced into
 * the middle of the string, corrupting the file.
 * @param toml - The TOML source to mutate
 * @param keys - Root-level keys to insert
 * @returns The TOML source with the new keys placed above any sections
 */
function prependRootKeys(toml: string, keys: Record<string, unknown>): string {
  const block = Object.entries(keys)
    .map(([key, value]) => `${key} = ${formatTomlValue(value)}`)
    .join("\n");

  const lines = toml.split("\n");
  const sectionIndex = findFirstSectionHeaderIndex(lines);

  if (sectionIndex === -1) {
    // No sections — safe to append at the end
    return `${stripTrailingNewlines(toml)}\n${block}\n`;
  }

  const before = stripTrailingNewlines(lines.slice(0, sectionIndex).join("\n"));
  const after = lines.slice(sectionIndex).join("\n");
  const beforePart = before.length > 0 ? `${before}\n` : "";
  return `${beforePart}${block}\n\n${after}`;
}

/**
 * Find the line index of the first real `[section]` header, skipping any
 * `[`-prefixed lines that sit inside an open multi-line TOML string.
 *
 * Tracks a single "currently-open multi-line delimiter" (either `"""` or
 * `'''`). Per TOML grammar these can't be nested, so a string token is
 * sufficient state.
 * @param lines - The TOML source split on `\n`
 * @returns The 0-based line index, or -1 if no section header exists
 */
function findFirstSectionHeaderIndex(lines: readonly string[]): number {
  return lines.reduce<{
    readonly index: number;
    readonly openDelim: string | undefined;
  }>(
    (acc, line, idx) => {
      if (acc.index !== -1) {
        return acc;
      }
      const nextDelim = updateMultilineState(line, acc.openDelim);
      // A `[` line only counts when we're NOT currently inside a multi-line
      // string AND the line didn't open one this iteration.
      if (
        acc.openDelim === undefined &&
        nextDelim === undefined &&
        /^[ \t]*\[/.test(line)
      ) {
        return { index: idx, openDelim: nextDelim };
      }
      return { index: -1, openDelim: nextDelim };
    },
    { index: -1, openDelim: undefined as string | undefined }
  ).index;
}

/**
 * Compute the new "currently-open multi-line delimiter" state for a line.
 *
 * Counts `"""` and `'''` occurrences on the line (each pair toggles).
 * When entering, `openDelim` becomes the delimiter type; an odd count
 * within the same line toggles state; an even count leaves it unchanged.
 * @param line - One line of TOML source
 * @param openDelim - Currently open delimiter (`"""` / `'''` / undefined)
 * @returns The state after consuming this line
 */
function updateMultilineState(
  line: string,
  openDelim: string | undefined
): string | undefined {
  if (openDelim !== undefined) {
    const occurrences = countOccurrences(line, openDelim);
    return occurrences % 2 === 1 ? undefined : openDelim;
  }
  const tripleDouble = countOccurrences(line, '"""');
  const tripleSingle = countOccurrences(line, "'''");
  if (tripleDouble % 2 === 1) {
    return '"""';
  }
  if (tripleSingle % 2 === 1) {
    return "'''";
  }
  return undefined;
}

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 * @param haystack - String to search within
 * @param needle - Substring to count
 * @returns Non-negative integer
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  // Splitting on the needle gives N+1 segments for N occurrences.
  return haystack.split(needle).length - 1;
}

/**
 * Strip a run of trailing `\n` characters from a string without using a
 * regex (Sonar flags `\n+$` as potentially-backtracking, even though it
 * isn't). Other trailing whitespace (spaces, tabs) is preserved because
 * TOML doesn't care and we want minimal change.
 * @param value - String to strip
 * @returns The same string with any trailing newlines removed
 */
function stripTrailingNewlines(value: string): string {
  const lastNonNewline = lastNonNewlineIndex(value);
  return value.slice(0, lastNonNewline + 1);
}

/**
 * Find the index of the last character in `value` that isn't `\n`. Returns
 * -1 if the string is empty or all newlines.
 * @param value - String to scan
 * @returns The 0-based index of the last non-newline character, or -1
 */
function lastNonNewlineIndex(value: string): number {
  return Array.from(value)
    .map((char, idx) => ({ char, idx }))
    .filter(({ char }) => char !== "\n")
    .reduce((_, { idx }) => idx, -1);
}

/**
 * Render Lisa's required settings as a fresh TOML block. Used when no
 * host config file exists yet.
 * @returns The starter TOML content (without trailing newline)
 */
function formatLisaSettings(): string {
  const header = [
    "# This file is partly managed by Lisa.",
    "# The keys Lisa owns are listed below; other keys you add are preserved on update.",
  ];
  const settings = Object.entries(LISA_REQUIRED_SETTINGS).map(
    ([key, value]) => `${key} = ${formatTomlValue(value)}`
  );
  const features = [
    "",
    "[features]",
    ...Object.entries(LISA_REQUIRED_FEATURES).map(
      ([key, value]) => `${key} = ${formatTomlValue(value)}`
    ),
  ];
  return [...header, ...settings, ...features].join("\n");
}

/**
 * Ensure Lisa-required Codex feature flags are present under `[features]`.
 * This is intentionally string-based because the TOML patcher can append root
 * keys under the wrong table, and we want to preserve host comments/order.
 * @param toml - TOML source after root Lisa settings have been merged
 * @returns TOML with required `[features]` keys present
 */
function applyRequiredFeatures(toml: string): string {
  const lines = toml.split("\n");
  const featuresStart = findSectionHeaderIndex(lines, "features");
  if (featuresStart === -1) {
    return appendFeaturesSection(toml);
  }
  const featuresEnd = findNextSectionHeaderIndex(lines, featuresStart + 1);
  const sectionEnd = featuresEnd === -1 ? lines.length : featuresEnd;
  const updated = Object.entries(LISA_REQUIRED_FEATURES).reduce<string[]>(
    (acc, [key, value]) =>
      upsertSectionKey(acc, featuresStart, sectionEnd, key, value),
    lines
  );
  return updated.join("\n");
}

/**
 * Append a new `[features]` table to a TOML document.
 * @param toml - Existing TOML source
 * @returns TOML with the features table appended
 */
function appendFeaturesSection(toml: string): string {
  const block = [
    "[features]",
    ...Object.entries(LISA_REQUIRED_FEATURES).map(
      ([key, value]) => `${key} = ${formatTomlValue(value)}`
    ),
  ].join("\n");
  return `${stripTrailingNewlines(toml)}\n\n${block}\n`;
}

/**
 * Add or update one key within an existing TOML table.
 * @param lines - TOML split into lines
 * @param sectionStart - Index of the table header
 * @param sectionEnd - First line after the table
 * @param key - Key to upsert
 * @param value - Value to emit
 * @returns Updated TOML lines
 */
function upsertSectionKey(
  lines: string[],
  sectionStart: number,
  sectionEnd: number,
  key: string,
  value: unknown
): string[] {
  const keyPattern = new RegExp(
    `^(\\s*${escapeRegExp(key)}\\s*=\\s*)([^#\\n]*?)(\\s*#.*)?$`
  );
  const existingIndex = lines
    .slice(sectionStart + 1, sectionEnd)
    .findIndex(line => keyPattern.test(line));
  if (existingIndex === -1) {
    const rendered = `${key} = ${formatTomlValue(value)}`;
    return [
      ...lines.slice(0, sectionStart + 1),
      rendered,
      ...lines.slice(sectionStart + 1),
    ];
  }
  const absoluteIndex = sectionStart + 1 + existingIndex;
  const existingLine = lines[absoluteIndex] ?? "";
  const renderedValue = formatTomlValue(value);
  const replacedLine = existingLine.replace(
    keyPattern,
    (_match, prefix: string, rawValue: string, suffix = "") =>
      rawValue.trim() === renderedValue
        ? existingLine
        : `${prefix}${renderedValue}${suffix}`
  );
  return [
    ...lines.slice(0, absoluteIndex),
    replacedLine,
    ...lines.slice(absoluteIndex + 1),
  ];
}

/**
 * Find a specific TOML section header outside multiline strings.
 * @param lines - TOML split into lines
 * @param sectionName - Table name without brackets
 * @returns The line index, or -1 when absent
 */
function findSectionHeaderIndex(
  lines: readonly string[],
  sectionName: string
): number {
  return (
    findSectionHeaderIndexes(lines).find(
      idx => lines[idx]?.trim() === `[${sectionName}]`
    ) ?? -1
  );
}

/**
 * Find the next TOML section header at or after `fromIndex`.
 * @param lines - TOML split into lines
 * @param fromIndex - Starting index
 * @returns The line index, or -1 when there is no later table
 */
function findNextSectionHeaderIndex(
  lines: readonly string[],
  fromIndex: number
): number {
  return findSectionHeaderIndexes(lines).find(idx => idx >= fromIndex) ?? -1;
}

/**
 * Find all TOML section header lines outside multiline strings.
 * @param lines - TOML split into lines
 * @returns Header indexes
 */
function findSectionHeaderIndexes(lines: readonly string[]): readonly number[] {
  return lines.reduce<{
    readonly indexes: readonly number[];
    readonly openDelim: string | undefined;
  }>(
    (acc, line, idx) => {
      const nextDelim = updateMultilineState(line, acc.openDelim);
      const isHeader =
        acc.openDelim === undefined &&
        nextDelim === undefined &&
        /^[ \t]*\[[^\]]+\][ \t]*(#.*)?$/.test(line);
      return {
        indexes: isHeader ? [...acc.indexes, idx] : acc.indexes,
        openDelim: nextDelim,
      };
    },
    { indexes: [], openDelim: undefined as string | undefined }
  ).indexes;
}

/**
 * Escape a string for use inside a RegExp literal.
 * @param value - Raw string
 * @returns Escaped string
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Minimal TOML value formatter for the small set of value shapes we emit
 * in fresh-file mode (numbers, strings, booleans).
 * @param value - A value drawn from LISA_REQUIRED_SETTINGS
 * @returns The TOML literal representation
 */
function formatTomlValue(value: unknown): string {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  throw new Error(
    `Unsupported settings value type ${typeof value}: ${String(value)}`
  );
}
