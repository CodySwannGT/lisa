/**
 * Detect whether Lisa is installed as a Codex plugin (via marketplace).
 *
 * Per `wiki/decisions/2026-05-28-codex-skills-canonical-path.md` and Wave 2
 * fan-out spec §src/codex/, when Lisa is installed via the Codex plugin
 * marketplace the per-project skills and hooks installers should no-op (the
 * plugin payload delivers the same components). When Lisa is NOT installed
 * as a plugin, the per-project installers continue to run as the fallback
 * delivery path.
 *
 * Detection: read `~/.codex/config.toml` (honoring `$CODEX_HOME` if set) and
 * check for a `[plugins."lisa@CodySwannGT-lisa"]` table with `enabled = true`.
 *
 * This is a best-effort detection. If the config file is missing, malformed,
 * or unreadable, the function returns `false` (fall through to per-project
 * install).
 * @module codex/lisa-plugin-detection
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Default Lisa marketplace plugin reference inside `~/.codex/config.toml`. */
export const DEFAULT_LISA_PLUGIN_KEY = "lisa@CodySwannGT-lisa";

/**
 * Resolve the path to `~/.codex/config.toml`.
 *
 * Does not consult `$CODEX_HOME` — this detection runs from `lisa apply`
 * (a build-tooling context, not an end-user shell) where the caller's
 * environment may not reflect the user's Codex install location. If
 * downstream Lisa flows need `$CODEX_HOME`-aware resolution, they can
 * pass an absolute path to {@link tomlHasEnabledPlugin} directly after
 * reading the file themselves.
 *
 * @returns Absolute path to `~/.codex/config.toml` (whether it exists or not).
 */
export function codexConfigPath(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
}

/**
 * Test whether the given config.toml body declares the Lisa plugin as enabled.
 *
 * Looks for a heading of the form `[plugins."<pluginKey>"]` followed by an
 * `enabled = true` line within the section. Implementation is intentionally
 * simple-text rather than a full TOML parse to avoid pulling a TOML dependency
 * into a hot detection path; a stricter parse can replace this if false
 * positives appear in practice.
 *
 * @param tomlBody - Contents of config.toml.
 * @param pluginKey - The plugin key string (e.g. "lisa@CodySwannGT-lisa").
 * @returns True when an enabled-true entry for the plugin key is present.
 */
export function tomlHasEnabledPlugin(
  tomlBody: string,
  pluginKey: string = DEFAULT_LISA_PLUGIN_KEY
): boolean {
  // Line-by-line scan instead of multiline regex — keeps the matcher trivially
  // linear in input length and avoids sonarjs/slow-regex warnings.
  const header = `[plugins."${pluginKey}"]`;
  const lines = tomlBody.split("\n");
  const headerIndex = lines.findIndex(line => line.trimStart() === header);
  if (headerIndex === -1) return false;
  // Walk forward until the next section header (a line starting with "[") or EOF.
  const tail = lines.slice(headerIndex + 1);
  for (const raw of tail) {
    const line = raw.trimStart();
    if (line.startsWith("[")) return false; // next section reached without enabled
    if (line.replaceAll(" ", "") === "enabled=true") return true;
  }
  return false;
}

/**
 * Detect whether Lisa is currently installed and enabled as a Codex plugin.
 *
 * Read-only; safe to call from inside any installer's preflight gate. Returns
 * false on any error (missing file, parse failure, IO error) so the caller
 * defaults to running its per-project install path.
 *
 * @param pluginKey - The plugin key to look for. Defaults to the canonical
 *   Lisa marketplace ref.
 * @returns True when the plugin is enabled in `~/.codex/config.toml`.
 */
export async function isLisaInstalledAsCodexPlugin(
  pluginKey: string = DEFAULT_LISA_PLUGIN_KEY
): Promise<boolean> {
  const configPath = codexConfigPath();
  if (!existsSync(configPath)) return false;
  try {
    const body = await readFile(configPath, "utf8");
    return tomlHasEnabledPlugin(body, pluginKey);
  } catch {
    return false;
  }
}
