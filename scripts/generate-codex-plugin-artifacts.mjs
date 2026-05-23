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

const claudeManifest = JSON.parse(fs.readFileSync(claudeManifestPath, "utf8"));
const pluginName = claudeManifest.name;

writeCodexManifest(pluginName, versionArg);

function writeCodexManifest(pluginName, version) {
  const metadata = metadataFor(pluginName);
  const manifest = {
    name: pluginName,
    version,
    description: metadata.description ?? claudeManifest.description,
    author: claudeManifest.author ?? { name: "Cody Swann" },
    keywords: metadata.keywords,
    ...(claudeManifest.dependencies
      ? { dependencies: claudeManifest.dependencies }
      : {}),
    ...componentPointers(),
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

function componentPointers() {
  return {
    ...(fs.existsSync(path.join(pluginDir, "skills"))
      ? { skills: "./skills/" }
      : {}),
    ...(fs.existsSync(path.join(pluginDir, ".mcp.json"))
      ? { mcpServers: "./.mcp.json" }
      : {}),
  };
}

function metadataFor(pluginName) {
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
