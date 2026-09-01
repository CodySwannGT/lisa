/** Install the repository-owned Codex enforcement fallback hook. */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  type HooksFile,
  type LisaHookSpec,
  mergeLisaHooks,
  parseHooksFile,
  serializeHooksFile,
} from "./hooks-merger.js";

const CODEX_DIR = ".codex";
const HOOKS_FILENAME = "hooks.json";
const HOOKS_PATH = path.join(CODEX_DIR, HOOKS_FILENAME);
const FALLBACK_COMMAND =
  '/bin/bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/scripts/lisa-enforcement-fallback.sh"';

/** Stable marker for the repository enforcement dispatcher. */
export const CODEX_ENFORCEMENT_FALLBACK_ID = "enforcement-fallback";

/** Result of installing the repository enforcement dispatcher. */
export interface CodexEnforcementFallbackResult {
  /** Files written, relative to `.codex/`. */
  readonly managedFiles: readonly string[];
  /** Number of Lisa-owned hook handlers written. */
  readonly hookEntries: number;
}

const FALLBACK_SPEC: LisaHookSpec = {
  id: CODEX_ENFORCEMENT_FALLBACK_ID,
  event: "PreToolUse",
  matcher: "Bash|Edit|Write|apply_patch",
  command: FALLBACK_COMMAND,
  timeout: 30,
  statusMessage: "Checking Lisa enforcement policy",
};

/**
 * Reconcile the single repository hook that keeps enforcement active when
 * Codex's richer plugin hooks are not installed, enabled, and trusted in the
 * current session. The dispatcher intentionally runs even when plugin hooks
 * are live because repository state cannot prove session hook liveness.
 * @param destDir Host project root.
 * @returns Managed file and handler counts for the overlay manifest.
 */
export async function installCodexEnforcementFallback(
  destDir: string
): Promise<CodexEnforcementFallbackResult> {
  const hooksPath = path.join(destDir, HOOKS_PATH);
  await fse.ensureDir(path.dirname(hooksPath));
  const existing = await readHooksFile(hooksPath);
  const merged = mergeLisaHooks(existing, [FALLBACK_SPEC]);
  await writeFile(hooksPath, serializeHooksFile(merged), "utf8");
  return {
    managedFiles: Object.freeze([HOOKS_FILENAME]),
    hookEntries: 1,
  };
}

/**
 * Read a host hook file without inventing one when it is absent.
 * @param hooksPath Absolute path to the host's `.codex/hooks.json`.
 * @returns Parsed host hook configuration, or an empty configuration.
 */
async function readHooksFile(hooksPath: string): Promise<HooksFile> {
  if (!(await fse.pathExists(hooksPath))) {
    return {};
  }
  return parseHooksFile(await readFile(hooksPath, "utf8"));
}
