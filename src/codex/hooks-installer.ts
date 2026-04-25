/**
 * Install Lisa-managed Codex hooks into a host project.
 *
 * Pipeline:
 *   1. Filter hook catalog by detected project types
 *   2. Copy each script from `src/codex/scripts/` → `.codex/hooks/lisa/`
 *   3. For inject-rules: also mirror Lisa rules into `.codex/lisa-rules/`
 *   4. Tagged-merge `.codex/hooks.json`
 *
 * Codex hook event support map (vs. Lisa's existing Claude Code hooks):
 *   - SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop  ✅
 *   - PermissionRequest                                             ✅ (Codex-only)
 *   - SubagentStart, SessionEnd, Notification, PreCompact           ❌ (Codex doesn't have these)
 * @module codex/hooks-installer
 */
import * as fse from "fs-extra";
import {
  chmod,
  copyFile,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectType } from "../core/config.js";
import {
  type CodexHookEvent,
  type HooksFile,
  type LisaHookSpec,
  mergeLisaHooks,
  parseHooksFile,
  serializeHooksFile,
} from "./hooks-merger.js";

/** Subdirectory inside `.codex/` for Lisa-managed hook scripts */
export const LISA_HOOKS_SUBDIR = path.join("hooks", "lisa");

/** Subdirectory inside `.codex/` for Lisa rules content (read by inject-rules) */
export const LISA_RULES_SUBDIR = "lisa-rules";

/** Filename of the Codex hooks config file inside `.codex/` */
export const HOOKS_FILENAME = "hooks.json";

/**
 * Matcher regex shared by every PostToolUse/PreToolUse hook that fires on
 * a file write. Codex emits these tool names for filesystem edits across
 * its three write paths (text Edit, file Write, apply_patch diff).
 */
const WRITE_MATCHER = "Edit|Write|apply_patch";

/** Stable definition of one Lisa-shipped Codex hook */
interface HookCatalogEntry {
  /** Stable identifier; goes into `_lisaId` */
  readonly id: string;
  /** Codex hook event */
  readonly event: CodexHookEvent;
  /** Matcher regex (use `""` for events that don't take a matcher) */
  readonly matcher: string;
  /** Filename inside `src/codex/scripts/` */
  readonly scriptFilename: string;
  /** Project types this hook should install for. Use `["*"]` for all stacks. */
  readonly forProjectTypes: readonly (ProjectType | "*")[];
  /** Optional human-readable status message Codex shows during the hook */
  readonly statusMessage?: string;
}

/**
 * Hook catalog. Adding a new hook? Three steps:
 *   1. Drop the script into `src/codex/scripts/<filename>`
 *   2. Add an entry here
 *   3. Add tests in `tests/unit/codex/hooks-installer.test.ts`
 *
 * Stack-specific hooks are gated by `forProjectTypes` so they're only shipped
 * when the relevant project type is detected.
 */
const HOOK_CATALOG: readonly HookCatalogEntry[] = [
  {
    id: "inject-rules",
    event: "SessionStart",
    matcher: "",
    scriptFilename: "inject-rules.sh",
    forProjectTypes: ["*"],
    statusMessage: "Injecting Lisa rules into session context",
  },
  {
    id: "notify-ntfy",
    event: "Stop",
    matcher: "",
    scriptFilename: "notify-ntfy.sh",
    forProjectTypes: ["*"],
  },
  {
    id: "format-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "format-on-edit.sh",
    forProjectTypes: ["typescript"],
  },
  {
    id: "lint-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "lint-on-edit.sh",
    forProjectTypes: ["typescript"],
  },
  {
    id: "sg-scan-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "sg-scan-on-edit.sh",
    forProjectTypes: ["typescript"],
  },
  {
    id: "rubocop-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "rubocop-on-edit.sh",
    forProjectTypes: ["rails"],
  },
  {
    id: "block-migration-edits",
    event: "PreToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "block-migration-edits.sh",
    forProjectTypes: ["nestjs"],
  },
];

/** Result of the hooks install pass */
export interface HooksInstallResult {
  /** Files written, relative to `.codex/`. Used to update the manifest. */
  readonly managedFiles: readonly string[];
  /** Number of Lisa hook entries written into hooks.json */
  readonly hookEntries: number;
}

/**
 * Install Lisa hook scripts + rules + hooks.json entries.
 * @param lisaDir - Absolute path to the Lisa repo root (or installed package)
 * @param destDir - Absolute path to the host project root
 * @param detectedTypes - Project types Lisa detected; used to filter stack-
 *   specific hooks. Always includes the universal hooks regardless.
 * @returns Result describing what was written
 */
export async function installHooks(
  lisaDir: string,
  destDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<HooksInstallResult> {
  const codexDir = path.join(destDir, ".codex");
  const hooksDir = path.join(codexDir, LISA_HOOKS_SUBDIR);
  const rulesDir = path.join(codexDir, LISA_RULES_SUBDIR);
  await fse.ensureDir(hooksDir);
  await fse.ensureDir(rulesDir);

  const applicable = filterCatalogByTypes(detectedTypes);

  // Step 1: copy every applicable script and collect their relative paths
  const scriptFiles: readonly string[] = await Promise.all(
    applicable.map(async entry => {
      const scriptSource = resolveBundledScript(entry.scriptFilename);
      const scriptDest = path.join(hooksDir, entry.scriptFilename);
      await copyFile(scriptSource, scriptDest);
      await chmod(scriptDest, 0o755);
      return path.join(LISA_HOOKS_SUBDIR, entry.scriptFilename);
    })
  );

  // Step 2: mirror rules from Lisa into .codex/lisa-rules/ (only when
  // inject-rules is being installed — i.e., always, since it's a "*" hook)
  const ruleFiles: readonly string[] = applicable.some(
    e => e.id === "inject-rules"
  )
    ? (await mirrorRules(lisaDir, rulesDir)).map(file =>
        path.join(LISA_RULES_SUBDIR, file)
      )
    : [];

  // Step 3: tagged-merge hooks.json
  const hooksFilePath = path.join(codexDir, HOOKS_FILENAME);
  const existing = await readHooksFile(hooksFilePath);
  const lisaHookSpecs = applicable.map(entry =>
    catalogEntryToSpec(entry, destDir)
  );
  const merged = mergeLisaHooks(existing, lisaHookSpecs);
  await writeFile(hooksFilePath, serializeHooksFile(merged), "utf8");

  return {
    managedFiles: Object.freeze([...scriptFiles, ...ruleFiles, HOOKS_FILENAME]),
    hookEntries: lisaHookSpecs.length,
  };
}

/**
 * Filter the catalog by detected project types. Universal hooks (`"*"`)
 * always pass; stack-specific hooks pass only if their type is detected.
 * @param detectedTypes - Project types Lisa detected for the host
 * @returns The catalog entries that apply to this host
 */
function filterCatalogByTypes(
  detectedTypes: readonly ProjectType[]
): readonly HookCatalogEntry[] {
  const detectedSet = new Set<string>(detectedTypes);
  return HOOK_CATALOG.filter(entry =>
    entry.forProjectTypes.some(t => t === "*" || detectedSet.has(t))
  );
}

/**
 * Convert a catalog entry into the LisaHookSpec the merger consumes.
 *
 * The script path resolves at hook-firing time via
 * `git rev-parse --show-toplevel` because Codex sets the hook script's cwd
 * to the session cwd, not the repo root. Falls back to `pwd` if not in a git
 * repo (rare).
 * @param entry - One catalog entry to translate
 * @param _destDir - Reserved for future per-host customization; currently unused
 * @returns A LisaHookSpec ready to feed into mergeLisaHooks
 */
function catalogEntryToSpec(
  entry: HookCatalogEntry,
  _destDir: string
): LisaHookSpec {
  const command = `bash "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.codex/${LISA_HOOKS_SUBDIR}/${entry.scriptFilename}"`;
  return {
    id: entry.id,
    event: entry.event,
    matcher: entry.matcher,
    command,
    ...(entry.statusMessage !== undefined
      ? { statusMessage: entry.statusMessage }
      : {}),
  };
}

/**
 * Read an existing hooks.json file, returning {} if absent.
 * @param hooksFilePath - Absolute path to `<destDir>/.codex/hooks.json`
 * @returns Parsed HooksFile (empty object if the file doesn't exist)
 */
async function readHooksFile(hooksFilePath: string): Promise<HooksFile> {
  if (!(await fse.pathExists(hooksFilePath))) {
    return {};
  }
  const raw = await readFile(hooksFilePath, "utf8");
  return parseHooksFile(raw);
}

/**
 * Resolve a bundled script path. Scripts ship inside the Lisa source tree at
 * `src/codex/scripts/<name>` and are accessible at runtime by computing the
 * path relative to this module's URL.
 * @param filename - Script filename (e.g. "inject-rules.sh")
 * @returns Absolute path to the bundled script in the Lisa install
 */
function resolveBundledScript(filename: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(moduleDir, "scripts", filename);
}

/**
 * Copy every .md file from Lisa's `plugins/lisa/rules/` into the host's
 * `.codex/lisa-rules/`. Returns the list of filenames copied (without
 * directory).
 * @param lisaDir - Absolute path to the Lisa repo / installed package
 * @param rulesDestDir - Absolute path to `<destDir>/.codex/lisa-rules/`
 * @returns Filenames (without directory) of every rule .md file copied
 */
async function mirrorRules(
  lisaDir: string,
  rulesDestDir: string
): Promise<readonly string[]> {
  const rulesSourceDir = path.join(lisaDir, "plugins", "lisa", "rules");
  if (!(await fse.pathExists(rulesSourceDir))) {
    return [];
  }
  const files = (await readdir(rulesSourceDir)).filter(name =>
    name.endsWith(".md")
  );
  await Promise.all(
    files.map(file =>
      copyFile(path.join(rulesSourceDir, file), path.join(rulesDestDir, file))
    )
  );
  return Object.freeze(files);
}
