/**
 * Hook catalog shared by the legacy Codex hook installer and its loaded-session
 * compatibility pass: the stable list of Lisa-shipped Codex hooks, the names
 * of the directories and helpers they install into, and the pure helpers that
 * select and resolve catalog entries.
 *
 * Lives beside `hooks-installer.ts` because `resolveBundledScript` resolves
 * scripts relative to this module's own location (`./scripts/`).
 * @module codex/hooks-catalog
 */
import { readFile, rm, symlink } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fse from "fs-extra";
import { RAILS_HOOK_ENGINE_FILES } from "../../scripts/lib/rails-hooks.mjs";
import type { ProjectType } from "../core/config.js";
import {
  type CodexHookEvent,
  type HooksFile,
  type LisaHookSpec,
  parseHooksFile,
} from "./hooks-merger.js";

/** A shipped source file and the basename it is installed under. */
export interface HookSupportSource {
  readonly source: string;
  readonly filename: string;
}

/** Subdirectory inside `.codex/` for Lisa-managed hook scripts */
export const LISA_HOOKS_SUBDIR = path.join("hooks", "lisa");

/**
 * Shared shell helper sourced by every edit-aware hook to resolve the file
 * path(s) a tool touches (handles single-file Edit/Write and multi-file
 * apply_patch). Copied alongside the hook scripts whenever an edit hook is
 * installed so the apply_patch parsing lives in exactly one place.
 */
export const EDIT_PATHS_LIB = "_extract-edit-paths.sh";

/**
 * Shared shell helper sourced by every edit-time hook to resolve the project's
 * gate declaration before the hook reaches for its own tool. Copied alongside
 * the hook scripts whenever an installed hook sources it.
 *
 * Absent from this installer until #3007, while six scripts sourced it. See
 * `needsEditGate` for what that absence did.
 */
export const EDIT_GATE_LIB = "lisa-edit-gate.sh";

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
export const INJECT_RULES_ID = "inject-rules";
export const INSTALL_RAILS_HOOKS_ID = "install-rails-hooks";
export const HARPER_PLUGIN = "lisa-harper-fabric";

/** Stable definition of one Lisa-shipped Codex hook */
export interface HookCatalogEntry {
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
  /**
   * Whether the script sources the shared `lisa-edit-gate.sh` façade helper.
   *
   * MEASURED, and it was the gap that made the façade inert on this surface.
   * Four scripts sourced `${SCRIPT_DIR}/lisa-edit-gate.sh` from the moment the
   * façade shipped and nothing here ever copied it: a sourced file that is
   * absent fails quietly under `set -uo pipefail` — there is no `-e` — so
   * `lisa_edit_gate_tasks` was simply not a command, the `if` was false, and
   * every hook fell through to its built-in while reading as wired. A project
   * could declare a gate at either tool moment and Codex would never see it.
   */
  readonly needsEditGate?: boolean;
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
export const HOOK_CATALOG: readonly HookCatalogEntry[] = [
  {
    id: INJECT_RULES_ID,
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
    id: INSTALL_RAILS_HOOKS_ID,
    event: "SessionStart",
    matcher: "startup",
    scriptFilename: "install-rails-hooks.sh",
    sourcePlugin: "lisa",
    forProjectTypes: ["*"],
    statusMessage: "Checking Rails Git hook installation",
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
    id: "block-direct-issue-create",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFilename: "block-direct-issue-create.sh",
    sourcePlugin: "lisa",
    forProjectTypes: ["*"],
    statusMessage: "Checking work-item filing policy",
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
    needsEditGate: true,
  },
  {
    id: "lint-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "lint-on-edit.sh",
    forProjectTypes: ["typescript"],
    needsEditPathLib: true,
    needsEditGate: true,
  },
  {
    id: "sg-scan-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "sg-scan-on-edit.sh",
    forProjectTypes: ["typescript", "rails"],
    needsEditPathLib: true,
    needsEditGate: true,
  },
  {
    id: "rubocop-on-edit",
    event: "PostToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "rubocop-on-edit.sh",
    forProjectTypes: ["rails"],
    needsEditPathLib: true,
    needsEditGate: true,
  },
  {
    id: "block-migration-edits",
    event: "PreToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "block-migration-edits.sh",
    forProjectTypes: ["nestjs"],
    needsEditPathLib: true,
    needsEditGate: true,
  },
  {
    id: "block-suppress-directives",
    event: "PreToolUse",
    matcher: WRITE_MATCHER,
    scriptFilename: "block-suppress-directives.sh",
    forProjectTypes: ["typescript"],
    statusMessage: "Checking for error-suppression directives",
    needsEditPathLib: true,
    needsEditGate: true,
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

/**
 * Every bundled Codex script that fires on the agent write boundary.
 *
 * DERIVED from the catalog above rather than listed, so a hook added to a tool
 * moment tomorrow joins the controls that read this with no test edited. That
 * matters here specifically: the population those controls used before #3007
 * was globbed as `-on-edit.sh`, a naming convention rather than a moment, and
 * the two `PreToolUse` refusal hooks fell outside it while firing on exactly
 * the same boundary.
 *
 * Scripts sourced from another plugin are excluded — they are that plugin's
 * artifacts, not this catalog's, and they are not resolved out of
 * `src/codex/scripts`.
 */
export const EDIT_TIME_HOOK_SCRIPTS: readonly string[] = Object.freeze(
  HOOK_CATALOG.filter(
    entry => entry.matcher === WRITE_MATCHER && entry.sourcePlugin === undefined
  ).map(entry => entry.scriptFilename)
);

/**
 * Filter the catalog by detected project types. Universal hooks (`"*"`)
 * always pass; stack-specific hooks pass only if their type is detected.
 * @param detectedTypes - Project types Lisa detected for the host
 * @returns The catalog entries that apply to this host
 */
export function filterCatalogByTypes(
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
export function catalogEntryToSpec(
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
export async function readHooksFile(hooksFilePath: string): Promise<HooksFile> {
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
export function resolveBundledScript(filename: string): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(moduleDir, "scripts", filename);
}

/**
 * Resolve either a bundled Codex script or a selected stack-plugin script.
 * @param lisaDir Lisa package root.
 * @param entry Hook catalog entry.
 * @returns Absolute hook script path.
 */
export function resolveHookScript(
  lisaDir: string,
  entry: HookCatalogEntry
): string {
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
 * Complete runtime closure for linked hooks and copied loaded-session hooks.
 * @param lisaDir - Lisa package root
 * @returns Canonical source and installed basename for each required asset
 */
export function railsHookSupportSources(
  lisaDir: string
): readonly HookSupportSource[] {
  return [
    {
      source: path.join(lisaDir, "plugins/lisa/hooks/install-rails-hooks.mjs"),
      filename: "install-rails-hooks.mjs",
    },
    ...RAILS_HOOK_ENGINE_FILES.map(filename => ({
      source: path.join(lisaDir, "scripts/lib", filename),
      filename,
    })),
  ];
}

/**
 * Companion sources shared by linked installation and copied compatibility.
 * @param lisaDir Lisa package root.
 * @returns Complete Harper companion list.
 */
export function harperSupportSources(
  lisaDir: string
): readonly HookSupportSource[] {
  return [
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
}

/**
 * Replace a Lisa-owned project file with a link to its package source.
 * @param source Absolute package source path.
 * @param destination Absolute project link path.
 */
export async function linkManagedFile(
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
