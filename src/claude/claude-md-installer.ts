/**
 * Write Lisa's CLAUDE.md template for Claude Code host projects.
 *
 * Claude Code auto-loads `CLAUDE.md` from the project tree at session start but,
 * unlike Codex / Cursor / Copilot, does **not** read `AGENTS.md` natively. So
 * Lisa keeps `CLAUDE.md` as a thin pointer: its only meaningful content is an
 * `@AGENTS.md` import, which makes Claude Code load the canonical, cross-agent
 * `AGENTS.md` (see `src/codex/agents-md-installer.ts`) at session start.
 *
 * This single-source-of-truth design avoids the double-load problem: agents that
 * read both files (Copilot, Cursor) would otherwise ingest duplicated guidance.
 * With CLAUDE.md reduced to a one-line import, the duplicate they see is
 * negligible while Claude still gets the full canonical content.
 *
 * Create-only semantics: Lisa never overwrites a host-authored CLAUDE.md. For
 * existing projects that predate this pattern, `lisa doctor` non-destructively
 * adds the `@AGENTS.md` import (see `src/core/instruction-files-migration.ts`).
 * @module claude/claude-md-installer
 */
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";

/** Filename of the Claude project doc at the host project root. */
export const CLAUDE_MD_FILENAME = "CLAUDE.md";

/**
 * The Claude Code `@`-import directive that pulls the canonical `AGENTS.md` into
 * a Claude session. Exported so the doctor migration can detect whether an
 * existing CLAUDE.md already points at AGENTS.md.
 */
export const CLAUDE_MD_AGENTS_IMPORT = "@AGENTS.md";

/** Result of the CLAUDE.md install pass. */
export interface ClaudeMdInstallResult {
  /** True when Lisa created the file (false when it already existed). */
  readonly created: boolean;
  /** Path written, relative to the host project root, or undefined on no-op. */
  readonly relativePath: string | undefined;
}

const TEMPLATE = `# Claude Instructions

${CLAUDE_MD_AGENTS_IMPORT}

<!--
Lisa keeps CLAUDE.md as a thin pointer to AGENTS.md — the canonical, cross-agent
instruction file — so this project's guidance lives in exactly one place. The
\`${CLAUDE_MD_AGENTS_IMPORT}\` line above uses Claude Code's @-import syntax to load
AGENTS.md at session start (Claude Code does not read AGENTS.md natively).

Put project guidance in AGENTS.md. Add Claude-specific guidance below only if you
need behavior that should apply to Claude Code but not other agents.
-->
`;

/**
 * Write a starter CLAUDE.md at the host project root, but only if the file
 * doesn't already exist.
 *
 * @param destDir - Absolute path to the host project root.
 * @returns Result describing whether a file was created.
 */
export async function installClaudeMd(
  destDir: string
): Promise<ClaudeMdInstallResult> {
  const filePath = path.join(destDir, CLAUDE_MD_FILENAME);
  if (existsSync(filePath)) {
    return { created: false, relativePath: undefined };
  }
  await writeFile(filePath, TEMPLATE, "utf8");
  return { created: true, relativePath: CLAUDE_MD_FILENAME };
}
