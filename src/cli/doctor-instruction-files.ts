import { existsSync } from "node:fs";
import * as path from "node:path";
import { AGENTS_MD_FILENAME } from "../codex/agents-md-installer.js";
import { CLAUDE_MD_FILENAME } from "../claude/claude-md-installer.js";
import { migrateInstructionFiles } from "../core/instruction-files-migration.js";
import type { DoctorCheck } from "./doctor.js";

const INSTRUCTION_FILES_CHECK_NAME = "Instruction files canonical?";

/**
 * Determine whether a path looks like an agent-governed project, i.e. one that
 * should carry the canonical `AGENTS.md` / `CLAUDE.md` pointer pattern. True
 * when a Lisa config or either instruction file already exists — this keeps the
 * mutating migration from touching unrelated, non-Lisa directories.
 * @param targetPath - Project path to inspect
 * @returns True when the path is an agent/Lisa project
 */
function looksLikeAgentProject(targetPath: string): boolean {
  return [
    ".lisa.config.json",
    ".lisa.config.local.json",
    AGENTS_MD_FILENAME,
    CLAUDE_MD_FILENAME,
  ].some(fileName => existsSync(path.join(targetPath, fileName)));
}

/**
 * Ensure the project's agent instruction files follow Lisa's canonical pattern
 * (canonical `AGENTS.md` + a thin `CLAUDE.md` that `@AGENTS.md`-imports it) and
 * carry no legacy agy baked-rules block. This check is mutating: it repairs
 * existing projects in place, non-destructively (host content is preserved).
 * @param targetPath - Project path to inspect and repair
 * @returns Doctor check result describing what, if anything, was changed
 */
export async function checkInstructionFiles(
  targetPath: string
): Promise<DoctorCheck> {
  if (!looksLikeAgentProject(targetPath)) {
    return {
      name: INSTRUCTION_FILES_CHECK_NAME,
      status: "ok",
      detail: "Not a Lisa/agent project; skipped",
    };
  }

  try {
    const result = await migrateInstructionFiles(targetPath);
    return {
      name: INSTRUCTION_FILES_CHECK_NAME,
      status: "ok",
      detail: result.changed
        ? `Repaired: ${result.actions.join("; ")}`
        : "Already canonical (AGENTS.md source of truth, CLAUDE.md imports it)",
    };
  } catch (error) {
    return {
      name: INSTRUCTION_FILES_CHECK_NAME,
      status: "fail",
      detail: `Could not reconcile instruction files: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
