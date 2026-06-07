/**
 * Transform a Claude Code-style agent definition (Markdown with YAML
 * frontmatter) into an OpenCode subagent Markdown file.
 *
 * Claude Code agent shape:
 * ```
 * ---
 * name: bug-fixer
 * description: ...
 * tools: Read, Bash             # optional; preserved as compatibility context
 * model: sonnet                 # optional; preserved as compatibility context
 * skills: [skill-a, skill-b]    # optional; preserved as context
 * ---
 * # Body becomes the agent prompt
 * ```
 *
 * OpenCode agent shape (per https://opencode.ai/docs/agents):
 * ```
 * ---
 * description: ...
 * mode: subagent
 * ---
 * # Body is the agent prompt
 * ```
 *
 * OpenCode agents are Markdown like Claude's, so — unlike the Codex TOML
 * transform — this is a near-passthrough: the body is preserved verbatim and
 * the only required reshape is the frontmatter. The agent NAME is derived by
 * OpenCode from the destination filename (not a frontmatter field), so the
 * installer owns naming; this transformer only owns the file contents.
 *
 * Claude-only metadata (`tools`, `model`, `skills`) is NOT emitted as OpenCode
 * frontmatter — `model` expects a `provider/model` string that a Claude alias
 * (`sonnet`) would violate, and `tools`/`skills` have no 1:1 frontmatter slot.
 * Instead that metadata is preserved as a context block in the body so nothing
 * is silently dropped, mirroring the Codex transformer's compatibility blocks.
 * @module opencode/agent-transformer
 */
import {
  type ParsedAgent,
  parseAgentMarkdown,
} from "../codex/agent-transformer.js";

/**
 * Transform a parsed Lisa agent into OpenCode subagent Markdown.
 * @param parsed - Output of parseAgentMarkdown (frontmatter + body)
 * @returns OpenCode agent Markdown (frontmatter + prompt body)
 */
export function transformAgentToOpencodeMarkdown(parsed: ParsedAgent): string {
  const frontmatter = [
    "---",
    `description: ${jsonScalar(parsed.frontmatter.description)}`,
    "mode: subagent",
    "---",
    "",
  ].join("\n");
  const body = composeAgentBody(parsed);
  return `${frontmatter}${body}\n`;
}

/**
 * One-shot helper: parse + transform.
 * @param source - Raw contents of an agent .md file
 * @returns OpenCode agent Markdown
 */
export function transformAgentMarkdownToOpencode(source: string): string {
  return transformAgentToOpencodeMarkdown(parseAgentMarkdown(source));
}

/**
 * Build the OpenCode agent body. The original Claude body is preserved
 * verbatim; any Claude-only metadata that has no OpenCode frontmatter slot is
 * prepended as a context block so the information survives the transform.
 * @param parsed - Output of parseAgentMarkdown for the source agent file
 * @returns The composed Markdown body
 */
function composeAgentBody(parsed: ParsedAgent): string {
  const compatibilityBlock = formatCompatibilityBlock(parsed);
  const skillsBlock = formatSkillsBlock(parsed);
  return [compatibilityBlock, skillsBlock, parsed.body.trimEnd()]
    .filter(block => block.length > 0)
    .join("\n\n");
}

/**
 * Preserve Claude-only `model`/`tools` metadata as an OpenCode context block.
 * OpenCode governs model and tool access through its own runtime/config, so
 * these are advisory notes rather than enforced settings.
 * @param parsed - Parsed source agent
 * @returns Markdown compatibility block, or an empty string when unnecessary
 */
function formatCompatibilityBlock(parsed: ParsedAgent): string {
  const { model, tools } = parsed.frontmatter;
  const modelLines =
    model === undefined
      ? []
      : [
          `- Claude requested model: \`${model}\`. OpenCode uses the active session model unless the host sets \`model\` on this agent.`,
        ];
  const toolLines =
    tools === undefined
      ? []
      : [
          `- Claude allowed tools: \`${tools}\`. OpenCode tool access is governed by the active OpenCode runtime, \`permission\` settings, and project policy.`,
        ];
  const lines = [...modelLines, ...toolLines];
  if (lines.length === 0) {
    return "";
  }
  return ["## Claude Agent Compatibility", "", ...lines].join("\n");
}

/**
 * Preserve the source agent's `skills:` list as a context block. OpenCode
 * discovers these skills natively from `.opencode/skills/lisa/`, so this block
 * just documents which ones the agent is expected to use.
 * @param parsed - Parsed source agent
 * @returns Markdown skills block, or an empty string when no skills are listed
 */
function formatSkillsBlock(parsed: ParsedAgent): string {
  const skills = parsed.frontmatter.skills;
  if (skills === undefined || skills.length === 0) {
    return "";
  }
  return [
    "## Available Lisa Skills",
    "",
    "This agent operates in a Lisa-managed OpenCode environment with access to the following skills:",
    "",
    ...skills.map(skill => `- ${skill}`),
  ].join("\n");
}

/**
 * Encode a string as a YAML-safe flow scalar. A JSON-encoded string is always a
 * valid YAML double-quoted scalar, so this safely handles descriptions that
 * contain colons, quotes, or other YAML-significant characters.
 * @param value - The raw string to encode
 * @returns A double-quoted YAML scalar
 */
function jsonScalar(value: string): string {
  return JSON.stringify(value);
}
