#!/usr/bin/env node
/**
 * Generate Codex plugin artifacts from the built Claude plugin directories.
 *
 * Claude remains Lisa's production path; this script makes the Codex side
 * durable by deriving .codex-plugin metadata and compatible hook manifests
 * every time plugins are rebuilt.
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
const UNSUPPORTED_CODEX_HOOK_SCRIPTS = new Set([
  "hooks/enforce-team-first.sh",
  "hooks/inject-flow-context.sh",
  "hooks/inject-rules.sh",
]);
const codexHooks = convertHooks(pluginName, claudeManifest.hooks ?? {});

writeCodexManifest(pluginName, versionArg, codexHooks);
writeCodexHooks(codexHooks);

function writeCodexManifest(pluginName, version, hooksFile) {
  const metadata = metadataFor(pluginName);
  const manifest = {
    name: pluginName,
    version,
    description: metadata.description ?? claudeManifest.description,
    author: claudeManifest.author ?? { name: "Cody Swann" },
    keywords: metadata.keywords,
    ...componentPointers(hooksFile),
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

function componentPointers(hooksFile) {
  return {
    ...(fs.existsSync(path.join(pluginDir, "skills"))
      ? { skills: "./skills/" }
      : {}),
    ...(fs.existsSync(path.join(pluginDir, ".mcp.json"))
      ? { mcpServers: "./.mcp.json" }
      : {}),
    ...(hooksFile ? { hooks: "./hooks/hooks.json" } : {}),
  };
}

function writeCodexHooks(hooksFile) {
  const hooksDir = path.join(pluginDir, "hooks");
  const hooksPath = path.join(hooksDir, "hooks.json");
  if (!hooksFile) {
    if (fs.existsSync(hooksPath)) {
      fs.rmSync(hooksPath);
    }
    return;
  }
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(hooksPath, `${JSON.stringify(hooksFile, null, 2)}\n`);
}

function convertHooks(pluginName, claudeHooks) {
  const supportedEvents = new Set([
    "UserPromptSubmit",
    "PostToolUse",
    "PreToolUse",
    "Stop",
    "SessionStart",
  ]);
  const entries = Object.entries(claudeHooks)
    .filter(([event]) => supportedEvents.has(event))
    .map(([event, groups]) => [event, convertHookGroups(pluginName, groups)])
    .filter(([, groups]) => groups.length > 0);
  return entries.length > 0
    ? { hooks: Object.fromEntries(entries) }
    : undefined;
}

function convertHookGroups(pluginName, groups) {
  return groups
    .map(group => ({
      ...(group.matcher !== undefined
        ? { matcher: normalizeMatcher(group.matcher) }
        : {}),
      hooks: (group.hooks ?? [])
        .map(hook => convertHookHandler(pluginName, hook))
        .filter(Boolean),
    }))
    .filter(group => group.hooks.length > 0);
}

function normalizeMatcher(matcher) {
  const normalized = String(matcher).replaceAll("Write|Edit", "Edit|Write");
  return normalized.includes("apply_patch")
    ? normalized
    : normalized.replaceAll("Edit|Write", "Edit|Write|apply_patch");
}

function convertHookHandler(pluginName, hook) {
  if (hook.type !== "command" || typeof hook.command !== "string") {
    return undefined;
  }
  const command = convertHookCommand(pluginName, hook.command);
  if (command === undefined) {
    return undefined;
  }
  return {
    type: "command",
    command,
    ...(hook.timeout !== undefined ? { timeout: hook.timeout } : {}),
    ...(hook.statusMessage !== undefined
      ? { statusMessage: hook.statusMessage }
      : {}),
  };
}

function convertHookCommand(pluginName, command) {
  const pluginScript = command.match(
    /\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[^ "';]+)/
  );
  if (!pluginScript) {
    return normalizeInlineCommand(command);
  }
  if (UNSUPPORTED_CODEX_HOOK_SCRIPTS.has(pluginScript[1])) {
    return undefined;
  }
  return buildPluginScriptRunner(pluginName, pluginScript[1]);
}

function normalizeInlineCommand(command) {
  const entireMatch = command.match(
    /^command -v entire >\/dev\/null 2>&1 && entire hooks claude-code ([a-z-]+) \|\| true$/
  );
  if (!entireMatch) {
    return command;
  }
  return `if command -v entire >/dev/null 2>&1; then entire hooks claude-code ${entireMatch[1]}; fi`;
}

function buildPluginScriptRunner(pluginName, scriptPath) {
  const script = JSON.stringify(scriptPath);
  const plugin = JSON.stringify(pluginName);
  return [
    "bash -lc '",
    `plugin=${shellQuote(plugin)}; script=${shellQuote(script)}; `,
    "repo=$(git rev-parse --show-toplevel 2>/dev/null || pwd); ",
    'for root in "${CODEX_PLUGIN_ROOT:-}" "${CLAUDE_PLUGIN_ROOT:-}" "$repo/plugins/$plugin" "$HOME/.codex/plugins/cache/lisa/$plugin/local"; do ',
    '[ -n "$root" ] || continue; ',
    'if [ -x "$root/$script" ]; then CLAUDE_PLUGIN_ROOT="$root" CODEX_PLUGIN_ROOT="$root" exec "$root/$script"; fi; ',
    "done; ",
    'found=$(find "$HOME/.codex/plugins/cache" -path "*/$plugin/*/$script" -type f -exec ls -t {} + 2>/dev/null | head -n 1); ',
    '[ -n "$found" ] || exit 0; ',
    "root=${found%/$script}; ",
    'CLAUDE_PLUGIN_ROOT="$root" CODEX_PLUGIN_ROOT="$root" exec "$found"',
    "'",
  ].join("");
}

function shellQuote(jsonStringLiteral) {
  return jsonStringLiteral.replaceAll("'", "'\\''");
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
