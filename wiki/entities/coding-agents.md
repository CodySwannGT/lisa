# Coding Agents Lisa Installs Into

Lisa is distributed for multiple coding agents. Each agent has its own CLI, plugin format, configuration home, and quirks. This page profiles the current fleet so parity research, polyfill design, and installer scope can reference one shared description.

## Claude Code

- CLI: `claude` (current probed version 2.1.156).
- Configuration home: `~/.claude/`.
- Plugin manifest: `.claude-plugin/plugin.json` with auto-discovered `skills/`, `agents/`, `commands/` directories and a `hooks` block.
- Marketplace: `.claude-plugin/marketplace.json` at repository root.
- Installed plugin location: `~/.claude/plugins/`.
- Plugin-root environment variable for hook commands: `${CLAUDE_PLUGIN_ROOT}`.
- Unique features: bare mode, `--from-pr` resume, JSON-Schema output validation, JetBrains integration, tmux for worktree, Chrome integration, long-lived setup tokens, fallback model, monitors as plugin component, max-budget-USD limit.
- Lisa distribution: GitHub marketplace `CodySwannGT/lisa`, eight plugins (lisa, lisa-typescript, lisa-expo, lisa-nestjs, lisa-cdk, lisa-rails, lisa-harper-fabric, lisa-wiki) plus the openclaw plugin.

## Codex

- CLI: `codex` (current probed version 0.125.0).
- Configuration home: `~/.codex/`.
- Plugin manifest: `.codex-plugin/plugin.json` with `skills`, `mcpServers`, `apps`, and optional inline `hooks` block (plugin-bundled hooks became real in 0.125.0).
- Marketplace: `~/.codex/config.toml` `[marketplaces.<name>]` entries plus repository-side `.agents/plugins/marketplace.json` (or `.claude-plugin/marketplace.json`).
- Installed plugin location: `~/.codex/plugins/cache/<marketplace>/<plugin>/<version-or-local>/`.
- Hook events supported in 0.125.0: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`. Hooks are gated by `[features].codex_hooks = true` in `config.toml`.
- Unique features: app connectors via `.app.json`, computer use, browser use, in-app browser, image generation, MCP elicitation, request compression, shell snapshot, app server and app launcher, JavaScript REPL (experimental), tool-search, tool-suggest, theme picker, prompt-history search, guardian approval, personality.
- Sub-agents are configuration-level (`[agents.<role>]` blocks), not a plugin component.
- Slash commands are absent — Codex has no `commands` field in its plugin manifest.
- Lisa installers: `src/codex/agent-installer.ts`, `src/codex/agents-md-installer.ts`, `src/codex/command-skill-transformer.ts`, `src/codex/hooks-installer.ts`, `src/codex/hooks-merger.ts`, `src/codex/plugin-marketplace-installer.ts`, `src/codex/settings-installer.ts`, `src/codex/skills-installer.ts`, `src/codex/manifest.ts`.

## Cursor

- CLI: `cursor-agent` (current probed version 2026.05.28-418efe5).
- Configuration home: `~/.cursor/`. Installed plugins share the `~/.claude/plugins/` cache tree.
- Plugin manifest: accepts both `.cursor-plugin/plugin.json` and `.claude-plugin/plugin.json`. The loader's `discoverComponents` covers skills, agents, commands, and rules.
- Distribution: marketplace via Cursor backend RPCs (`RegisterMarketplaceAndPlugins`), session-only via `--plugin-dir <path>` (repeatable).
- Hooks: read from the plugin's hooks block, auto-normalizes Claude-style event names (`PreToolUse` becomes `preToolUse`).
- Unique features: rule auto-discovery from plugin `rules/`, plugin-bundled `variables` schema, `before-shell-execution` and `before-tab-file-read` hook events, `ask` mode, cloud worker subcommand, interactive rule generator, `/usage` slash command.
- Lisa distribution today: the existing Claude-format plugins load directly through `--plugin-dir` or via the registered marketplace; no dedicated Cursor installer exists yet.

## Antigravity (`agy`)

- CLI: `agy` (current probed version 1.0.3).
- Configuration home: `~/.gemini/antigravity-cli/` (per-CLI state) and `~/.gemini/config/` (shared with Antigravity desktop).
- Plugin manifest: bare `plugin.json` at the plugin root (not `.claude-plugin/`, not `.gemini-plugin/`).
- Plugin components: `skills/`, `agents/<n>.md` (Claude-format), `commands/` (which `agy` auto-converts into skills at install), `hooks/hooks.json`. MCP is **not** a plugin component on agy — it lives at `~/.gemini/config/mcp_config.json` (user-shared) or `.agents/mcp_config.json` (project-level).
- MCP schema requires `serverUrl` for HTTP transports (not Claude or Codex `url`).
- Installed plugin location: `~/.gemini/config/plugins/<plugin-name>/`.
- Memory file: agy auto-loads `AGENTS.md` since v1.20.3, also reads `GEMINI.md` with GEMINI precedence on conflicts.
- Plugin subsystem subcommands: `install`, `uninstall`, `enable`, `disable`, `validate`, `link`, `import` (with `gemini` or `claude` sources). `agy plugin import claude` returns "No claude extensions found" empirically and is not a viable Lisa distribution path.
- Critical caveat: agy plugin-bundled hooks pass schema validation and the file installs correctly, but **registered hook handlers do not fire in `-p` headless mode**. Lisa cannot use the SessionStart-hook polyfill strategy for headless agy flows; alternative is to bake content into AGENTS.md.
- Multi-model provider: connects to Gemini 3.5 Flash by default, with Claude and GPT-OSS support.
- Unique features: dynamic sub-agents spawned on the fly, asynchronous workflows, `/btw` side-question slash command, `/goal`, `/context`, `/schedule`, three-tier authoring (rules, skills, workflows), shared agent harness with Antigravity 2.0 desktop, first-class `plugin validate` subcommand, first-class `plugin import [source]` primitive.
- Lisa distribution today: no installer yet. Pattern B variant target: `plugins/lisa-agy/` with bare `plugin.json` at root.

## GitHub Copilot

- CLI: `copilot` (current probed version 1.0.55).
- Configuration home: `~/.copilot/`.
- Plugin manifest lookup order: `plugin.json` then `.plugin/plugin.json` then `.github/plugin/plugin.json` then `.claude-plugin/plugin.json` — Copilot reads Claude-format plugins natively.
- Plugin components: `agents/<n>.agent.md` (note `.agent.md` extension), `skills/<n>/SKILL.md`, `commands/`, manifest `hooks`, manifest inline `mcpServers`, manifest `lspServers`. Copilot does not auto-discover a plugin-bundled `.mcp.json` file or a path-string pointer.
- Installed plugin location: `~/.copilot/installed-plugins/<marketplace>/<plugin>/` or `~/.copilot/installed-plugins/_direct/`.
- Marketplace: `CodySwannGT/lisa` is already a registered marketplace on this machine; `copilot plugin install lisa@CodySwannGT/lisa` is the documented install path.
- MCP layers: User `~/.copilot/mcp-config.json`, Workspace `.mcp.json`, Plugin — three layers, the most of any agent.
- Hook events: `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `userPromptSubmitted`, `agentStop`, `subagentStop`, `errorOccurred`.
- Default sub-agents: `explore`, `task`, `general-purpose`, `code-review`, `research`.
- Unique features: ACP server mode (`--acp`), enterprise-managed plugins (public preview since 2026-05-06), BASH_ENV support, `--no-ask-user` autonomous mode, secret-env-var redaction, screen-reader mode, autopilot mode with `--max-autopilot-continues`, session share to gist, named-session lookup, BYOK custom model providers, LSP servers as a plugin component, OpenTelemetry monitoring.
- Lisa distribution today: generated `plugins/*-copilot/` variants strip unsupported `subagentStart` hooks, keep `sessionStart` rule injection, rename sub-agent files to `<n>.agent.md`, and inline valid non-empty `mcpServers` objects when a source `.mcp.json` exists.
