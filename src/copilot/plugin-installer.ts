/**
 * Detect `copilot` (GitHub Copilot CLI) and install Lisa's Copilot plugin
 * variant.
 *
 * Two distribution paths are supported (in priority order):
 *
 *   1. Marketplace install via `copilot plugin install lisa@CodySwannGT/lisa`.
 *      This is the documented forward path. As of 2026-05-28 it fails because
 *      Lisa's `.claude-plugin/marketplace.json` `pluginRoot: "./plugins"` and
 *      each plugin's `source: "./plugins/lisa"` double-up to `plugins/plugins/lisa`
 *      under Copilot's marketplace cache. The marketplace.json fix is gated on
 *      empirical verification (Wave 2 spec step 8); when the fix lands this
 *      installer's marketplace path becomes usable.
 *
 *   2. Local-path install via `copilot plugin install <plugins/lisa-copilot>`.
 *      Currently emits a deprecation warning ("only plugin@marketplace installs
 *      will be supported in a future release") but works. Lisa uses this as
 *      the fallback while the marketplace fix is in-flight.
 *
 * Detection rule: `copilot` must be on `$PATH`. If absent, no-op.
 *
 * Idempotence rule: Copilot's plugin install handles its own state; re-running
 * against the same source updates the installed-plugins entry without erroring.
 * @module copilot/plugin-installer
 */
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import * as path from "node:path";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Result of the Copilot plugin install pass. */
export interface CopilotPluginInstallResult {
  /** True when copilot was on PATH and an install was attempted. */
  readonly attempted: boolean;
  /** True when the install command exited 0. False on any error. */
  readonly installed: boolean;
  /** Which install path was used: "marketplace" or "local". */
  readonly via: "marketplace" | "local" | undefined;
  /** Resolved source argument passed to `copilot plugin install`. */
  readonly source: string | undefined;
  /** Error message captured on failure, or undefined on success/no-op. */
  readonly error: string | undefined;
}

/**
 * Detect whether `copilot` is on PATH.
 *
 * @returns True when copilot is callable.
 */
async function detectCopilot(): Promise<boolean> {
  try {
    await execAsync("command -v copilot");
    return true;
  } catch {
    return false;
  }
}

/**
 * Try the marketplace install path. Returns the install result.
 *
 * @param marketplaceRef - e.g. "lisa@CodySwannGT/lisa".
 * @returns Result describing whether the install succeeded.
 */
async function tryMarketplaceInstall(
  marketplaceRef: string
): Promise<CopilotPluginInstallResult> {
  try {
    // execFile (no shell): the ref is passed as an argv entry, so it is never
    // subject to shell quoting/expansion. This also makes Windows paths with
    // backslashes safe in the local-install path below.
    await execFileAsync("copilot", ["plugin", "install", marketplaceRef]);
    return {
      attempted: true,
      installed: true,
      via: "marketplace",
      source: marketplaceRef,
      error: undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      installed: false,
      via: "marketplace",
      source: marketplaceRef,
      error: message,
    };
  }
}

/**
 * Try the local-path install path against Lisa's Copilot variant.
 *
 * @param localPath - Absolute path to plugins/lisa-copilot/.
 * @returns Result describing whether the install succeeded.
 */
async function tryLocalInstall(
  localPath: string
): Promise<CopilotPluginInstallResult> {
  try {
    await execFileAsync("copilot", ["plugin", "install", localPath]);
    return {
      attempted: true,
      installed: true,
      via: "local",
      source: localPath,
      error: undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      installed: false,
      via: "local",
      source: localPath,
      error: message,
    };
  }
}

/**
 * Install Lisa's Copilot plugin variant.
 *
 * Tries the marketplace path first (forward-compatible with the
 * marketplace.json `pluginRoot` doubling fix from Wave 2 spec step 8). On
 * marketplace failure (including the "plugin source directory not found"
 * error caused by today's marketplace shape), falls back to local-path
 * install against `plugins/lisa-copilot/` from the Lisa package.
 *
 * @param lisaPluginRoot - Absolute path to Lisa's `plugins/` directory.
 * @param variantName - Variant directory name under `lisaPluginRoot` to install
 *   (default `lisa-copilot`, the base variant). Stack variants are
 *   `lisa-<stack>-copilot` (e.g. `lisa-typescript-copilot`).
 * @param marketplaceRef - Marketplace install ref. Defaults to
 *   `<variantName>@CodySwannGT/lisa`.
 * @returns Install result.
 */
export async function installCopilotPlugin(
  lisaPluginRoot: string,
  variantName: string = "lisa-copilot",
  marketplaceRef: string = `${variantName}@CodySwannGT/lisa`
): Promise<CopilotPluginInstallResult> {
  if (!(await detectCopilot())) {
    return {
      attempted: false,
      installed: false,
      via: undefined,
      source: undefined,
      error: undefined,
    };
  }

  const marketplaceResult = await tryMarketplaceInstall(marketplaceRef);
  if (marketplaceResult.installed) return marketplaceResult;

  const localPath = path.join(lisaPluginRoot, variantName);
  if (!existsSync(path.join(localPath, ".claude-plugin", "plugin.json"))) {
    return {
      attempted: true,
      installed: false,
      via: "local",
      source: localPath,
      error: `Lisa Copilot variant not found at ${localPath}/.claude-plugin/plugin.json — run \`bun run build:plugins\` first`,
    };
  }
  return tryLocalInstall(localPath);
}
