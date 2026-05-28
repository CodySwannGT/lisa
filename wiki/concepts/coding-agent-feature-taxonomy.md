# Coding-Agent Feature Taxonomy

Lisa installs into multiple coding agents. The features each agent exposes group into 12 stable categories. This taxonomy is the shared vocabulary for parity research, polyfill design, and per-agent installer scope.

## Category A: Plugin And Distribution Surfaces

Mechanisms by which a self-contained bundle of features is authored once and distributed: plugin manifests, marketplaces, install and uninstall subcommands, enable and disable toggles, version pinning, validation, import primitives, session-only loading, URL or archive installs, and enterprise-managed distribution.

## Category B: Authoring Components

The payloads a plugin or installation can carry: skills, sub-agents, slash commands, hooks, MCP servers, LSP servers, rules and instructions, memory files, workflows, monitors, apps and connectors, plugin-bundled settings, plugin-bundled MCP allow and deny lists, and plugin-bundled variables.

## Category C: Hook Events

Lifecycle events that trigger plugin-bundled or per-project hook handlers: pre-tool-use, post-tool-use, session-start, session-end, user-prompt-submit, stop, sub-agent-start, sub-agent-stop, pre-compact, post-compact, notification, permission-request, error-occurred, before-shell-execution, before-tab-file-read, plus hook types such as command, http, mcp-tool, prompt, and agent.

## Category D: Runtime Modes

Top-level execution shapes: interactive REPL, print or headless, plan, ask, autopilot, trust, sandbox, yolo or force, bare, ACP server, MCP server (the CLI itself serving MCP), remote or cloud session attach, and review.

## Category E: Inputs And I/O

Per-session input and output controls: model selection, reasoning effort, list models, fallback model, image input, image generation, output format (text, JSON, stream-JSON), input format, streaming, JSON-schema validation, system-prompt override or append, session naming, project init.

## Category F: Session Lifecycle

Resume by ID, continue most-recent, fork, persistence on or off, resume from PR or task ID, named-session lookup, session share to markdown or gist.

## Category G: Tools Surface

The agent-facing tool inventory and gating: file edit and write, file read and glob and search, shell, web fetch, web search, code search, sub-agent invocation, MCP-tool exposure, JavaScript REPL, apply-patch primitive, artifact creation, computer use, browser use, per-tool allowlist and denylist, per-path allowlist, per-URL allowlist and denylist, available-tools restriction, tool-search, tool-suggest, excluded-tools, secret-env-var redaction.

## Category H: MCP Transport And Configuration

MCP transports (stdio, HTTP, SSE), per-session MCP config, strict-MCP-config, MCP elicitation, MCP server management subcommands, built-in MCP servers, disable-built-in-MCP toggles.

## Category I: Auth And Identity

OAuth login, API-key auth, logout, status or whoami, long-lived setup tokens, commit attribution, enterprise policy or organization gates, BYOK custom model providers.

## Category J: Integrations

IDE auto-connect, VS Code and JetBrains integrations, shell-integration install, shell-completion scripts, Git-worktree support, tmux for worktree, Chrome or browser extension, remote control from web or mobile, scheduling or cron or automations, GitHub Actions integration, OpenTelemetry monitoring.

## Category K: Output And Sharing

Silent mode, plain diff versus rich diff, screen-reader mode, no-color, debug mode with filter, log-file override, verbose mode, banner display, mouse support in TUI, partial messages in stream, replay user messages.

## Category L: Miscellaneous Specialized Features

Max budget USD limit, prompt suggestions, persistent memories, multi-agent or fanout, child-agents AGENTS.md, request compression, guardian approval, shell snapshot, personality, fast mode, undo, unified exec, app server or app launcher, doctor or health check, project state management, prompt history search, theme picker, interactive rule generator, usage stats slash command, sidebar question while busy, goal-tracking slash command, context-inspection slash command, shared agent harness across CLI and desktop, multi-model provider support, dynamic sub-agents, asynchronous workflows, BASH_ENV support, no-ask-user autonomous mode, reasoning summaries.

## Why The Taxonomy Matters

The taxonomy is the row axis for parity work. Step 2 (per-agent support) and Step 3 (plugin-distributability) of the research protocol fill cells per feature per agent. Most parity surface area is concentrated in Category B (authoring components) and Category C (hook events). The categories D through L are largely CLI-flag or runtime-configuration surfaces and are not plugin-distributable on any current coding agent.
