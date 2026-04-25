/**
 * Transform a Claude Code-style agent definition (Markdown with YAML
 * frontmatter) into a Codex CLI agent role TOML file.
 *
 * Claude Code agent shape:
 * ```
 * ---
 * name: bug-fixer
 * description: ...
 * tools: Read, Bash             # optional; ignored on the Codex side
 * model: sonnet                 # optional; mapped if present
 * skills: [skill-a, skill-b]    # optional; preserved in body as context
 * ---
 * # Body becomes developer_instructions
 * ```
 *
 * Codex agent shape (per `RawAgentRoleFileToml`, see
 * https://github.com/openai/codex/blob/main/codex-rs/core/src/config/agent_roles.rs):
 * ```toml
 * name = "lisa-bug-fixer"
 * description = "..."
 * developer_instructions = """
 * # Body...
 * """
 * ```
 *
 * The Codex deserializer rejects unknown top-level fields
 * (`#[serde(deny_unknown_fields)]`), so this transformer emits ONLY keys that
 * Codex's loader accepts.
 * @module codex/agent-transformer
 */
import yaml from "js-yaml";

/**
 * Prefix applied to every Lisa-owned Codex agent name. Provides
 * defense-in-depth on top of the directory-based ownership boundary
 * (`.codex/agents/lisa/`); makes it unambiguous in transcripts/logs which
 * agents Lisa manages.
 */
export const LISA_AGENT_NAME_PREFIX = "lisa-";

/** Keys recognized in Lisa agent YAML frontmatter */
interface AgentFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly tools?: string;
  readonly model?: string;
  readonly skills?: readonly string[];
}

/** Result of parsing a Lisa agent Markdown file */
export interface ParsedAgent {
  readonly frontmatter: AgentFrontmatter;
  readonly body: string;
}

/** Options controlling TOML emission */
export interface AgentTransformOptions {
  /**
   * Whether to apply the `lisa-` name prefix. Defaults to true; set false for
   * tests or for agents the consumer wants to expose without a Lisa namespace.
   */
  readonly applyNamePrefix?: boolean;
}

/**
 * Parse a Lisa agent Markdown source string into frontmatter + body.
 *
 * Throws on missing/malformed frontmatter or missing required fields, since
 * these would silently produce broken Codex agent files otherwise.
 * @param source - Raw contents of an agent .md file
 * @returns Parsed frontmatter and body
 */
export function parseAgentMarkdown(source: string): ParsedAgent {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(
      "Agent markdown is missing YAML frontmatter (expected leading --- block)"
    );
  }
  const rawFrontmatter = match[1];
  const rawBody = match[2];
  const parsed = yaml.load(rawFrontmatter) as unknown;
  const frontmatter = validateFrontmatter(parsed);
  return { frontmatter, body: rawBody.trimStart() };
}

/**
 * Transform a parsed agent into the Codex TOML representation as a string.
 * @param parsed - Output of parseAgentMarkdown
 * @param options - Transform options
 * @returns Serialized TOML matching Codex's `RawAgentRoleFileToml` schema
 */
export function transformAgentToToml(
  parsed: ParsedAgent,
  options: AgentTransformOptions = {}
): string {
  const applyPrefix = options.applyNamePrefix ?? true;
  const baseName = parsed.frontmatter.name;
  const codexName = applyPrefix
    ? `${LISA_AGENT_NAME_PREFIX}${baseName}`
    : baseName;
  const developerInstructions = composeDeveloperInstructions(parsed);

  const lines = [
    `name = ${tomlString(codexName)}`,
    `description = ${tomlString(parsed.frontmatter.description)}`,
    `developer_instructions = ${tomlMultilineString(developerInstructions)}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * One-shot helper: parse + transform.
 * @param source - Raw contents of an agent .md file
 * @param options - Transform options
 * @returns Serialized Codex agent TOML
 */
export function transformAgentMarkdownToToml(
  source: string,
  options: AgentTransformOptions = {}
): string {
  return transformAgentToToml(parseAgentMarkdown(source), options);
}

/**
 * Build the `developer_instructions` body. Claude Code agents sometimes
 * carry `skills:` in frontmatter that act as soft guidance; we surface that
 * as a header in the instructions so the Codex agent has the same context.
 * @param parsed - Output of parseAgentMarkdown for the source agent file
 * @returns The composed body to write into `developer_instructions`
 */
function composeDeveloperInstructions(parsed: ParsedAgent): string {
  const skills = parsed.frontmatter.skills;
  if (skills === undefined || skills.length === 0) {
    return parsed.body.trimEnd();
  }
  const skillsBlock = [
    "## Available Lisa Skills",
    "",
    "This agent operates in a Lisa-managed Codex environment with access to the following skills:",
    "",
    ...skills.map(s => `- ${s}`),
    "",
  ].join("\n");
  return `${skillsBlock}\n${parsed.body.trimEnd()}`;
}

/**
 * Validate frontmatter shape, throwing on missing required fields or wrong
 * types. Unknown fields are ignored to allow Lisa agents to carry harness-
 * specific keys without breaking the transformer.
 * @param parsed - Untrusted YAML mapping parsed from the agent's frontmatter
 * @returns The validated frontmatter with only the keys we recognize
 */
function validateFrontmatter(parsed: unknown): AgentFrontmatter {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("Agent frontmatter must be a YAML mapping");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim().length === 0) {
    throw new Error('Agent frontmatter is missing required "name" field');
  }
  if (
    typeof obj.description !== "string" ||
    obj.description.trim().length === 0
  ) {
    throw new Error(
      'Agent frontmatter is missing required "description" field'
    );
  }
  const skills = parseSkills(obj.skills);
  return {
    name: obj.name,
    description: obj.description,
    ...(typeof obj.tools === "string" ? { tools: obj.tools } : {}),
    ...(typeof obj.model === "string" ? { model: obj.model } : {}),
    ...(skills !== undefined ? { skills } : {}),
  };
}

/**
 * Coerce the `skills` frontmatter field into a string array, or undefined.
 * @param raw - Untrusted value from the `skills` key (may be missing/wrong type)
 * @returns A frozen string array, or undefined if absent/empty
 */
function parseSkills(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const filtered = raw.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0
  );
  return filtered.length > 0 ? Object.freeze(filtered) : undefined;
}

/**
 * Emit a TOML basic string with proper escaping. Uses double-quoted form so
 * we can rely on standard escape sequences without worrying about literal
 * (single-quoted) string limitations.
 * @param value - The raw string to encode as a TOML basic string
 * @returns The encoded string including surrounding double quotes
 */
function tomlString(value: string): string {
  const escaped = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
  return `"${escaped}"`;
}

/**
 * Emit a TOML multi-line basic string, preserving newlines verbatim. The
 * leading newline after `"""` is part of TOML grammar — it is stripped by
 * the parser so authoring stays clean.
 *
 * Edge case: Markdown bodies sometimes contain literal `"""` (e.g., Python
 * docstring examples). We escape any closing triple-quote sequence by
 * inserting a backslash before the third quote.
 * @param value - The raw multi-line content to encode
 * @returns The encoded TOML multi-line string including surrounding triple-quotes
 */
function tomlMultilineString(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"""', '""\\"');
  return `"""\n${escaped}\n"""`;
}
