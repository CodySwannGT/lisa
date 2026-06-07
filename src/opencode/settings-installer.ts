/**
 * Manage Lisa-required settings in a host project's `opencode.json`.
 *
 * OpenCode reads project-scope config from `opencode.json` at the project root
 * (JSON or JSONC — comments and trailing commas are allowed; see
 * opencode.ai/docs/config). Config files across scopes are *merged*, not
 * replaced, so Lisa writes only the project file and only the handful of keys it
 * owns; every host-authored key, comment, and formatting choice is preserved by
 * editing the document surgically via `jsonc-parser` (the JSON analogue of the
 * `toml-patch` round-trip the Codex settings installer relies on).
 *
 * Lisa-owned keys (host wins for everything NOT listed; Lisa wins for these):
 *   - `share`: forced to `"disabled"`. OpenCode session sharing defaults to ON
 *     and mints PUBLIC share URLs for conversations — an enterprise data-exposure
 *     hazard. Lisa disables it so applying the fleet config can never silently
 *     publish a host's sessions.
 *
 * `$schema` is set to OpenCode's schema URL ONLY when absent (a default, not a
 * force) so editor validation works on fresh files without clobbering a host
 * that pinned a different schema.
 * @module opencode/settings-installer
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

/** Filename of OpenCode's project-scope config file (at the project root). */
export const CONFIG_FILENAME = "opencode.json";

/** OpenCode's config JSON-schema URL, used to seed `$schema` on fresh files. */
export const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";

/**
 * Lisa-required settings forced into `opencode.json`. For these keys Lisa wins
 * on conflict; every other key the host authors is preserved untouched.
 *
 * `share: "disabled"` is the headline entry — OpenCode sharing is ON by default
 * and creates public URLs, so disabling it is an enterprise-safety guarantee.
 */
export const LISA_REQUIRED_SETTINGS: Readonly<Record<string, unknown>> = {
  share: "disabled",
};

/** JSONC edit formatting — 2-space indent, matching the repo's JSON style. */
const FORMATTING_OPTIONS = {
  formattingOptions: { tabSize: 2, insertSpaces: true },
} as const;

/** Result of a settings install pass. */
export interface SettingsInstallResult {
  /** Files written, relative to the project root. */
  readonly managedFiles: readonly string[];
  /** Whether `opencode.json` was newly created (vs. merged in place). */
  readonly created: boolean;
}

/**
 * Install or update Lisa's required settings in `<destDir>/opencode.json`.
 *
 * Host keys, comments, and formatting survive because the merge edits the
 * document surgically rather than reserializing it.
 * @param destDir - Absolute path to the host project root.
 * @returns Result describing what was written.
 */
export async function installSettings(
  destDir: string
): Promise<SettingsInstallResult> {
  const configPath = path.join(destDir, CONFIG_FILENAME);
  const exists = existsSync(configPath);
  const existingContent = exists ? await readFile(configPath, "utf8") : "";

  const merged = mergeSettings(existingContent);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, merged, "utf8");

  return {
    managedFiles: Object.freeze([CONFIG_FILENAME]),
    created: !exists,
  };
}

/**
 * Merge Lisa-required settings into an `opencode.json` (JSONC) document. Pure
 * function for testability; `installSettings` is the I/O wrapper.
 *
 * Empty input yields a clean Lisa-authored document. Non-empty input is parsed
 * tolerantly (comments + trailing commas allowed) and edited key-by-key so
 * surrounding host content is preserved byte-for-byte. Throws on invalid JSONC
 * so a malformed host file is surfaced rather than silently overwritten.
 * @param existingJsonc - Current contents of `opencode.json` (or "").
 * @returns Merged JSON/JSONC string with host content preserved.
 */
export function mergeSettings(existingJsonc: string): string {
  if (existingJsonc.trim().length === 0) {
    const fresh = { $schema: OPENCODE_SCHEMA_URL, ...LISA_REQUIRED_SETTINGS };
    return `${JSON.stringify(fresh, null, 2)}\n`;
  }

  const current = parseJsoncOrThrow(existingJsonc);

  const withForced = Object.entries(LISA_REQUIRED_SETTINGS).reduce(
    (text, [key, value]) => upsertKey(text, [key], value, current[key]),
    existingJsonc
  );
  // `$schema` is a default, not a force: only set it when the host omitted it.
  const withSchema =
    current["$schema"] === undefined
      ? upsertKey(withForced, ["$schema"], OPENCODE_SCHEMA_URL, undefined)
      : withForced;

  return withSchema.endsWith("\n") ? withSchema : `${withSchema}\n`;
}

/**
 * Parse JSONC, throwing a descriptive error on the first syntax problem.
 *
 * Comments and trailing commas are tolerated (OpenCode permits both); genuine
 * syntax errors throw so a corrupt host config is never silently clobbered.
 * @param jsonc - Raw `opencode.json` contents.
 * @returns The parsed object (empty object if the root is a non-object).
 */
function parseJsoncOrThrow(jsonc: string): Record<string, unknown> {
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

/**
 * Set `value` at `keyPath` via a surgical JSONC edit, skipping the write when
 * the document already holds that value (keeps re-runs no-op-clean).
 * @param text - Current document text.
 * @param keyPath - JSON path to the key (single-segment for our keys).
 * @param value - Value to set.
 * @param currentValue - The value already present at `keyPath` (or undefined).
 * @returns The edited document text.
 */
function upsertKey(
  text: string,
  keyPath: readonly (string | number)[],
  value: unknown,
  currentValue: unknown
): string {
  if (currentValue === value) {
    return text;
  }
  const edits = modify(text, [...keyPath], value, FORMATTING_OPTIONS);
  return applyEdits(text, edits);
}
