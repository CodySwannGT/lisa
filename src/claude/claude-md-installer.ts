/**
 * Write Lisa's CLAUDE.md template for Claude Code host projects.
 *
 * Claude Code auto-loads `CLAUDE.md` from the project tree at session start
 * as repository-specific guidance. Lisa ships a starter template that:
 *
 *   - Advertises that Lisa governance is active in the project.
 *   - Points downstream readers at the Lisa plugin (CodySwannGT/lisa).
 *   - Reserves space for project-specific guidance the host can edit.
 *
 * Create-only semantics: Lisa never overwrites a host-authored CLAUDE.md.
 * The Claude counterpart to `src/codex/agents-md-installer.ts`.
 * @module claude/claude-md-installer
 */
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";

/** Filename of the Claude project doc at the host project root. */
export const CLAUDE_MD_FILENAME = "CLAUDE.md";

/** Result of the CLAUDE.md install pass. */
export interface ClaudeMdInstallResult {
  /** True when Lisa created the file (false when it already existed). */
  readonly created: boolean;
  /** Path written, relative to the host project root, or undefined on no-op. */
  readonly relativePath: string | undefined;
}

const TEMPLATE = `# Claude Instructions

This file is auto-loaded by Claude Code at session start as repository-specific
guidance. Anthropic's Claude Code reads CLAUDE.md from the project root, the
parent tree, and the user-level home directory; project-level takes precedence.

## Lisa Governance

This project uses [Lisa](https://github.com/CodySwannGT/lisa) for AI-assisted
software development governance. The Lisa Claude Code plugin ships skills,
agents, slash commands, hooks, rules, and MCP servers via the GitHub plugin
marketplace.

Lisa's eager rules are auto-injected into every Claude Code session via the
plugin's \`SessionStart\` and \`SubagentStart\` hooks (see
\`plugins/lisa/hooks/inject-rules.sh\` in the Lisa repository). The rules cover
coding philosophy, intent routing, leaf-only lifecycle, PRD lifecycle rollup,
repo-scope splits, security audit handling, documentation-source paths, and
empirical-inquiry discipline.

## Add Project-Specific Guidance Below

The lines above are managed by Lisa; the rest of this file is owned by the host
project. Add convention notes, terminology, architectural shorthand, or any
project-specific guidance Claude Code should consume at session start.

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
