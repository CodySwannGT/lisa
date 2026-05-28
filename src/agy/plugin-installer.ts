/**
 * Detect `agy` (Antigravity CLI) and install Lisa's agy plugin variant.
 *
 * agy reads bare `plugin.json` plugins via `agy plugin install <local-path>`.
 * Lisa's Pattern B build pipeline produces the agy-shaped variant at
 * `plugins/lisa-agy/` (see `scripts/generate-agy-plugin-artifacts.mjs`).
 *
 * Detection rule: `agy` must be on `$PATH`. If absent, this installer is a
 * no-op — the user does not have Antigravity installed and Lisa cannot help.
 *
 * Idempotence rule: re-running `agy plugin install` against the same source
 * is treated as success (agy itself idempotently overwrites the import entry
 * per its `installed_plugins.json` format).
 * @module agy/plugin-installer
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import * as path from "node:path";

const execAsync = promisify(exec);

/** Result of the agy plugin install pass. */
export interface AgyPluginInstallResult {
  /** True when agy was on PATH and the install command was attempted. */
  readonly attempted: boolean;
  /** True when the install command exited 0. False on any error. */
  readonly installed: boolean;
  /** Resolved absolute path to the source plugin tree that was installed. */
  readonly source: string | undefined;
  /** Error message when installation failed, or undefined on success/no-op. */
  readonly error: string | undefined;
}

/**
 * Detect whether `agy` is on PATH.
 *
 * Uses `command -v agy` for portability across the shells Lisa supports
 * (bash + zsh). Returns true on success exit, false on non-zero or any error.
 * @returns True when agy is callable.
 */
async function detectAgy(): Promise<boolean> {
  try {
    await execAsync("command -v agy");
    return true;
  } catch {
    return false;
  }
}

/**
 * Install Lisa's agy plugin variant via `agy plugin install <local-path>`.
 * @param lisaPluginRoot - Absolute path to Lisa's plugins directory (typically
 *   the `plugins/` directory inside the @codyswann/lisa package). The agy
 *   variant lives at `<lisaPluginRoot>/lisa-agy/`.
 * @returns Install result describing whether the install was attempted, whether
 *   it succeeded, and any error message captured.
 */
export async function installAgyPlugin(
  lisaPluginRoot: string
): Promise<AgyPluginInstallResult> {
  if (!(await detectAgy())) {
    return {
      attempted: false,
      installed: false,
      source: undefined,
      error: undefined,
    };
  }

  const agyVariant = path.join(lisaPluginRoot, "lisa-agy");
  if (!existsSync(path.join(agyVariant, "plugin.json"))) {
    return {
      attempted: true,
      installed: false,
      source: agyVariant,
      error: `agy plugin variant not found at ${agyVariant}/plugin.json — run \`bun run build:plugins\` first`,
    };
  }

  try {
    // agy plugin install handles its own idempotence — re-installing the same
    // source updates the entry in installed_plugins.json without erroring.
    await execAsync(`agy plugin install ${JSON.stringify(agyVariant)}`);
    return {
      attempted: true,
      installed: true,
      source: agyVariant,
      error: undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      installed: false,
      source: agyVariant,
      error: message,
    };
  }
}
