/**
 * Detect `devin` (Devin CLI) and install Lisa's Devin plugin variants.
 *
 * Devin installs plugins natively from a local path:
 * `devin plugins install --local -y <plugins/lisa-devin>`. `--local` keeps the
 * install on this machine instead of recording it in the user's Devin Cloud
 * plugin manifest, and `-y` skips the interactive trust prompt (the source is
 * Lisa's own package, which the operator already chose to install). Re-running
 * the install against the same source refreshes it, so the pass is idempotent.
 *
 * Detection rule: `devin` must be on `$PATH`. If absent, no-op — the
 * repository enforcement fallback (`.devin/hooks.v1.json`) still governs a
 * Devin session in the project.
 * @module devin/plugin-installer
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bound on one `devin plugins install` call. */
const INSTALL_TIMEOUT_MS = 120_000;

/** Result of one Devin plugin install. */
export interface DevinPluginInstallResult {
  /** True when devin was on PATH and an install was attempted. */
  readonly attempted: boolean;
  /** True when the install command exited 0. */
  readonly installed: boolean;
  /** Absolute variant directory passed to `devin plugins install`. */
  readonly source: string | undefined;
  /** Error message captured on failure, or undefined on success/no-op. */
  readonly error: string | undefined;
}

/** Runs one `devin` invocation; injectable for tests. */
export type DevinRunner = (args: readonly string[]) => Promise<void>;

/**
 * Default runner: execFile (no shell), so the plugin path is a single argv
 * entry and never subject to quoting or expansion.
 * @param args - Arguments after `devin`
 */
const defaultRunner: DevinRunner = async args => {
  await execFileAsync("devin", [...args], { timeout: INSTALL_TIMEOUT_MS });
};

/** Outcome of probing for the Devin CLI. */
export interface DevinDetection {
  /** True when `devin --version` exited 0. */
  readonly available: boolean;
  /**
   * Why the probe failed, when it failed for any reason OTHER than the CLI
   * being absent. Undefined when the CLI is simply not installed (ENOENT) or
   * when it is available — so a broken install is reported, never mistaken
   * for an absent one.
   */
  readonly error: string | undefined;
}

/**
 * Probe for the Devin CLI.
 * @param run - Runner used to probe `devin --version`
 * @returns Availability, plus the failure reason when the CLI exists but the probe failed
 */
export async function detectDevin(
  run: DevinRunner = defaultRunner
): Promise<DevinDetection> {
  try {
    await run(["--version"]);
    return { available: true, error: undefined };
  } catch (err) {
    const code = (err as { readonly code?: unknown } | null)?.code;
    if (code === "ENOENT") return { available: false, error: undefined };
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, error: message };
  }
}

/**
 * Install one Lisa Devin plugin variant from Lisa's `plugins/` directory.
 *
 * The caller detects `devin` once (see {@link detectDevin}) and calls this per
 * variant, so a missing CLI costs one probe rather than one per variant.
 * @param lisaPluginRoot - Absolute path to Lisa's `plugins/` directory
 * @param variantName - Variant directory (`lisa-devin`, `lisa-typescript-devin`, …)
 * @param run - Runner for the `devin` CLI
 * @returns Install result
 */
export async function installDevinPlugin(
  lisaPluginRoot: string,
  variantName: string = "lisa-devin",
  run: DevinRunner = defaultRunner
): Promise<DevinPluginInstallResult> {
  const source = path.join(lisaPluginRoot, variantName);
  if (!existsSync(path.join(source, ".devin-plugin", "plugin.json"))) {
    return {
      attempted: true,
      installed: false,
      source,
      error: `Lisa Devin variant not found at ${source}/.devin-plugin/plugin.json — run \`bun run build:plugins\` first`,
    };
  }
  try {
    await run(["plugins", "install", "--local", "-y", source]);
    return { attempted: true, installed: true, source, error: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { attempted: true, installed: false, source, error: message };
  }
}
