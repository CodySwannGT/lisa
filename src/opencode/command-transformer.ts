/**
 * Convert a Lisa command Markdown file into an OpenCode custom command.
 *
 * Lisa commands already work today on OpenCode as `lisa-` prefixed skills (see
 * `opencode/skills-installer.ts`). This transformer is the additive, native
 * path: OpenCode has a first-class command format
 * (https://opencode.ai/docs/commands) with its own frontmatter and native
 * `$ARGUMENTS` / `$1` / `@file` substitution.
 *
 * Claude command shape:
 * ```
 * ---
 * description: ...
 * argument-hint: "<x>"          # optional
 * ---
 * Body with $ARGUMENTS
 * ```
 *
 * OpenCode command shape:
 * ```
 * ---
 * description: ...
 * ---
 * Body with $ARGUMENTS
 * ```
 *
 * Unlike the command-to-SKILL conversion (which strips `$ARGUMENTS` because a
 * skill has no argument channel), this PRESERVES `$ARGUMENTS` verbatim because
 * OpenCode substitutes it natively (verified on opencode 1.16.2 — the resolved
 * config keeps `$ARGUMENTS` in the command template). The body is otherwise
 * passed through unchanged.
 * @module opencode/command-transformer
 */
import yaml from "js-yaml";

/**
 * Pure transform: convert a Lisa command Markdown into an OpenCode command
 * Markdown.
 * @param commandSource - Raw contents of the command .md file
 * @param displayName - Human-readable name used as a fallback description
 *   (e.g. "lisa:git:commit")
 * @returns The OpenCode command Markdown content as a string
 */
export function transformCommandToOpencode(
  commandSource: string,
  displayName: string
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(
    commandSource
  );
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      `Command source is missing YAML frontmatter for ${displayName}`
    );
  }
  const description = parseDescription(yaml.load(match[1]), displayName);
  const body = match[2].trimStart().trimEnd();

  const frontmatter = [
    "---",
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
  ].join("\n");

  return `${frontmatter}${body}\n`;
}

/**
 * Extract the command description from parsed frontmatter, falling back to the
 * display name when none is present.
 * @param parsed - Output of `yaml.load(rawFrontmatter)` (untrusted shape)
 * @param displayName - Fallback used when no description is available
 * @returns The description string
 */
function parseDescription(parsed: unknown, displayName: string): string {
  if (parsed === null || typeof parsed !== "object") {
    return displayName;
  }
  const obj = parsed as Record<string, unknown>;
  return typeof obj.description === "string" && obj.description.length > 0
    ? obj.description
    : displayName;
}
