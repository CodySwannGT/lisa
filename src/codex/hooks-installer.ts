/* eslint-disable max-lines -- hook catalog and reconciliation form one cohesive pipeline */
/**
 * Install Lisa-managed Codex hooks into a host project.
 *
 * Pipeline:
 *   1. Filter hook catalog by detected project types
 *   2. Link each script from `src/codex/scripts/` → `.codex/hooks/lisa/`
 *   3. For inject-rules: link Lisa rules into `.codex/lisa-rules/`
 *   4. Tagged-merge `.codex/hooks.json`
 *
 * Codex hook event support map (vs. Lisa's existing Claude Code hooks),
 * verified against codex-cli 0.125.0 by source-read + runtime tests:
 *   - SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, Stop  ✅
 *   - PermissionRequest                                             ✅ (Codex-only)
 *   - SubagentStart, SessionEnd, Notification, PreCompact           ❌ (Codex doesn't have these)
 *
 * Claude hooks intentionally NOT ported (no Codex equivalent):
 *   - enforce-team-first.sh — gates Claude's TeamCreate/Skill/ToolSearch agent-
 *     team orchestration; Codex's multi-agent model is different.
 *   - inject-flow-context.sh — fires on SubagentStart, which Codex lacks.
 *   - the SessionEnd `entire` hook — Codex has no SessionEnd event.
 * inject-rules also fires on SubagentStart under Claude; on Codex only its
 * SessionStart variant applies (Codex has no per-subagent start event).
 *
 * Codex plugin installation has user scope, so Lisa never activates the
 * plugin-bundled form. This installer is the canonical delivery path and writes
 * only into the host project's `.codex/` directory.
 * @module codex/hooks-installer
 */
import * as fse from "fs-extra";
import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectType } from "../core/config.js";
import { mirrorLisaRules } from "../core/lisa-rules-mirror.js";
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

/**
 * Shared shell helper sourced by every edit-aware hook to resolve the file
 * path(s) a tool touches (handles single-file Edit/Write and multi-file
 * apply_patch). Copied alongside the hook scripts whenever an edit hook is
 * installed so the apply_patch parsing lives in exactly one place.
 */
export const EDIT_PATHS_LIB = "_extract-edit-paths.sh";

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
const HARPER_PLUGIN = "lisa-harper-fabric";

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
  /** Plugin source for stack-specific scripts not bundled under src/codex. */
  readonly sourcePlugin?: string;
  /** Project types this hook should install for. Use `["*"]` for all stacks. */
  readonly forProjectTypes: readonly (ProjectType | "*")[];
  /** Optional human-readable status message Codex shows during the hook */
  readonly statusMessage?: string;
  /**
   * Whether the script sources the shared `_extract-edit-paths.sh` helper.
   * When any installed hook sets this, the helper is copied alongside the
   * scripts so the apply_patch path parsing stays in one place.
   */
  readonly needsEditPathLib?: boolean;
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
    id: "install-pkgs",
    event: "SessionStart",
    matcher: "startup",
    scriptFilename: "install-pkgs.sh",
    forProjectTypes: ["*"],
    statusMessage: "Checking project dependencies",
  },
  {
    id: "setup-jira-cli",
    event: "SessionStart",
    matcher: "",
    scriptFilename: "setup-jira-cli.sh",
    forProjectTypes: ["*"],
    statusMessage: "Preparing Jira CLI configuration",
  },
  {
    id: "block-no-verify",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFilename: "block-no-verify.sh",
    forProjectTypes: ["*"],
    statusMessage: "Checking shell command policy",
  },
  {
    id: "shell-write-nudge",
    event: "PostToolUse",
    matcher: "Bash",
    scriptFilename: "shell-write-nudge.sh",
    forProjectTypes: ["*"],
    statusMessage: "Checking shell write visibility",
  },
  {
    id: "format-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "format-on-edit.sh",
    forProjectTypes: ["typescript"],
    needsEditPathLib: true,
  },
  {
    id: "lint-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "lint-on-edit.sh",
    forProjectTypes: ["typescript"],
    needsEditPathLib: true,
  },
  {
    id: "sg-scan-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "sg-scan-on-edit.sh",
    forProjectTypes: ["typescript", "rails"],
    needsEditPathLib: true,
  },
  {
    id: "rubocop-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "rubocop-on-edit.sh",
    forProjectTypes: ["rails"],
    needsEditPathLib: true,
  },
  {
    id: "block-migration-edits",
    event: "PreToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "block-migration-edits.sh",
    forProjectTypes: ["nestjs"],
    needsEditPathLib: true,
  },
  {
    id: "block-suppress-directives",
    event: "PreToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "block-suppress-directives.sh",
    forProjectTypes: ["typescript"],
    statusMessage: "Checking for error-suppression directives",
  },
  {
    id: "block-generated-artifact-edits",
    event: "PreToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "block-generated-artifact-edits.sh",
    sourcePlugin: HARPER_PLUGIN,
    forProjectTypes: ["harper-fabric"],
    needsEditPathLib: true,
  },
  {
    id: "enforce-config-extensions",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "enforce-config-extensions.sh",
    sourcePlugin: HARPER_PLUGIN,
    forProjectTypes: ["harper-fabric"],
    needsEditPathLib: true,
  },
];

/** Result of the hooks install pass */
export interface HooksInstallResult {
  /** Files written, relative to `.codex/`. Used to update the manifest. */
  readonly managedFiles: readonly string[];
  /** Number of Lisa hook entries written into hooks.json */
  readonly hookEntries: number;
  /** Stale Lisa-owned hook/rule files removed from the project. */
  readonly deleted: readonly string[];
}

/**
 * Install Lisa hook scripts + rules + hooks.json entries.
 * @param lisaDir - Absolute path to the Lisa repo root (or installed package)
 * @param destDir - Absolute path to the host project root
 * @param detectedTypes - Project types Lisa detected; used to filter stack-
 *   specific hooks. Always includes the universal hooks regardless.
 * @param previousManagedFiles - Files Lisa managed on the previous run.
 * @returns Result describing what was written
 */
export async function installHooks(
  lisaDir: string,
  destDir: string,
  detectedTypes: readonly ProjectType[],
  previousManagedFiles: readonly string[] = []
): Promise<HooksInstallResult> {
  const codexDir = path.join(destDir, ".codex");
  const hooksDir = path.join(codexDir, LISA_HOOKS_SUBDIR);
  const rulesDir = path.join(codexDir, LISA_RULES_SUBDIR);
  await fse.ensureDir(hooksDir);
  await fse.ensureDir(rulesDir);

  const applicable = filterCatalogByTypes(detectedTypes);

  // Step 1: link every applicable script and collect their relative paths
  const scriptFiles: readonly string[] = await Promise.all(
    applicable.map(async entry => {
      const scriptSource = resolveHookScript(lisaDir, entry);
      const scriptDest = path.join(hooksDir, entry.scriptFilename);
      await linkManagedFile(scriptSource, scriptDest);
      return path.join(LISA_HOOKS_SUBDIR, entry.scriptFilename);
    })
  );

  // Step 1b: link the shared edit-path helper when any installed hook sources
  // it. Edit-aware hooks (format/lint/sg-scan/rubocop/block-migration) source
  // this for apply_patch path parsing.
  const libFiles: readonly string[] = applicable.some(e => e.needsEditPathLib)
    ? await (async () => {
        const libDest = path.join(hooksDir, EDIT_PATHS_LIB);
        await linkManagedFile(resolveBundledScript(EDIT_PATHS_LIB), libDest);
        return [path.join(LISA_HOOKS_SUBDIR, EDIT_PATHS_LIB)];
      })()
    : [];

  const harperSupportFiles: readonly string[] = applicable.some(
    entry => entry.sourcePlugin === HARPER_PLUGIN
  )
    ? await linkHarperSupportFiles(lisaDir, hooksDir)
    : [];

  // Step 2: mirror rules from Lisa into .codex/lisa-rules/ (only when
  // inject-rules is being installed — i.e., always, since it's a "*" hook)
  const ruleFiles: readonly string[] = applicable.some(
    e => e.id === "inject-rules"
  )
    ? (await mirrorLisaRules(lisaDir, rulesDir, detectedTypes, "link")).map(
        file => path.join(LISA_RULES_SUBDIR, file)
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

  const managedFiles = [
    ...scriptFiles,
    ...libFiles,
    ...harperSupportFiles,
    ...ruleFiles,
    HOOKS_FILENAME,
  ];
  const deleted = await deleteStaleHookFiles(
    previousManagedFiles,
    new Set(managedFiles),
    codexDir
  );

  return {
    managedFiles: Object.freeze(managedFiles),
    hookEntries: lisaHookSpecs.length,
    deleted: Object.freeze(deleted),
  };
}

/** Project-local directory prefixes wholly owned by the hook installer. */
const MANAGED_HOOK_PREFIXES = [
  `${LISA_HOOKS_SUBDIR}${path.sep}`,
  `${LISA_RULES_SUBDIR}${path.sep}`,
] as const;

/**
 * Delete hook scripts and mirrored rules that disappeared from the applicable
 * project stack. Files outside Lisa-owned directories are never considered.
 * @param previousManagedFiles Previous `.codex/.lisa-managed.json` file list.
 * @param currentManagedFiles Current hook/rule file set.
 * @param codexDir Absolute project `.codex` directory.
 * @returns Sorted relative paths that were removed.
 */
async function deleteStaleHookFiles(
  previousManagedFiles: readonly string[],
  currentManagedFiles: ReadonlySet<string>,
  codexDir: string
): Promise<readonly string[]> {
  const stale = previousManagedFiles
    .filter(file =>
      MANAGED_HOOK_PREFIXES.some(prefix => file.startsWith(prefix))
    )
    .filter(file => !currentManagedFiles.has(file))
    .sort((left, right) => left.localeCompare(right));

  await Promise.all(
    stale.map(file => rm(path.join(codexDir, file), { force: true }))
  );
  return stale;
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
 * Resolve either a bundled Codex script or a selected stack-plugin script.
 * @param lisaDir Lisa package root.
 * @param entry Hook catalog entry.
 * @returns Absolute hook script path.
 */
function resolveHookScript(lisaDir: string, entry: HookCatalogEntry): string {
  return entry.sourcePlugin === undefined
    ? resolveBundledScript(entry.scriptFilename)
    : path.join(
        lisaDir,
        "plugins",
        entry.sourcePlugin,
        "hooks",
        entry.scriptFilename
      );
}

/**
 * Link Harper hook companion files beside their project-local wrappers.
 * @param lisaDir Lisa package root.
 * @param hooksDir Project-local hook directory.
 * @returns Managed paths relative to `.codex/`.
 */
async function linkHarperSupportFiles(
  lisaDir: string,
  hooksDir: string
): Promise<readonly string[]> {
  const sources = [
    {
      source: path.join(
        lisaDir,
        "plugins",
        HARPER_PLUGIN,
        "hooks",
        "enforce-config-extensions.mjs"
      ),
      filename: "enforce-config-extensions.mjs",
    },
    {
      source: path.join(
        lisaDir,
        "plugins",
        HARPER_PLUGIN,
        "generated-artifact-globs.txt"
      ),
      filename: "generated-artifact-globs.txt",
    },
  ] as const;
  await Promise.all(
    sources.map(({ source, filename }) =>
      linkManagedFile(source, path.join(hooksDir, filename))
    )
  );
  return sources.map(({ filename }) => path.join(LISA_HOOKS_SUBDIR, filename));
}

/**
 * Replace a Lisa-owned project file with a link to its package source.
 * @param source Absolute package source path.
 * @param destination Absolute project link path.
 */
async function linkManagedFile(
  source: string,
  destination: string
): Promise<void> {
  await rm(destination, { force: true });
  await symlink(
    source,
    destination,
    process.platform === "win32" ? "file" : undefined
  );
}
/* eslint-enable max-lines -- restore the repository default */
