/**
 * Migrate a host project's agent instruction files to Lisa's canonical pattern:
 *
 *   - `AGENTS.md` is the single, cross-agent instruction file (read natively by
 *     Codex, Cursor, Copilot, and agy).
 *   - `CLAUDE.md` is a thin pointer that `@AGENTS.md`-imports it (Claude Code
 *     does not read AGENTS.md natively).
 *
 * This is the non-destructive, idempotent cleanup `lisa doctor` runs on existing
 * projects that predate the pattern. It:
 *
 *   1. Creates a canonical `AGENTS.md` when one is missing.
 *   2. Strips the legacy agy "baked rules" block
 *      (`<!-- LISA_RULES_START -->...<!-- LISA_RULES_END -->`) from an existing
 *      `AGENTS.md` — Lisa no longer bakes rule bodies into the file.
 *   3. Ensures `CLAUDE.md` imports `AGENTS.md`: creates the pointer when no
 *      `CLAUDE.md` exists, or prepends the `@AGENTS.md` import to an existing
 *      host-authored `CLAUDE.md` (preserving all existing content).
 *
 * Host content is never deleted: the only thing removed is the clearly
 * Lisa-managed agy marker block. Everything else is additive.
 * @module core/instruction-files-migration
 */
import * as fse from "fs-extra";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  AGENTS_MD_FILENAME,
  installAgentsMd,
} from "../codex/agents-md-installer.js";
import {
  CLAUDE_MD_AGENTS_IMPORT,
  CLAUDE_MD_FILENAME,
  installClaudeMd,
} from "../claude/claude-md-installer.js";
import { harnessIncludesAgent } from "./config.js";
import {
  assertSafeLearningParents,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import {
  readProjectConfig,
  resolveLegacyProjectLearningsFile,
  resolveProjectLearningsFile,
} from "./project-config.js";

/**
 * Marker that opened the legacy agy "baked rules" block in `AGENTS.md`. Retained
 * here (after the agy AGENTS.md installer was removed) so the migration can
 * recognize and strip blocks written by older Lisa versions.
 */
export const LISA_RULES_START_MARKER = "<!-- LISA_RULES_START -->";
/** Marker that closed the legacy agy "baked rules" block in `AGENTS.md`. */
export const LISA_RULES_END_MARKER = "<!-- LISA_RULES_END -->";
/** Marker opening Lisa's bounded Antigravity project-learnings bridge. */
export const LISA_PROJECT_LEARNINGS_START_MARKER =
  "<!-- LISA_PROJECT_LEARNINGS_START -->";
/** Marker closing Lisa's bounded Antigravity project-learnings bridge. */
export const LISA_PROJECT_LEARNINGS_END_MARKER =
  "<!-- LISA_PROJECT_LEARNINGS_END -->";

/** Outcome of an instruction-files migration pass. */
export interface InstructionFilesMigrationResult {
  /** True when any file was created or modified. */
  readonly changed: boolean;
  /** Human-readable description of each action taken (empty when no-op). */
  readonly actions: readonly string[];
}

/** Outcome of the learnings-ledger relocation. */
export interface LearningsRelocationResult {
  /** True when the ledger was moved from its legacy to its new location. */
  readonly moved: boolean;
  /** Info line describing the completed move (present only when moved). */
  readonly action?: string;
  /**
   * Warning line when both the legacy and new ledgers exist. Neither file is
   * touched — a human reconciles — so re-runs keep surfacing it until resolved.
   */
  readonly warning?: string;
}

/**
 * Relocate the machine-managed learnings ledger from its legacy location (the
 * sibling of `projectRulesFile`, inside an auto-loaded rules tree) to the new
 * canonical `.lisa/PROJECT_LEARNINGS.md`. Runs during `lisa apply`/`doctor`
 * reconciliation.
 *
 * Move semantics (all idempotent):
 *   - legacy present, new absent → move byte-for-byte, remove the legacy file.
 *   - both present → do NOT clobber; keep both and warn once, naming both
 *     paths, so a human decides which to keep.
 *   - legacy absent (or already relocated) → quiet no-op.
 *
 * The move preserves bytes exactly (read buffer, write, unlink) rather than
 * trusting a same-filesystem rename, so it also works across mount boundaries.
 * @param destDir - Absolute path to the host project root.
 * @returns Whether the ledger moved, plus an info or warning line.
 */
export async function relocateProjectLearningsLedger(
  destDir: string
): Promise<LearningsRelocationResult> {
  const config = await readProjectConfig(destDir);
  const legacyRelative = resolveLegacyProjectLearningsFile(config);
  const targetRelative = resolveProjectLearningsFile(config);
  if (legacyRelative === targetRelative) {
    return { moved: false };
  }
  const legacyPath = path.join(destDir, legacyRelative);
  if (!existsSync(legacyPath)) {
    return { moved: false };
  }
  // Resolve and containment-check the target the same way the writers do, so
  // doctor's direct path is as guarded as apply's — a symlinked parent that
  // escapes the project root throws before any bytes are written.
  const { root, target } = resolveSafeLearningTarget(destDir, targetRelative);
  if (existsSync(target)) {
    return {
      moved: false,
      warning: `Learnings ledger exists at BOTH ${legacyRelative} and ${targetRelative}. Keeping both untouched. The canonical location is ${targetRelative} — copy any entries you want to keep into it, then delete ${legacyRelative}.`,
    };
  }
  await assertSafeLearningParents(root, path.dirname(target));
  const contents = await readFile(legacyPath);
  await fse.ensureDir(path.dirname(target));
  await writeFile(target, contents);
  await rm(legacyPath);
  return {
    moved: true,
    action: `moved learnings ledger ${legacyRelative} -> ${targetRelative}`,
  };
}

/** Options controlling the instruction-files migration. */
export interface MigrateInstructionFilesOptions {
  /**
   * Whether to create a `CLAUDE.md` pointer when none exists. Defaults to true
   * (doctor's behavior — a project should have a CLAUDE.md so Claude Code reads
   * the canonical AGENTS.md). Set false for harnesses that don't include Claude
   * (e.g. a codex-only `lisa apply`) so no stray `CLAUDE.md` is written; an
   * existing host-authored `CLAUDE.md` still gets the `@AGENTS.md` import either
   * way.
   */
  readonly createClaudePointer?: boolean;
  /**
   * Whether to reconcile the agy project-learnings bridge in `AGENTS.md`.
   * Defaults from `.lisa.config.json`: enabled only when the effective harness
   * includes agy.
   */
  readonly reconcileAgyProjectLearnings?: boolean;
  /**
   * Resolved project-relative learnings path. Defaults to the sibling of the
   * configured `projectRulesFile`.
   */
  readonly projectLearningsFile?: string;
  /**
   * Whether to relocate a legacy ledger as part of this pass. Defaults to true
   * (doctor's behavior). `lisa apply` sets this false because it already runs
   * the relocation in an earlier phase (before the create-only strategy seeds
   * an empty ledger), and re-running it here would re-emit the both-exist
   * warning a second time in the same run.
   */
  readonly relocateLearnings?: boolean;
}

/**
 * Remove a legacy agy `LISA_RULES_START..END` block from an AGENTS.md body,
 * collapsing the whitespace left behind. Returns the original string unchanged
 * when no well-formed block is present.
 * @param body - Existing `AGENTS.md` contents.
 * @returns The body with the Lisa-managed agy block removed.
 */
export function stripBakedAgyRulesBlock(body: string): string {
  const startIdx = body.indexOf(LISA_RULES_START_MARKER);
  const endIdx = body.indexOf(LISA_RULES_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return body;
  }
  const before = body.slice(0, startIdx);
  const after = body.slice(endIdx + LISA_RULES_END_MARKER.length);
  // Collapse 3+ consecutive newlines to two (bounded quantifier for slow-regex).
  return `${(before + after).replace(/\n\n\n+/g, "\n\n").trim()}\n`;
}

/**
 * Remove a managed project-learnings bridge from AGENTS.md. Malformed marker
 * pairs are left unchanged so Lisa never guesses which host bytes to delete.
 * @param body - Existing `AGENTS.md` contents.
 * @returns The body with the managed bridge removed, when a full block exists.
 */
export function stripAgyProjectLearningsBridge(body: string): string {
  return replaceManagedAgyProjectLearningsBridge(body, "");
}

/**
 * Build the exact bounded Antigravity project-learnings bridge block.
 * @param projectLearningsFile - Project-relative resolved learnings path.
 * @returns Managed bridge block with surrounding markers.
 */
export function buildAgyProjectLearningsBridge(
  projectLearningsFile: string
): string {
  return [
    LISA_PROJECT_LEARNINGS_START_MARKER,
    "Antigravity startup bridge: before normal task work, resolve the canonical",
    "machine-managed project-learnings ledger from `.lisa.config.json` (the",
    "optional `learnings.file` override, else the default `.lisa/PROJECT_LEARNINGS.md`).",
    "Consume it only through the Lisa learnings contract's bounded projection — never",
    "read the raw ledger wholesale into context. If it is absent, continue silently.",
    "If it is malformed, warn once and ignore it.",
    "",
    `Resolved path for this project: \`${projectLearningsFile}\`.`,
    LISA_PROJECT_LEARNINGS_END_MARKER,
  ].join("\n");
}

/**
 * Add, replace, or remove the managed project-learnings bridge. Returns the
 * original body unchanged whenever the markers are malformed: only one of the
 * pair is present, the end precedes the start, or either marker occurs more
 * than once.
 * @param body - Existing AGENTS.md body.
 * @param replacement - Full replacement block, or empty string to remove.
 * @returns Updated body, or the original body for malformed markers.
 */
function replaceManagedAgyProjectLearningsBridge(
  body: string,
  replacement: string
): string {
  const startIdx = body.indexOf(LISA_PROJECT_LEARNINGS_START_MARKER);
  const endIdx = body.indexOf(LISA_PROJECT_LEARNINGS_END_MARKER);
  const hasStart = startIdx !== -1;
  const hasEnd = endIdx !== -1;
  const hasDuplicateStart =
    hasStart &&
    body.indexOf(
      LISA_PROJECT_LEARNINGS_START_MARKER,
      startIdx + LISA_PROJECT_LEARNINGS_START_MARKER.length
    ) !== -1;
  const hasDuplicateEnd =
    hasEnd &&
    body.indexOf(
      LISA_PROJECT_LEARNINGS_END_MARKER,
      endIdx + LISA_PROJECT_LEARNINGS_END_MARKER.length
    ) !== -1;
  if (
    hasStart !== hasEnd ||
    (hasStart && endIdx < startIdx) ||
    hasDuplicateStart ||
    hasDuplicateEnd
  ) {
    return body;
  }
  if (!hasStart) {
    if (replacement === "") {
      return body;
    }
    const separator = body.endsWith("\n") ? "\n" : "\n\n";
    return `${body}${separator}${replacement}\n`;
  }
  const before = body.slice(0, startIdx);
  const after = body.slice(endIdx + LISA_PROJECT_LEARNINGS_END_MARKER.length);
  const next = `${before}${replacement}${after}`;
  return `${next.replace(/\n\n\n+/g, "\n\n").trim()}\n`;
}

/**
 * Ensure a canonical `AGENTS.md` exists and carries no legacy agy baked-rules
 * block.
 * @param destDir - Absolute path to the host project root.
 * @param agyProjectLearnings - Desired state for the Antigravity bridge.
 * @param agyProjectLearnings.enabled - Whether the bridge should be present.
 * @param agyProjectLearnings.projectLearningsFile - Resolved project-relative
 *   learnings file path to include in the bridge.
 * @returns Action strings describing what changed (empty when nothing did).
 */
async function reconcileAgentsMd(
  destDir: string,
  agyProjectLearnings: {
    readonly enabled: boolean;
    readonly projectLearningsFile: string;
  }
): Promise<string[]> {
  const filePath = path.join(destDir, AGENTS_MD_FILENAME);
  if (!existsSync(filePath)) {
    const result = await installAgentsMd(destDir);
    const actions = result.created ? [`created ${AGENTS_MD_FILENAME}`] : [];
    return [
      ...actions,
      ...(await reconcileAgyProjectLearningsBridge(
        filePath,
        agyProjectLearnings
      )),
    ];
  }
  return reconcileAgyProjectLearningsBridge(filePath, agyProjectLearnings);
}

/**
 * Reconcile the removable legacy bake and the bounded agy learnings bridge.
 * @param filePath - Absolute AGENTS.md path.
 * @param agyProjectLearnings - Desired bridge state.
 * @param agyProjectLearnings.enabled - Whether the bridge should be present.
 * @param agyProjectLearnings.projectLearningsFile - Resolved project-relative
 *   learnings file path to include in the bridge.
 * @returns Action strings describing changed state.
 */
async function reconcileAgyProjectLearningsBridge(
  filePath: string,
  agyProjectLearnings: {
    readonly enabled: boolean;
    readonly projectLearningsFile: string;
  }
): Promise<string[]> {
  const existing = await readFile(filePath, "utf8");
  const stripped = stripBakedAgyRulesBlock(existing);
  const desired = agyProjectLearnings.enabled
    ? replaceManagedAgyProjectLearningsBridge(
        stripped,
        buildAgyProjectLearningsBridge(agyProjectLearnings.projectLearningsFile)
      )
    : stripAgyProjectLearningsBridge(stripped);
  if (desired === existing) {
    return [];
  }
  await writeFile(filePath, desired, "utf8");
  const bakedRuleActions =
    stripped !== existing
      ? [`removed legacy baked-rules block from ${AGENTS_MD_FILENAME}`]
      : [];
  const bridgeActions =
    desired !== stripped
      ? [
          agyProjectLearnings.enabled
            ? `reconciled agy project-learnings bridge in ${AGENTS_MD_FILENAME}`
            : `removed agy project-learnings bridge from ${AGENTS_MD_FILENAME}`,
        ]
      : [];
  const actions = [...bakedRuleActions, ...bridgeActions];
  return actions;
}

/**
 * Ensure `CLAUDE.md` imports the canonical `AGENTS.md`.
 *
 * Creates the pointer file when no `CLAUDE.md` exists (only when
 * `createIfMissing` is true), or prepends the `@AGENTS.md` import to an existing
 * host-authored file (preserving its content) regardless of `createIfMissing`.
 * @param destDir - Absolute path to the host project root.
 * @param createIfMissing - Whether to create a pointer when no CLAUDE.md exists.
 * @returns Action strings describing what changed (empty when nothing did).
 */
async function reconcileClaudeMd(
  destDir: string,
  createIfMissing: boolean
): Promise<string[]> {
  const filePath = path.join(destDir, CLAUDE_MD_FILENAME);
  if (!existsSync(filePath)) {
    if (!createIfMissing) {
      return [];
    }
    const result = await installClaudeMd(destDir);
    return result.created ? [`created ${CLAUDE_MD_FILENAME} pointer`] : [];
  }
  const existing = await readFile(filePath, "utf8");
  if (existing.includes(CLAUDE_MD_AGENTS_IMPORT)) {
    return [];
  }
  const prefix = `${CLAUDE_MD_AGENTS_IMPORT}\n\n<!-- Lisa: import the canonical AGENTS.md so Claude Code loads the same guidance every other agent reads. -->\n\n`;
  await writeFile(filePath, prefix + existing, "utf8");
  return [`added ${CLAUDE_MD_AGENTS_IMPORT} import to ${CLAUDE_MD_FILENAME}`];
}

/**
 * Relocate the legacy ledger and flatten the result into action strings, unless
 * the caller already ran the relocation in an earlier phase (`enabled` false).
 * @param destDir - Absolute path to the host project root.
 * @param enabled - Whether to run the relocation in this pass.
 * @returns Action/warning strings (empty when disabled or a no-op).
 */
async function collectLearningsRelocationActions(
  destDir: string,
  enabled: boolean
): Promise<string[]> {
  if (!enabled) {
    return [];
  }
  const relocation = await relocateProjectLearningsLedger(destDir);
  return [
    ...(relocation.action === undefined ? [] : [relocation.action]),
    ...(relocation.warning === undefined ? [] : [relocation.warning]),
  ];
}

/**
 * Run the instruction-files migration against a host project root.
 * @param destDir - Absolute path to the host project root.
 * @param options - Migration options (see {@link MigrateInstructionFilesOptions}).
 * @returns Whether anything changed plus a description of each action.
 */
export async function migrateInstructionFiles(
  destDir: string,
  options: MigrateInstructionFilesOptions = {}
): Promise<InstructionFilesMigrationResult> {
  const projectConfig = await readProjectConfig(destDir);
  const createClaudePointer = options.createClaudePointer ?? true;
  const agyProjectLearnings = {
    enabled:
      options.reconcileAgyProjectLearnings ??
      harnessIncludesAgent(projectConfig.harness ?? "claude", "agy"),
    projectLearningsFile:
      options.projectLearningsFile ??
      resolveProjectLearningsFile(projectConfig),
  };
  const relocationActions = await collectLearningsRelocationActions(
    destDir,
    options.relocateLearnings ?? true
  );
  const agentsActions = await reconcileAgentsMd(destDir, agyProjectLearnings);
  const claudeActions = await reconcileClaudeMd(destDir, createClaudePointer);
  const actions = [...relocationActions, ...agentsActions, ...claudeActions];
  return { changed: actions.length > 0, actions };
}
