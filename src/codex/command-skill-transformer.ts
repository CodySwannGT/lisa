/**
 * Convert Claude slash-command markdown into Codex skill markdown.
 */
import yaml from "js-yaml";

/** Parsed Claude command frontmatter fields relevant to Codex compatibility */
interface CommandFrontmatter {
  readonly description: string;
  readonly argumentHint?: string;
  readonly allowedTools?: readonly string[];
}

/**
 * Pure transform: convert a Lisa command markdown to a Codex skill markdown.
 *
 * Preserves the description from the command's frontmatter; turns
 * `argument-hint`, `allowed-tools`, the original slash command, and
 * `$ARGUMENTS` into normal skill instructions so the Codex path does not lose
 * the intent of Claude's command interface.
 * @param commandSource - Raw contents of the command .md file
 * @param skillName - Target skill name (already includes the `lisa-` prefix)
 * @param displayName - Human-readable name used as a fallback description
 * @param runtimeLabel - Runtime the compatibility note targets (e.g. "Codex",
 *   "OpenCode"). Defaults to "Codex" so existing Codex output is unchanged.
 * @returns The skill SKILL.md content as a string
 */
export function convertCommandToSkill(
  commandSource: string,
  skillName: string,
  displayName: string,
  runtimeLabel = "Codex"
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(
    commandSource
  );
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      `Command source is missing YAML frontmatter for ${displayName}`
    );
  }
  const rawFrontmatter = match[1];
  const rawBody = match[2];

  const parsedFrontmatter = parseCommandFrontmatter(
    yaml.load(rawFrontmatter),
    displayName
  );
  const body = rawBody
    .trimStart()
    .replace(
      /\$ARGUMENTS/g,
      "Use the user's surrounding request as this command's arguments."
    )
    .trimEnd();

  const frontmatter = [
    "---",
    `name: ${skillName}`,
    `description: ${JSON.stringify(parsedFrontmatter.description)}`,
    "---",
    "",
  ].join("\n");

  return `${frontmatter}${formatCommandCompatibilityBlock(
    parsedFrontmatter,
    skillName,
    displayName,
    runtimeLabel
  )}\n${body}\n`;
}

/**
 * Parse the subset of Claude command frontmatter that Codex should preserve.
 * @param parsed - Output of `yaml.load(rawFrontmatter)` (untrusted shape)
 * @param displayName - Fallback used when no description is available
 * @returns Command frontmatter relevant to Codex skill conversion
 */
function parseCommandFrontmatter(
  parsed: unknown,
  displayName: string
): CommandFrontmatter {
  if (parsed === null || typeof parsed !== "object") {
    return { description: displayName };
  }
  const obj = parsed as Record<string, unknown>;
  const description =
    typeof obj.description === "string" && obj.description.length > 0
      ? obj.description
      : displayName;
  const argumentHint =
    typeof obj["argument-hint"] === "string" && obj["argument-hint"].length > 0
      ? obj["argument-hint"]
      : undefined;
  const allowedTools = parseAllowedTools(obj["allowed-tools"]);
  return {
    description,
    ...(argumentHint !== undefined ? { argumentHint } : {}),
    ...(allowedTools.length > 0 ? { allowedTools } : {}),
  };
}

/**
 * Normalize Claude command `allowed-tools` values to a string list.
 * @param raw - Untrusted frontmatter value
 * @returns Tool names
 */
function parseAllowedTools(raw: unknown): readonly string[] {
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map(tool => tool.trim())
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.filter(
      (tool): tool is string => typeof tool === "string" && tool.length > 0
    );
  }
  return [];
}

/**
 * Emit command compatibility notes at the top of generated Codex skills.
 * @param frontmatter - Parsed Claude command metadata
 * @param skillName - Generated skill name
 * @param displayName - Original Lisa command display name
 * @param runtimeLabel - Runtime the note targets (e.g. "Codex", "OpenCode")
 * @returns Markdown block
 */
function formatCommandCompatibilityBlock(
  frontmatter: CommandFrontmatter,
  skillName: string,
  displayName: string,
  runtimeLabel: string
): string {
  const baseLines = [
    "## Lisa Command Compatibility",
    "",
    `- Original Claude command: \`/${displayName}\``,
    `- ${runtimeLabel} invocation: \`$${skillName}\` or a plain-English request that matches this skill.`,
    "- Treat the user's surrounding request as the command arguments.",
  ];
  const argumentLines =
    frontmatter.argumentHint === undefined
      ? []
      : [`- Claude argument hint: \`${frontmatter.argumentHint}\``];
  const toolLines =
    frontmatter.allowedTools === undefined
      ? []
      : [
          `- Claude allowed tools: ${frontmatter.allowedTools
            .map(t => `\`${t}\``)
            .join(
              ", "
            )}. ${runtimeLabel} tool access is governed by the active ${runtimeLabel} runtime and project policy.`,
        ];
  return `${[...baseLines, ...argumentLines, ...toolLines].join("\n")}\n`;
}
