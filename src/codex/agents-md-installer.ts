/**
 * Emit the create-only, canonical `AGENTS.md` template into the host project
 * root.
 *
 * `AGENTS.md` is Lisa's single, cross-agent instruction file. It follows the
 * [AGENTS.md](https://agents.md) open standard and is read natively at session
 * start by Codex, Cursor, GitHub Copilot, and Antigravity (`agy`). Claude Code
 * does not read `AGENTS.md` natively, so Lisa points `CLAUDE.md` at it with an
 * `@AGENTS.md` import (see `src/claude/claude-md-installer.ts`) — that keeps the
 * project's guidance in exactly one place and avoids the double-load that
 * separate-but-duplicated `AGENTS.md`/`CLAUDE.md` files cause for agents (Copilot,
 * Cursor) that read both.
 *
 * The template is deliberately agent-neutral and short: Lisa's actual rules are
 * injected per session via each agent's `inject-rules.sh` SessionStart hook, so
 * `AGENTS.md` is purely a host-facing knob, not a place to duplicate rule bodies.
 *
 * Create-only: never overwritten on subsequent `lisa` runs. The host owns the
 * file once it exists.
 *
 * This module lives under `src/codex/` for historical reasons (Codex was the
 * first non-Claude harness); the file it writes is canonical for all agents.
 * @module codex/agents-md-installer
 */
import * as fse from "fs-extra";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Filename of the Codex project doc at the host project root */
export const AGENTS_MD_FILENAME = "AGENTS.md";

/** Result of the AGENTS.md install pass */
export interface AgentsMdInstallResult {
  /** True if Lisa created the file (false if it already existed) */
  readonly created: boolean;
  /** Path written, relative to the host project root (or empty if no-op) */
  readonly relativePath: string | undefined;
}

/**
 * Write a starter AGENTS.md template at the host project root, but only if
 * the file doesn't already exist (create-only semantics).
 * @param destDir - Absolute path to the host project root
 * @returns Result describing whether a file was created
 */
export async function installAgentsMd(
  destDir: string
): Promise<AgentsMdInstallResult> {
  const filePath = path.join(destDir, AGENTS_MD_FILENAME);
  if (await fse.pathExists(filePath)) {
    return { created: false, relativePath: undefined };
  }
  await writeFile(filePath, AGENTS_MD_TEMPLATE, "utf8");
  return { created: true, relativePath: AGENTS_MD_FILENAME };
}

/**
 * Starter template content. Intentionally short and agent-neutral — the heavy
 * lifting (Lisa rules, intent routing, orchestration) is injected per session
 * via each agent's `inject-rules.sh` SessionStart hook, so `AGENTS.md` is
 * reserved for host-specific notes and is never bloated with rule bodies.
 */
export const AGENTS_MD_TEMPLATE = `# Project Guidance

This is the **canonical, cross-agent instruction file** for this project. It
follows the [AGENTS.md](https://agents.md) open standard and is read natively at
session start by Codex, Cursor, GitHub Copilot, and Antigravity (\`agy\`). Claude
Code reads it through the \`@AGENTS.md\` import in \`CLAUDE.md\`, so all of this
project's guidance lives in one place.

## Lisa Governance

This project uses [Lisa](https://github.com/CodySwannGT/lisa) for AI-assisted
software development governance. Lisa ships skills, agents, slash commands,
hooks, rules, and MCP servers via per-agent plugins. Lisa's eager rules are
injected into every session by the plugin's \`SessionStart\` / \`SubagentStart\`
hooks (\`inject-rules.sh\`) — they are intentionally **not** duplicated into this
file.

## Add Project-Specific Guidance Below

The lines above are a Lisa-managed starter; this file is owned by the host
project and is never overwritten on subsequent \`lisa apply\` runs. Add
convention notes, terminology, architectural shorthand, or anything agents
should know about *this particular* project that Lisa's universal rules do not
cover.
`;
