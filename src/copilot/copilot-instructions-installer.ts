/**
 * Write Lisa's `.github/copilot-instructions.md` template for Copilot host
 * projects.
 *
 * Verified-by-run (2026-05-28): `copilot init` creates a `.github/` directory
 * and is documented to write `.github/copilot-instructions.md` containing
 * project-specific guidance Copilot auto-loads at session start.
 *
 * The installer mirrors `src/codex/agents-md-installer.ts`'s create-only
 * semantics — Lisa never overwrites a host-authored
 * `.github/copilot-instructions.md`. The Lisa template is short and points
 * downstream at the canonical rule sources (Lisa plugin's `rules/eager/`
 * directory, surfaced by the Copilot variant's bundled rules).
 * @module copilot/copilot-instructions-installer
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";

/** Relative path of Copilot's instruction file inside a host project. */
export const COPILOT_INSTRUCTIONS_RELATIVE_PATH = path.join(
  ".github",
  "copilot-instructions.md"
);

/** Result of the Copilot instructions install pass. */
export interface CopilotInstructionsInstallResult {
  /** True when Lisa created the file (false when it already existed). */
  readonly created: boolean;
  /** Path written, relative to the host project root (or undefined on no-op). */
  readonly relativePath: string | undefined;
}

const TEMPLATE = `# Copilot Instructions

GitHub Copilot CLI auto-loads this file at session start as repository-specific
guidance.

Lisa governance is active in this project. Lisa's eager rules ship via the
\`lisa-copilot\` plugin (see
[CodySwannGT/lisa](https://github.com/CodySwannGT/lisa)) and Copilot loads them
through the plugin's bundled \`rules/\` directory plus the \`SessionStart\` hook
\`inject-rules.sh\` (the same polyfill Lisa uses on Claude and Codex when the
agent does not auto-load rules from a plugin).

This file is the place to add project-specific guidance that Lisa's universal
rules do not cover. It is create-only from Lisa's perspective — re-running
\`lisa apply\` will never overwrite host-authored guidance here.

Reference paths Copilot reads natively at session start:

- \`.github/copilot-instructions.md\` (this file)
- \`AGENTS.md\` at project root, when present
- \`CLAUDE.md\` at project root, when present (Copilot cross-reads)

Add custom guidance below this line:
`;

/**
 * Write a starter `.github/copilot-instructions.md` at the host project root,
 * but only if the file doesn't already exist.
 *
 * @param destDir - Absolute path to the host project root.
 * @returns Result describing whether a file was created.
 */
export async function installCopilotInstructions(
  destDir: string
): Promise<CopilotInstructionsInstallResult> {
  const filePath = path.join(destDir, COPILOT_INSTRUCTIONS_RELATIVE_PATH);
  if (existsSync(filePath)) {
    return { created: false, relativePath: undefined };
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, TEMPLATE, "utf8");
  return { created: true, relativePath: COPILOT_INSTRUCTIONS_RELATIVE_PATH };
}
