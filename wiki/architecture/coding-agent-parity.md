# Coding-Agent Parity Architecture

Lisa installs into five coding agents (Claude Code, Codex, Cursor, Antigravity, GitHub Copilot). Each agent has its own plugin format, configuration home, hook event model, and runtime quirks. This document describes how Lisa achieves feature parity across the fleet through a combination of plugin distribution, per-project installers, and per-agent plugin variants.

## Per-Agent Installer Surface

Lisa code that targets a specific agent lives under `src/<agent>/`. Today only `src/codex/` exists. The architecture anticipates `src/cursor/`, `src/agy/`, `src/copilot/`, and possibly `src/claude/` for symmetry.

Each per-agent installer owns one or more of:

- Plugin distribution glue (`<agent> plugin install` invocation against a Lisa-shaped plugin payload).
- Per-project artifact writers for features that are not plugin-distributable on that agent (sub-agents on Codex, MCP on agy, etc.).
- Tagged-merge logic when a file Lisa writes is also user-authored (Codex `.codex/hooks.json`, Cursor `enabledPlugins` map).
- Stale-cleanup tracking through a managed-files manifest (`.codex/.lisa-managed.json` for Codex; mirrored convention for other agents).

The Codex installer suite is the canonical reference and includes ten TypeScript modules: `agent-installer.ts`, `agent-transformer.ts`, `agents-md-installer.ts`, `command-skill-transformer.ts`, `hooks-installer.ts`, `hooks-merger.ts`, `manifest.ts`, `plugin-marketplace-installer.ts`, `settings-installer.ts`, and `skills-installer.ts`.

## Plugin Payload Versus Per-Project Installer

Two distribution channels coexist:

- **Plugin payload**: components carried inside a Lisa plugin (`plugins/lisa/`, `plugins/lisa-typescript/`, etc.). Auto-discovered by the agent's plugin loader. Surface: skills, sub-agents on agents that support plugin sub-agents, slash commands on agents that support them, hooks on agents that support plugin-bundled hooks, MCP servers on agents that allow plugin-bundled MCP, rules on Cursor only.
- **Per-project installer**: TypeScript code in `src/<agent>/` that runs during `lisa apply` and writes files into the host project under `.<agent>/` (`.codex/`, `.agy/`, etc.) or into shared user config (`~/.gemini/config/mcp_config.json`). Surface: everything the agent supports but cannot carry in a plugin.

The split is per-feature, per-agent. The full mapping is in the parity research artifact's Step 4 polyfill designs; the high-level pattern is:

- Skills, sub-agents (when supported in plugins), slash commands (when supported), hooks (when supported and runtime fires), MCP (when supported and not platform-shared): plugin payload.
- Sub-agents on Codex, MCP on agy, rules on Claude or Codex, memory file (AGENTS.md or CLAUDE.md) anywhere, settings anywhere: per-project installer.

## Polyfill Strategies

When a feature is absent on an agent or not plugin-distributable, Lisa polyfills through one of five strategies. The choice depends on what surface the agent does expose.

- **Translate**: emit the feature in a different shape the agent supports. Codex commands become `lisa-`-prefixed skills via `src/codex/command-skill-transformer.ts`.
- **Wrap**: invoke a non-plugin installer at apply time to write the feature into a non-plugin location. agy MCP servers write `~/.gemini/config/mcp_config.json` (with a `url` → `serverUrl` adapter for HTTP transports).
- **Bake**: fold feature content into a different surface the agent does auto-load. agy rules are baked into the AGENTS.md template that agy auto-loads at session start.
- **Skip**: document the feature as agent-only and ship no polyfill. Copilot LSP servers, Codex app connectors, and Claude monitors are agent-unique components Lisa does not currently use.
- **Block**: declare the gap blocked, route to a separate work item to either pressure upstream or rethink Lisa's reliance. agy plugin-bundled hooks not firing in headless mode is the canonical Block — Lisa's SessionStart-hook strategy for rules injection cannot run on agy in `-p` mode and is replaced by the Bake-into-AGENTS.md alternative.

## Pattern B: Per-Agent Plugin Variants

Lisa's plugins are built from shared source under `plugins/src/` into per-agent artifacts. The decision to maintain per-agent plugin variants (as opposed to a single shared plugin with runtime detection) is documented in `wiki/decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md`.

The build pipeline:

- `scripts/build-plugins.sh` does `rm -rf plugins/lisa && cp -r plugins/src/base` to produce the Claude artifact.
- `scripts/generate-codex-plugin-artifacts.mjs` derives the Codex-side `.codex-plugin/plugin.json` and skills pointer from the built Claude artifact.
- Future generators (`scripts/generate-cursor-plugin-artifacts.mjs`, `scripts/generate-agy-plugin-artifacts.mjs`, `scripts/generate-copilot-plugin-artifacts.mjs`) produce per-agent variants by stripping Claude-only hooks, applying agent-specific filename adapters (Copilot `.agent.md`, agy bare `plugin.json`), and reshaping manifest fields.

Plugin artifacts are generated build output. The source of truth is `plugins/src/`. Editing a generated artifact directly is overwritten on the next build.

## 3rd-Party Plugin Parity Subsystem

Lisa now has a Lisa-internal workflow for curated 3rd-party Claude plugins. It does not distribute downstream through `plugins/src/`; it lives under root `.claude/` and is used to decide how Lisa should make an approved plugin capability available across Codex, Cursor, agy, and Copilot without porting plugin code.

The workflow has three commands:

- `/analyze-plugin` inventories a curated plugin, classifies every component, records the upstream version, and emits one routing decision per agent. It is plan-only and stops for human approval.
- `/implement-plugin-parity` consumes an approved routing artifact and makes deterministic changes only. It reuses existing per-agent generators and installers, and creates `synced-from`-stamped skill reimplementations only when reimplementation is the approved last resort.
- `/plugin-parity-drift` runs `scripts/plugin-parity-drift.mjs` to scan reimplemented skills with `synced-from: <plugin>@<marketplace>@<version>`, compare them to the current installed upstream plugin version, and report stale reimplementations without auto-bumping them.

Routing prefers first-applicable reuse: already native, re-point MCP or LSP, enable a vendor equivalent, Claude-only, then reimplement. Version pins and drift checks apply only to reimplementations; MCP/LSP re-points and vendor equivalents do not carry pins. Claude continues to use native plugins directly.

The first approved parity implementation pass landed in PR `#1082`. It approved all seven curated routing artifacts, re-pointed Sentry MCP for Codex, agy, Copilot, and Cursor through the base `.mcp.json`, and scaffolded seven `synced-from` pinned reimplementation placeholder skills for components whose approved route is reimplementation. Deferred parity work for LSP subsystem support and vendor-equivalent routing is now tracked explicitly instead of being silently implied.

PR `#1085` replaced those placeholders with real cross-agent implementations for the curated-plugin parity set. The operating model stays the same: Claude uses native curated plugins directly, while non-Claude agents receive approved reimplementations only where the routing artifact chose that strategy and drift tracking can compare the reimplementation against the pinned upstream plugin version.

## Polyfill Collision Discipline

Every place Lisa polyfills a feature, that polyfill must not run on an agent that natively supports the same feature in the same plugin. The canonical collision is rules: Claude does not auto-load `rules/` from a plugin, so Lisa polyfills with a SessionStart hook; Cursor does auto-load `rules/` from a plugin, so the same hook running on Cursor would double-inject the rules content.

Pattern B solves the collision by giving each agent its own plugin artifact. The Cursor variant strips the SessionStart `inject-rules.sh` hook and lets Cursor's native discovery do the work; the Claude variant keeps the hook because Claude has no native discovery.

## CLI Invocation Standard

Research and verification runs against the agent CLIs use a standard model and reasoning-effort pairing per CLI, documented in the `lisa-coding-agent-parity` skill. Probes that pick a smaller model or lower effort produce shallower findings and should be flagged as preliminary.

## Memory References

- `reference-codex-hooks-capabilities`: Codex hook events, context-injection shape, blocking semantics, apply_patch envelope. Currently stale through Codex 0.125.0's expanded event list — refresh after the next implementation pass.
- `reference-codex-plugin-skill-loading`: the `.codex-plugin` skills pointer convention.
- `reference-codex-commit-attribution`: Codex commit attribution config and Lisa hook accept rules.
- `reference-codex-http-mcp-plugin-shape`: Codex accepts Claude's `{type,url}` MCP shape via plugin pointer.
- `reference-codex-automations`: Codex automation scheduling.
- `reference-codex-cli-collaboration`: non-interactive `codex exec` patterns.
- `reference-lisa-hook-delivery`: how Lisa hooks reach projects across distribution channels.

Per-agent capability memory entries for Cursor, agy, and Copilot do not yet exist. The first `[VERIFIED-BY-RUN]` load-bearing finding about each agent should be written as a memory entry so future research passes start from current knowledge.
