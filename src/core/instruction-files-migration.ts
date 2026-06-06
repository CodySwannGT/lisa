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
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
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

/**
 * Marker that opened the legacy agy "baked rules" block in `AGENTS.md`. Retained
 * here (after the agy AGENTS.md installer was removed) so the migration can
 * recognize and strip blocks written by older Lisa versions.
 */
export const LISA_RULES_START_MARKER = "<!-- LISA_RULES_START -->";
/** Marker that closed the legacy agy "baked rules" block in `AGENTS.md`. */
export const LISA_RULES_END_MARKER = "<!-- LISA_RULES_END -->";

/** Outcome of an instruction-files migration pass. */
export interface InstructionFilesMigrationResult {
  /** True when any file was created or modified. */
  readonly changed: boolean;
  /** Human-readable description of each action taken (empty when no-op). */
  readonly actions: readonly string[];
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
 * Ensure a canonical `AGENTS.md` exists and carries no legacy agy baked-rules
 * block.
 * @param destDir - Absolute path to the host project root.
 * @returns Action strings describing what changed (empty when nothing did).
 */
async function reconcileAgentsMd(destDir: string): Promise<string[]> {
  const filePath = path.join(destDir, AGENTS_MD_FILENAME);
  if (!existsSync(filePath)) {
    const result = await installAgentsMd(destDir);
    return result.created ? [`created ${AGENTS_MD_FILENAME}`] : [];
  }
  const existing = await readFile(filePath, "utf8");
  const stripped = stripBakedAgyRulesBlock(existing);
  if (stripped === existing) {
    return [];
  }
  await writeFile(filePath, stripped, "utf8");
  return [`removed legacy baked-rules block from ${AGENTS_MD_FILENAME}`];
}

/**
 * Ensure `CLAUDE.md` imports the canonical `AGENTS.md`.
 *
 * Creates the pointer file when no `CLAUDE.md` exists, or prepends the
 * `@AGENTS.md` import to an existing host-authored file (preserving its content).
 * @param destDir - Absolute path to the host project root.
 * @returns Action strings describing what changed (empty when nothing did).
 */
async function reconcileClaudeMd(destDir: string): Promise<string[]> {
  const filePath = path.join(destDir, CLAUDE_MD_FILENAME);
  if (!existsSync(filePath)) {
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
 * Run the instruction-files migration against a host project root.
 * @param destDir - Absolute path to the host project root.
 * @returns Whether anything changed plus a description of each action.
 */
export async function migrateInstructionFiles(
  destDir: string
): Promise<InstructionFilesMigrationResult> {
  const agentsActions = await reconcileAgentsMd(destDir);
  const claudeActions = await reconcileClaudeMd(destDir);
  const actions = [...agentsActions, ...claudeActions];
  return { changed: actions.length > 0, actions };
}
