/**
 * Install the repository-owned Devin enforcement fallback hook.
 *
 * Devin CLI reads project hooks from `.devin/hooks.v1.json`, where the whole
 * file is the hooks object (`{ "PreToolUse": [ { matcher, hooks } ] }`). It
 * also reads `.claude/settings.json` hooks, but those never fire on Devin: their
 * `Bash` / `Write|Edit|MultiEdit` matchers name Claude tools, and Devin's tools
 * are `exec` / `write` / `edit` (measured by run on Devin CLI 3000.11.3,
 * CodySwannGT/lisa#4427). So without this file a Devin session whose Lisa
 * plugin is missing, disabled, or untrusted runs with no enforcement at all.
 *
 * The single Lisa entry routes Devin's shell and file-edit tools to
 * `scripts/lisa-enforcement-fallback.sh` — the same dispatcher Claude and
 * Codex use — after rewriting the payload's lowercase `tool_name` to the
 * Claude name the guards test for. Host-authored entries are preserved; the
 * Lisa entry is recognised by its EXACT command (see {@link LISA_OWNED_COMMANDS}),
 * so no marker field has to be added to a schema Lisa does not own, and a host
 * command that merely calls the dispatcher alongside its own checks is never
 * mistaken for Lisa's and removed.
 * @module devin/enforcement-fallback-installer
 */
import * as fse from "fs-extra";
import { readFile, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";

const DEVIN_DIR = ".devin";
const HOOKS_FILENAME = "hooks.v1.json";

/** Dispatcher path that identifies the Lisa-owned handler. */
export const DEVIN_FALLBACK_DISPATCHER = "scripts/lisa-enforcement-fallback.sh";

/** Devin tools whose calls the dispatcher's guards evaluate. */
export const DEVIN_FALLBACK_MATCHER = "^(exec|write|edit|apply_patch)$";

/**
 * The handler command. Devin sets `DEVIN_PROJECT_DIR` (and `CLAUDE_PROJECT_DIR`)
 * to the project root; the git/pwd fallback covers a runner that does not.
 * Without `jq` the payload passes unchanged, exactly as the guards behave when
 * they cannot parse it.
 *
 * The root has leading and trailing whitespace trimmed (never inner spaces —
 * a project path may contain them) before the fallback applies, so a `" "`
 * value cannot survive and point at a dispatcher that cannot exist. Every
 * failure that would otherwise ALLOW the call fails closed with exit 2, the
 * only status Devin blocks on: a missing dispatcher, and a tool-name mapping
 * that could not run (no `jq`, or `jq` failed) — forwarding the raw lowercase
 * `exec` would make every Bash guard stand down.
 */
export const DEVIN_FALLBACK_COMMAND = [
  "root=\"$(printf '%s' \"${DEVIN_PROJECT_DIR-}\" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')\"",
  '[ -n "$root" ] || root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"',
  `[ -f "$root/${DEVIN_FALLBACK_DISPATCHER}" ] || { echo "Lisa enforcement dispatcher missing at $root/${DEVIN_FALLBACK_DISPATCHER}; refusing (run lisa apply)" >&2; exit 2; }`,
  "payload=$(cat)",
  `mapped=$(printf '%s' "$payload" | jq -c 'if (.tool_name | type) == "string" then .tool_name |= ({"exec": "Bash", "write": "Write", "edit": "Edit"}[.] // .) else . end' 2>/dev/null) || mapped=""`,
  `[ -n "$mapped" ] || { echo "Lisa could not map the Devin tool name (jq missing or failed); refusing" >&2; exit 2; }`,
  `printf '%s' "$mapped" | /bin/bash "$root/${DEVIN_FALLBACK_DISPATCHER}"`,
].join("; ");

/**
 * Every command string Lisa has ever written as its fallback handler. Ownership
 * is an exact match against this list: when the command changes, the previous
 * spelling stays here so a re-apply replaces it instead of leaving a stale copy.
 */
const LISA_OWNED_COMMANDS: ReadonlySet<string> = new Set([
  DEVIN_FALLBACK_COMMAND,
]);

/** One Devin hook handler. Unknown host fields are preserved on round-trip. */
interface DevinHookHandler {
  readonly type?: string;
  readonly command?: string;
  readonly [key: string]: unknown;
}

/** One matcher group under an event. */
interface DevinMatcherGroup {
  readonly matcher?: string;
  readonly hooks?: readonly DevinHookHandler[];
  readonly [key: string]: unknown;
}

/** `.devin/hooks.v1.json`: event name → matcher groups. */
type DevinHooksFile = Readonly<Record<string, unknown>>;

/** Result of installing the fallback. */
export interface DevinEnforcementFallbackResult {
  /** Files written, relative to the project root. */
  readonly managedFiles: readonly string[];
  /** Number of Lisa-owned hook handlers in the written file. */
  readonly hookEntries: number;
}

/**
 * Whether a handler is the Lisa-owned dispatcher entry.
 * @param handler - Hook handler from the host file
 * @returns True when its command runs the Lisa dispatcher
 */
function isLisaHandler(handler: DevinHookHandler): boolean {
  return (
    typeof handler.command === "string" &&
    LISA_OWNED_COMMANDS.has(handler.command)
  );
}

/**
 * Whether a `.devin/hooks.v1.json` body carries the current Lisa fallback
 * handler under PreToolUse. Used by readiness checks, so a file that merely
 * exists (or is `{}`) is not mistaken for an installed fallback.
 * @param raw - File contents, or undefined when absent
 * @returns True when the exact Lisa handler is registered
 */
export function hasDevinFallback(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return false;
    const groups = (parsed as Record<string, unknown>).PreToolUse;
    if (!Array.isArray(groups)) return false;
    return (groups as readonly DevinMatcherGroup[]).some(
      group =>
        group?.matcher === DEVIN_FALLBACK_MATCHER &&
        Array.isArray(group.hooks) &&
        group.hooks.some(
          handler =>
            handler?.type === "command" &&
            handler.command === DEVIN_FALLBACK_COMMAND
        )
    );
  } catch {
    return false;
  }
}

/**
 * Remove every Lisa-owned handler from one event's groups, dropping groups
 * left with no handlers. Host handlers and fields are kept verbatim.
 * @param groups - The event's matcher groups as read from disk
 * @returns Groups without Lisa handlers
 */
function withoutLisaHandlers(groups: unknown): readonly DevinMatcherGroup[] {
  if (!Array.isArray(groups)) return [];
  return (groups as readonly DevinMatcherGroup[]).flatMap(group => {
    if (!Array.isArray(group?.hooks)) return [group];
    const kept = group.hooks.filter(handler => !isLisaHandler(handler));
    if (kept.length === group.hooks.length) return [group];
    return kept.length > 0 ? [{ ...group, hooks: kept }] : [];
  });
}

/**
 * Merge the Lisa fallback into a parsed hooks file.
 * @param existing - Parsed host file, or `{}`
 * @returns The file with exactly one Lisa PreToolUse handler
 */
export function mergeDevinFallback(existing: DevinHooksFile): DevinHooksFile {
  const lisaGroup: DevinMatcherGroup = {
    matcher: DEVIN_FALLBACK_MATCHER,
    hooks: [{ type: "command", command: DEVIN_FALLBACK_COMMAND, timeout: 30 }],
  };
  return {
    ...existing,
    PreToolUse: [...withoutLisaHandlers(existing.PreToolUse), lisaGroup],
  };
}

/**
 * Parse JSON, naming the file when it is malformed.
 * @param raw - File contents
 * @param file - Path for the error message
 * @returns The parsed value
 */
function parseJson(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${file} is not valid JSON (${reason}); refusing to overwrite it`
    );
  }
}

/**
 * Parse the host file, refusing anything that is not a JSON object rather than
 * overwriting host content Lisa cannot read.
 * @param raw - File contents
 * @param file - Path for the error message
 * @returns Parsed hooks file
 */
function parseHooksFile(raw: string, file: string): DevinHooksFile {
  const parsed = parseJson(raw, file);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${file} must be a JSON object of hook events; refusing to overwrite it`
    );
  }
  const preToolUse = (parsed as Record<string, unknown>).PreToolUse;
  if (preToolUse !== undefined && !Array.isArray(preToolUse)) {
    throw new Error(
      `${file} has a PreToolUse value that is not an array; refusing to overwrite it`
    );
  }
  return parsed as DevinHooksFile;
}

/**
 * Reconcile `.devin/hooks.v1.json` so it holds exactly one Lisa enforcement
 * fallback handler alongside any host-authored hooks.
 * @param destDir - Host project root
 * @returns Managed file and handler counts
 */
export async function installDevinEnforcementFallback(
  destDir: string
): Promise<DevinEnforcementFallbackResult> {
  const hooksPath = path.join(destDir, DEVIN_DIR, HOOKS_FILENAME);
  await fse.ensureDir(path.dirname(hooksPath));
  const existing = (await fse.pathExists(hooksPath))
    ? parseHooksFile(await readFile(hooksPath, "utf8"), hooksPath)
    : {};
  const merged = mergeDevinFallback(existing);
  // Write beside the target and rename over it, so an interrupted apply can
  // never leave a truncated hooks file that silently disables every hook.
  const tempPath = `${hooksPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await rename(tempPath, hooksPath);
  return {
    managedFiles: Object.freeze([path.join(DEVIN_DIR, HOOKS_FILENAME)]),
    hookEntries: 1,
  };
}
