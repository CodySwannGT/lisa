/**
 * Emit a create-only AGENTS.md template into the host project root.
 *
 * Codex auto-loads `AGENTS.md` from the project tree on every session
 * (per `developers.openai.com/codex/guides/agents-md`). Lisa ships a
 * starter template so hosts know:
 *   - Lisa governance is active in this project (rules injected via
 *     SessionStart hook from `.codex/lisa-rules/`)
 *   - This file is the place to add project-specific guidance
 *
 * Create-only: never overwritten on subsequent `lisa` runs. The host owns
 * the file once it exists. (Lisa's actual rules go via the inject-rules
 * hook, so AGENTS.md is purely a host-facing knob.)
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
 * Starter template content. Intentionally short — the heavy lifting (Lisa
 * rules, intent routing, orchestration) lives in `.codex/lisa-rules/` and
 * is injected via the SessionStart hook, so AGENTS.md is reserved for
 * host-specific notes.
 */
export const AGENTS_MD_TEMPLATE = `# Project Guidance for Codex

This project uses Lisa governance. Codex sessions automatically receive
Lisa's rules, agents, and skills via the SessionStart hook in
\`.codex/hooks/lisa/inject-rules.sh\`.

This file is for **project-specific guidance** — add anything Codex should
know about *this particular* project that isn't covered by Lisa's rules.

## What lives where

- \`.codex/agents/lisa/\` — Lisa-managed subagent role definitions
- \`.codex/skills/lisa/\` — Lisa-managed skills (invoke via \`$<name>\`)
- \`.codex/lisa-rules/\` — Lisa rules content (injected at session start)
- \`.codex/hooks/lisa/\` — Lisa-managed hook scripts
- \`.codex/config.toml\` — partly Lisa-managed Codex config

## Custom rules for this project

Add project-specific guidance below. This section is preserved across Lisa
updates (\`AGENTS.md\` is create-only).
`;
