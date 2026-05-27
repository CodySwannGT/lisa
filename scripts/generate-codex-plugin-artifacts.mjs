#!/usr/bin/env node
/**
 * Generate Codex plugin artifacts from the built Claude plugin directories.
 *
 * Claude remains Lisa's production path; this script derives the .codex-plugin
 * metadata (skills + MCP pointers) every time plugins are rebuilt.
 *
 * NOTE ON HOOKS: this script does NOT emit Codex hooks. Codex (codex-cli
 * 0.125.0) does not execute plugin-bundled hooks — its plugin manifest parser
 * only honors `skills`, `mcpServers`, `apps`, and interface fields, and a
 * runtime test confirmed a bundled `hooks/hooks.json` never fires. Lisa's
 * Codex hooks are instead installed into the project's `.codex/hooks.json`
 * by `src/codex/hooks-installer.ts` (run during `lisa` apply). Hooks with no
 * Codex equivalent are intentionally not ported: `enforce-team-first.sh`
 * (Claude-team-specific), `inject-flow-context.sh` and any SubagentStart hook
 * (Codex has no SubagentStart event), and the SessionEnd `entire` hook (Codex
 * has no SessionEnd event).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const INTERNAL_CODEX_SKILL_POLICY_PATH = path.join(
  REPO_ROOT,
  "scripts",
  "internal-codex-skill-policy.json"
);

/**
 * Parse the leading YAML frontmatter block of a SKILL.md file.
 *
 * The frontmatter is the simple `key: value` YAML between the first two `---`
 * fences at the very top of the file (the shape every `plugins/*\/skills/*\/SKILL.md`
 * uses). Values are read verbatim as strings (trimmed); nested structures and
 * arrays are not interpreted because skill frontmatter does not use them.
 *
 * @param {string} skillMdPath Absolute or relative path to a SKILL.md file.
 * @returns {{ name?: string, description?: string } & Record<string, string> | null}
 *   The parsed key/value pairs, or `null` (skip sentinel) when the file has no
 *   leading `---`-delimited frontmatter block. Pure: never writes.
 */
export function parseSkillFrontmatter(skillMdPath) {
  const raw = fs.readFileSync(skillMdPath, "utf8");
  // Frontmatter must be the very first thing in the file. Normalize CRLF so a
  // Windows-authored SKILL.md parses identically to a LF one.
  const normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return null;
  }
  const closingIndex = normalized.indexOf("\n---", 3);
  if (closingIndex === -1) {
    return null;
  }
  const block = normalized.slice(4, closingIndex);
  const frontmatter = {};
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    if (key === "") {
      continue;
    }
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    frontmatter[key] = value;
  }
  return frontmatter;
}

/**
 * Encode a single string as a YAML double-quoted scalar.
 *
 * Double-quoting unconditionally is the deterministic choice: it round-trips
 * every possible string — colons, leading `#`/`-`, quotes, indicators — without
 * the branchy "is this plain-safe?" logic that risks emitting ambiguous YAML.
 * Only the five escapes YAML's double-quoted style requires are applied, in a
 * fixed order, so output is a pure function of the input.
 *
 * @param {string} value Raw string to encode.
 * @returns {string} The value wrapped in double quotes with `\`, `"`, and the
 *   C0 control characters (tab, newline, carriage return) escaped.
 */
function yamlQuote(value) {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

/**
 * Serialize a Codex `interface` object to deterministic `openai.yaml` content.
 *
 * Emits exactly three keys in a fixed order — `display_name`,
 * `short_description`, then `default_prompt` (a block sequence) — with every
 * scalar double-quoted and a single trailing newline. The function is pure:
 * given the same input it returns byte-identical output (no timestamps, no
 * randomness, no filesystem), which is what keeps `bun run build:plugins`
 * reproducible and the Plugins Sync CI gate stable.
 *
 * @param {{ display_name: string, short_description: string, default_prompt: readonly string[] }} iface
 *   The normalized interface object. `default_prompt` is always rendered as a
 *   block sequence (an empty array becomes `default_prompt: []`).
 * @returns {string} Deterministic YAML, terminated by exactly one newline.
 */
export function serializeInterfaceToYaml(iface) {
  const prompts = iface.default_prompt ?? [];
  const promptBlock =
    prompts.length === 0
      ? "default_prompt: []"
      : ["default_prompt:", ...prompts.map(p => `  - ${yamlQuote(p)}`)].join(
          "\n"
        );
  const lines = [
    `display_name: ${yamlQuote(iface.display_name)}`,
    `short_description: ${yamlQuote(iface.short_description)}`,
    promptBlock,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Acronyms that should stay fully upper-cased when a skill name is humanized.
 *
 * Skill names are kebab/snake tokens (e.g. `exploratory-qa`); naive title-casing
 * would yield "Qa". Tokens listed here (compared case-insensitively) are emitted
 * upper-case instead so `exploratory-qa` -> "Exploratory QA". The set is small and
 * deliberately conservative — only well-known initialisms that appear in Lisa
 * skill names — so humanization stays a pure, predictable function of the input.
 */
const ACRONYMS = new Set([
  "qa",
  "ci",
  "cd",
  "pr",
  "prd",
  "ui",
  "ux",
  "api",
  "cli",
  "sdk",
  "tdd",
  "mcp",
  "aws",
  "cdk",
  "zap",
  "owasp",
  "sql",
  "url",
  "id",
  "io",
  "llm",
]);

/**
 * Humanize a kebab/snake/space-delimited token into a Title-Cased display name.
 *
 * Splits on `-`, `_`, and runs of whitespace, then title-cases each word —
 * except tokens in {@link ACRONYMS}, which are upper-cased. This is the rule the
 * PRD (#521) specifies for `display_name`: `exploratory-qa` -> "Exploratory QA".
 * Pure: same input always yields the same output.
 *
 * @param {string} raw The raw skill/frontmatter name token.
 * @returns {string} The humanized, title-cased display name.
 */
function humanizeName(raw) {
  return raw
    .split(/[-_\s]+/)
    .filter(word => word.length > 0)
    .map(word =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

/**
 * Boilerplate openings that several Lisa skill descriptions share (e.g. "This
 * skill should be used when ..."). They add no signal to a short UI summary, so
 * the leading phrase is stripped before the first-sentence summary is taken.
 * Matched case-insensitively at the very start of the description only.
 */
const DESCRIPTION_PREFIXES = [
  /^this skill should be used (when|to|for|whenever|any time|anytime|while)\s+/i,
  /^this skill should be used\s+/i,
  /^use this skill (when|to|for|whenever|any time|anytime|while)\s+/i,
  /^use when\s+/i,
];

/** Upper bound on the derived `short_description` length (characters). */
const SHORT_DESCRIPTION_MAX = 140;

/**
 * Derive a concise `short_description` from a skill's full frontmatter
 * `description`.
 *
 * DERIVATION RULE (Epic Open Question — "use best judgement based on the context
 * of the project", per the PRD #521 author): a Lisa skill description leads with
 * a one-line summary and then enumerates trigger conditions across several
 * sentences. The concise summary is therefore the first sentence:
 *
 *  1. Strip a leading "This skill should be used when/to/for ..." boilerplate
 *     prefix (see {@link DESCRIPTION_PREFIXES}) so the summary carries signal.
 *  2. Take the text up to the first sentence terminator (`. `, `! `, `? `).
 *  3. Trim a trailing period and clamp to {@link SHORT_DESCRIPTION_MAX} chars
 *     (word-boundary truncation with an ellipsis) so it stays a *short*
 *     description.
 *
 * For `exploratory-qa` this yields "Playwright-backed exploratory QA workflow
 * for web apps", matching the PRD's hand-written example shape.
 *
 * @param {string} description The full (trimmed) frontmatter description.
 * @returns {string} A concise one-line summary (may be empty if input is empty).
 */
function summarizeDescription(description) {
  if (description === "") {
    return "";
  }
  const deboilerplated = DESCRIPTION_PREFIXES.reduce(
    (text, prefix) => text.replace(prefix, ""),
    description
  ).trim();
  // First sentence: stop at the first `.`, `!`, or `?` that is followed by
  // whitespace or end-of-string (so "e2e" / "U.S." mid-sentence don't split).
  const sentenceMatch = /^(.*?[.!?])(?:\s|$)/.exec(deboilerplated);
  const firstSentence = (
    sentenceMatch ? sentenceMatch[1] : deboilerplated
  ).replace(/[.\s]+$/, "");
  if (firstSentence.length <= SHORT_DESCRIPTION_MAX) {
    return firstSentence;
  }
  const clamped = firstSentence.slice(0, SHORT_DESCRIPTION_MAX);
  const lastSpace = clamped.lastIndexOf(" ");
  const truncated = lastSpace > 0 ? clamped.slice(0, lastSpace) : clamped;
  return `${truncated.replace(/[,;:.\s]+$/, "")}…`;
}

/**
 * Derive a Codex `interface` object from a skill's SKILL.md frontmatter.
 *
 * DERIVATION RULES (issue #548; the Epic Open Question asked the author for the
 * `short_description`/`default_prompt` rule and the guidance was "use best
 * judgement based on the context of the project"):
 *
 *  - `display_name`  — {@link humanizeName} of `frontmatter.name`: title-cased,
 *    with known acronyms upper-cased (`exploratory-qa` -> "Exploratory QA").
 *  - `short_description` — {@link summarizeDescription} of `frontmatter.description`:
 *    the boilerplate-stripped first sentence, clamped to a short length.
 *  - `default_prompt` — a single short starter prompt that references the skill
 *    token `$<name>` (the canonical kebab name, not the humanized one, because
 *    Codex invokes skills by their `$<name>` token). When a summary is available
 *    the prompt reads "Use $<name>: <summary>." — a colon join is used rather
 *    than "Use $<name> to <summary>" because a derived summary may be a noun
 *    phrase ("Playwright-backed exploratory QA workflow") rather than a verb
 *    clause, and "... to <noun phrase>" reads awkwardly. The colon form is
 *    grammatical for either shape. When there is no description it falls back to
 *    a bare "Use $<name>". The `$<name>` token is always present — the
 *    acceptance criterion.
 *
 * Falls back to the skill directory name (and an empty description) when the
 * frontmatter is missing, so every skill still emits a well-formed file. Pure:
 * no I/O, deterministic output for deterministic input.
 *
 * @param {{ name?: string, description?: string } | null} frontmatter Parsed
 *   SKILL.md frontmatter (or `null` when the file has no frontmatter block).
 * @param {string} skillName The skill directory name, used as a fallback.
 * @returns {{ display_name: string, short_description: string, default_prompt: string[] }}
 *   The normalized interface object the serializer consumes.
 */
export function deriveSkillInterface(frontmatter, skillName) {
  const name = frontmatter?.name?.trim() || skillName;
  // Codex invokes skills by their canonical kebab `$<slug>` token, which is the
  // skill directory name — NOT the (possibly humanized) frontmatter `name`. Some
  // vendored skills (e.g. Expo's) set `name:` to a Title Cased label, which would
  // otherwise yield an invalid handle like `$Expo UI Jetpack Compose`.
  const token = skillName;
  const description = frontmatter?.description?.trim() || "";
  const shortDescription = summarizeDescription(description);
  const starter =
    shortDescription === ""
      ? `Use $${token}`
      : `Use $${token}: ${shortDescription}.`;
  return {
    display_name: humanizeName(name),
    short_description: shortDescription,
    default_prompt: [starter],
  };
}

/**
 * Read the denylisted-skill policy that keeps Lisa maintainer-only skills out
 * of distributed Codex plugin artifacts.
 *
 * Missing or malformed policy files fail open to an empty set so the artifact
 * builder stays usable in isolated tests that seed only a minimal plugin tree.
 *
 * @param {string} [policyPath] Optional override for tests.
 * @returns {ReadonlySet<string>} Skill directory names that must not ship.
 */
export function loadInternalCodexSkillPolicy(
  policyPath = INTERNAL_CODEX_SKILL_POLICY_PATH
) {
  if (!fs.existsSync(policyPath)) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    if (!Array.isArray(parsed.denylistedSkills)) {
      return new Set();
    }
    return new Set(
      parsed.denylistedSkills.filter(name => typeof name === "string")
    );
  } catch {
    return new Set();
  }
}

/**
 * Remove denylisted internal skills from a built plugin directory before any
 * Codex-facing artifacts are derived from it.
 *
 * This keeps maintainer-only skills out of committed built-plugin skill
 * directories,
 * generated per-skill `agents/openai.yaml` files, and downstream host-project
 * installations that consume those built plugin directories.
 *
 * @param {string} pluginDir Absolute path to a built plugin directory.
 * @param {ReadonlySet<string>} [denylistedSkills] Optional override for tests.
 * @returns {readonly string[]} Sorted list of removed skill names.
 */
export function pruneInternalCodexSkills(
  pluginDir,
  denylistedSkills = loadInternalCodexSkillPolicy()
) {
  const skillsDir = path.join(pluginDir, "skills");
  if (!fs.existsSync(skillsDir) || denylistedSkills.size === 0) {
    return [];
  }

  const removed = [];
  for (const skillName of [...denylistedSkills].sort()) {
    const skillDir = path.join(skillsDir, skillName);
    if (!fs.existsSync(skillDir)) {
      continue;
    }
    fs.rmSync(skillDir, { recursive: true, force: true });
    removed.push(skillName);
  }
  return removed;
}

/**
 * Walk every `skills/<name>/SKILL.md` in a built plugin and emit a per-skill
 * `skills/<name>/agents/openai.yaml` (issue #547).
 *
 * For each skill directory containing a SKILL.md, the frontmatter is parsed
 * (#545), an interface object is derived via {@link deriveSkillInterface} (#548),
 * and the deterministic serializer (#546) writes `agents/openai.yaml`, creating
 * the `agents/` directory when missing. Behavior boundaries:
 *
 *  - No-op when the plugin has no `skills/` directory.
 *  - Never clobber a hand-authored `agents/openai.yaml` that already exists in
 *    source (that is issue #550's surface — but we must not overwrite it here
 *    regardless).
 *  - The `commands/` directory is left untouched — Codex does not consume Claude
 *    `commands/`.
 *
 * @param {string} pluginDir Absolute path to a built plugin directory.
 * @returns {void} Writes files as a side effect.
 */
export function writeSkillAgents(pluginDir) {
  const skillsDir = path.join(pluginDir, "skills");
  if (!fs.existsSync(skillsDir)) {
    return;
  }

  const entries = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  for (const skillName of entries) {
    const skillDir = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) {
      continue;
    }

    const openaiYamlPath = path.join(skillDir, "agents", "openai.yaml");
    // Don't clobber a hand-authored openai.yaml carried over from source.
    if (fs.existsSync(openaiYamlPath)) {
      continue;
    }

    const frontmatter = parseSkillFrontmatter(skillMdPath);
    const iface = deriveSkillInterface(frontmatter, skillName);
    fs.mkdirSync(path.dirname(openaiYamlPath), { recursive: true });
    fs.writeFileSync(openaiYamlPath, serializeInterfaceToYaml(iface));
  }
}

function main() {
  const [pluginDirArg, versionArg] = process.argv.slice(2);
  if (!pluginDirArg || !versionArg) {
    console.error(
      "Usage: generate-codex-plugin-artifacts.mjs <plugin-dir> <version>"
    );
    process.exit(1);
  }

  const pluginDir = path.resolve(pluginDirArg);
  const claudeManifestPath = path.join(
    pluginDir,
    ".claude-plugin",
    "plugin.json"
  );
  if (!fs.existsSync(claudeManifestPath)) {
    process.exit(0);
  }

  const claudeManifest = JSON.parse(
    fs.readFileSync(claudeManifestPath, "utf8")
  );
  const pluginName = claudeManifest.name;

  pruneInternalCodexSkills(pluginDir);
  writeCodexManifest(pluginDir, claudeManifest, pluginName, versionArg);
  writeSkillAgents(pluginDir);
}

function writeCodexManifest(pluginDir, claudeManifest, pluginName, version) {
  const metadata = metadataFor(pluginName, claudeManifest);
  const manifest = {
    name: pluginName,
    version,
    description: metadata.description ?? claudeManifest.description,
    author: claudeManifest.author ?? { name: "Cody Swann" },
    keywords: metadata.keywords,
    ...(claudeManifest.dependencies
      ? { dependencies: claudeManifest.dependencies }
      : {}),
    ...componentPointers(pluginDir),
    interface: {
      displayName: metadata.displayName,
      shortDescription: metadata.shortDescription,
      longDescription: metadata.longDescription,
      developerName: "Cody Swann",
      category: metadata.category,
      capabilities: metadata.capabilities,
      defaultPrompt: metadata.defaultPrompt,
    },
  };

  const manifestDir = path.join(pluginDir, ".codex-plugin");
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDir, "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

function componentPointers(pluginDir) {
  return {
    ...(fs.existsSync(path.join(pluginDir, "skills"))
      ? { skills: "./skills/" }
      : {}),
    ...(fs.existsSync(path.join(pluginDir, ".mcp.json"))
      ? { mcpServers: "./.mcp.json" }
      : {}),
  };
}

function metadataFor(pluginName, claudeManifest) {
  const map = {
    lisa: {
      displayName: "Lisa",
      description:
        "Universal governance: agents, skills, commands, hooks, and rules for all projects.",
      shortDescription: "Universal project governance workflows",
      longDescription:
        "Reusable Lisa skills and lifecycle checks for planning, implementation, review, verification, and tracker workflows.",
      category: "Productivity",
      capabilities: ["Interactive", "Write"],
      keywords: ["governance", "skills", "hooks", "workflow"],
      defaultPrompt: [
        "Plan this implementation with Lisa",
        "Review this change with Lisa",
        "Verify this project with Lisa",
      ],
    },
    "lisa-typescript": {
      displayName: "Lisa TypeScript",
      description:
        "TypeScript-specific hooks for formatting, linting, and ast-grep scanning on edit.",
      shortDescription: "TypeScript lifecycle checks",
      longDescription:
        "TypeScript-focused Lisa hooks for formatting, linting, and ast-grep scanning around file edits.",
      category: "Productivity",
      capabilities: ["Write"],
      keywords: ["typescript", "linting", "formatting", "hooks"],
      defaultPrompt: ["Check this TypeScript change"],
    },
    "lisa-expo": {
      displayName: "Lisa Expo",
      description:
        "Expo and React Native-specific skills, agents, rules, and MCP servers.",
      shortDescription: "Expo and React Native workflows",
      longDescription:
        "Lisa skills and MCP configuration for Expo and React Native development, testing, operations, and security review.",
      category: "Coding",
      capabilities: ["Interactive", "Write"],
      keywords: ["expo", "react-native", "mobile", "mcp"],
      defaultPrompt: [
        "Use Lisa Expo to review this screen",
        "Debug this Expo app workflow",
      ],
    },
    "lisa-nestjs": {
      displayName: "Lisa NestJS",
      description:
        "NestJS-specific skills and migration write-protection hooks.",
      shortDescription: "NestJS workflow guidance",
      longDescription:
        "Lisa skills and lifecycle checks for NestJS GraphQL, TypeORM, and migration-safe development.",
      category: "Coding",
      capabilities: ["Interactive", "Write"],
      keywords: ["nestjs", "graphql", "typeorm", "hooks"],
      defaultPrompt: [
        "Review this NestJS resolver",
        "Check this TypeORM change",
      ],
    },
    "lisa-cdk": {
      displayName: "Lisa CDK",
      description: "AWS CDK-specific Lisa plugin.",
      shortDescription: "AWS CDK workflows",
      longDescription:
        "Lisa plugin metadata for AWS CDK-focused project workflows.",
      category: "Coding",
      capabilities: ["Interactive", "Write"],
      keywords: ["aws", "cdk", "infrastructure"],
      defaultPrompt: ["Review this CDK change"],
    },
    "lisa-harper-fabric": {
      displayName: "Lisa Harper/Fabric",
      description:
        "Harper/Fabric-specific Lisa rules for TypeScript component apps.",
      shortDescription: "Harper/Fabric workflow guidance",
      longDescription:
        "Lisa rules for Harper/Fabric deploy surfaces, generated JavaScript artifacts, operational docs, Playwright UI verification, and immutable TypeScript.",
      category: "Coding",
      capabilities: ["Interactive", "Write"],
      keywords: ["harper", "fabric", "typescript", "playwright"],
      defaultPrompt: [
        "Review this Harper/Fabric change",
        "Verify this Harper/Fabric deployment path",
      ],
    },
    "lisa-rails": {
      displayName: "Lisa Rails",
      description:
        "Ruby on Rails-specific skills and hooks for RuboCop and ast-grep scanning on edit.",
      shortDescription: "Ruby on Rails workflows",
      longDescription:
        "Lisa skills and lifecycle checks for Rails conventions, code improvement, linting, and operations workflows.",
      category: "Coding",
      capabilities: ["Interactive", "Write"],
      keywords: ["rails", "ruby", "rubocop", "hooks"],
      defaultPrompt: [
        "Review this Rails controller",
        "Improve this Rails model",
      ],
    },
    "lisa-wiki": {
      displayName: "LLM Wiki",
      description:
        "Distributable LLM Wiki kernel — ingest, query, lint, and maintain a git-native markdown knowledge base across Claude and Codex.",
      shortDescription: "LLM Wiki knowledge base",
      longDescription:
        "A config-driven, git-native LLM Wiki: ingest sources (git, PRs, project-scoped memory, Jira, Slack, docs, …) into durable markdown, query with citations, lint integrity, onboard users, absorb existing documentation, and scaffold domain-expert role subagents. Distributed for both Claude Code and Codex.",
      category: "Productivity",
      capabilities: ["Interactive", "Write"],
      keywords: [
        "wiki",
        "knowledge-base",
        "ingest",
        "documentation",
        "llm-wiki",
      ],
      defaultPrompt: [
        "Onboard me to this project",
        "Ingest the latest sources into the wiki",
        "Query the wiki",
      ],
    },
    "lisa-openclaw": {
      displayName: "Lisa OpenClaw",
      description:
        "Connect staff roles to Telegram or Slack via OpenClaw — facilitator/specialist hub-and-spoke routing and repo-coding topics, across Claude and Codex.",
      shortDescription: "Staff on Telegram/Slack via OpenClaw",
      longDescription:
        "Wire staff roles to human chat surfaces through OpenClaw: set up the gateway prerequisites, connect a facilitator (chief of staff) and its specialists on Telegram or Slack with hub-and-spoke routing, and bind Telegram forum topics to dispatcher+worker pairs for repo-coding work. Distributed for both Claude Code and Codex.",
      category: "Productivity",
      capabilities: ["Interactive", "Write"],
      keywords: ["openclaw", "telegram", "slack", "agents", "chat-ops"],
      defaultPrompt: [
        "Set up OpenClaw for this project",
        "Connect my chief of staff to Telegram",
        "Connect staff to Slack via OpenClaw",
      ],
    },
  };
  return (
    map[pluginName] ?? {
      displayName: pluginName,
      shortDescription: claudeManifest.description,
      longDescription: claudeManifest.description,
      category: "Coding",
      capabilities: ["Interactive", "Write"],
      keywords: ["lisa"],
      defaultPrompt: [`Use ${pluginName}`],
    }
  );
}

// Run the generator only when invoked directly (e.g. via build-plugins.sh),
// not when this module is imported (e.g. by unit tests for the parser).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
