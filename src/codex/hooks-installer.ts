/**
 * Install Lisa-managed Codex hooks into a host project.
 *
 * Pipeline:
 *   1. Filter hook catalog by detected project types
 *   2. Copy each script from `src/codex/scripts/` → `.codex/hooks/lisa/`
 *   3. For inject-rules: also mirror Lisa rules into `.codex/lisa-rules/`
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
 * Codex does NOT execute plugin-bundled hooks (a `.codex-plugin` `hooks`
 * pointer / `hooks/hooks.json` never fires), so this installer writes hooks
 * into the project's own `.codex/hooks.json` instead. See
 * scripts/generate-codex-plugin-artifacts.mjs for the build-side counterpart.
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

  // Step 1b: copy the shared edit-path helper when any installed hook sources
  // it. Edit-aware hooks (format/lint/sg-scan/rubocop/block-migration) source
  // this for apply_patch path parsing.
  const libFiles: readonly string[] = applicable.some(e => e.needsEditPathLib)
    ? await (async () => {
        const libDest = path.join(hooksDir, EDIT_PATHS_LIB);
        await copyFile(resolveBundledScript(EDIT_PATHS_LIB), libDest);
        await chmod(libDest, 0o755);
        return [path.join(LISA_HOOKS_SUBDIR, EDIT_PATHS_LIB)];
      })()
    : [];

  // Step 2: mirror rules from Lisa into .codex/lisa-rules/ (only when
  // inject-rules is being installed — i.e., always, since it's a "*" hook)
  const ruleFiles: readonly string[] = applicable.some(
    e => e.id === "inject-rules"
  )
    ? (await mirrorRules(lisaDir, rulesDir, detectedTypes)).map(file =>
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
    managedFiles: Object.freeze([
      ...scriptFiles,
      ...libFiles,
      ...ruleFiles,
      HOOKS_FILENAME,
    ]),
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
 * Subdirectories under each plugin's rules/ that carry rule .md files.
 * The split is:
 *   - eager/     — load-bearing prescriptions injected at every SessionStart
 *   - reference/ — long-form bodies mirrored alongside; loaded on demand via
 *                  the breadcrumb the eager head points to
 * For backward compatibility with older plugin builds, .md files directly
 * under rules/ (flat, no subdir) are also mirrored.
 */
const RULE_SUBDIRS = ["eager", "reference"] as const;

/**
 * Copy every .md file from Lisa's base and detected stack plugin `rules/`
 * directories into the host's `.codex/lisa-rules/`, preserving the
 * `eager/` and `reference/` subdir structure.
 * @param lisaDir - Absolute path to the Lisa repo / installed package
 * @param rulesDestDir - Absolute path to `<destDir>/.codex/lisa-rules/`
 * @param detectedTypes - Project types Lisa detected for the host
 * @returns Relative paths (subdir/file or file) of every rule .md file copied
 */
async function mirrorRules(
  lisaDir: string,
  rulesDestDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<readonly string[]> {
  const pluginNames = ["lisa", ...detectedTypes.map(type => `lisa-${type}`)];

  // First pass: list all .md files per plugin (eager/, reference/, and flat
  // root for backward compat) without copying. Entries are built immutably
  // with flatMap/concat so each plugin's collected files are a derived value
  // rather than a mutated buffer (project functional/immutable-data rule).
  const filesByPlugin = await Promise.all(
    pluginNames.map(async pluginName => {
      const rulesRoot = path.join(lisaDir, "plugins", pluginName, "rules");
      if (!(await fse.pathExists(rulesRoot))) {
        return { rulesRoot, entries: [] as readonly RuleFileEntry[] };
      }

      // Subdir entries: eager/*.md, reference/*.md
      const subdirEntriesByDir = await Promise.all(
        RULE_SUBDIRS.map(async sub => {
          const subDir = path.join(rulesRoot, sub);
          if (!(await fse.pathExists(subDir))) {
            return [] as readonly RuleFileEntry[];
          }
          const subFiles = (await readdir(subDir)).filter(name =>
            name.endsWith(".md")
          );
          return subFiles.map<RuleFileEntry>(file => ({
            absSource: path.join(subDir, file),
            relPath: path.join(sub, file),
          }));
        })
      );

      // Backward-compat: flat rules/*.md (older plugin builds that haven't
      // adopted the eager/reference split yet). Only direct .md children
      // count; files inside subdirs are handled by the subdir pass.
      const rootChildren = await readdir(rulesRoot, { withFileTypes: true });
      const flatEntries: readonly RuleFileEntry[] = rootChildren
        .filter(d => d.isFile() && d.name.endsWith(".md"))
        .map<RuleFileEntry>(d => ({
          absSource: path.join(rulesRoot, d.name),
          relPath: d.name,
        }));

      const entries: readonly RuleFileEntry[] = [
        ...subdirEntriesByDir.flat(),
        ...flatEntries,
      ];

      return { rulesRoot, entries };
    })
  );

  // Detect relative-path collisions before performing any copies. Subdir
  // structure is preserved, so two plugins shipping "eager/base-rules.md"
  // would collide, but "eager/foo.md" and "reference/foo.md" do not.
  const allRelPaths = filesByPlugin.flatMap(({ entries }) =>
    entries.map(e => e.relPath)
  );
  if (new Set(allRelPaths).size !== allRelPaths.length) {
    const duplicate = allRelPaths.find(
      (name, index) => allRelPaths.indexOf(name) !== index
    );
    throw new Error(
      `Duplicate Lisa rule path "${duplicate ?? "unknown"}" across plugin rules/ directories`
    );
  }

  // Ensure destination subdirs exist before copying. fs-extra's ensureDir is
  // idempotent and cheap.
  await Promise.all(
    RULE_SUBDIRS.map(sub => fse.ensureDir(path.join(rulesDestDir, sub)))
  );

  // Second pass: copy files now that we know there are no collisions.
  await Promise.all(
    filesByPlugin.flatMap(({ entries }) =>
      entries.map(entry =>
        copyFile(entry.absSource, path.join(rulesDestDir, entry.relPath))
      )
    )
  );

  return Object.freeze(allRelPaths);
}

/** One rule file slated for mirroring, with the destination-relative path. */
type RuleFileEntry = {
  readonly absSource: string;
  readonly relPath: string;
};
