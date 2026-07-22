# Parity routing review — `sentry@claude-plugins-official`

- **Plugin:** `sentry@claude-plugins-official`
- **Upstream version:** `1.2.0`
- **Analyzed:** 2026-07-22 (re-review; originally 2026-05-30 at 1.0.0)
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| mcp | `sentry` | `.mcp.json` | mcp-server | HTTP MCP server (https://mcp.sentry.dev/mcp). Declared in .mcp.json, root mcp.json, and plugin.json mcpServers — deduped to one logical MCP component. |
| command | `seer` | `commands/seer.md` | claude-command | Sentry Seer slash command. |
| skill | `sentry-android-sdk` | `skills/sentry-android-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-browser-sdk` | `skills/sentry-browser-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-cloudflare-sdk` | `skills/sentry-cloudflare-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-cocoa-sdk` | `skills/sentry-cocoa-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-code-review` | `skills/sentry-code-review/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-create-alert` | `skills/sentry-create-alert/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-dotnet-sdk` | `skills/sentry-dotnet-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-elixir-sdk` | `skills/sentry-elixir-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-feature-setup` | `skills/sentry-feature-setup/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-fix-issues` | `skills/sentry-fix-issues/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-flutter-sdk` | `skills/sentry-flutter-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-go-sdk` | `skills/sentry-go-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-nestjs-sdk` | `skills/sentry-nestjs-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-nextjs-sdk` | `skills/sentry-nextjs-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-node-sdk` | `skills/sentry-node-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-otel-exporter-setup` | `skills/sentry-otel-exporter-setup/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-php-sdk` | `skills/sentry-php-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-pr-code-review` | `skills/sentry-pr-code-review/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-python-sdk` | `skills/sentry-python-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-react-native-sdk` | `skills/sentry-react-native-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-react-router-framework-sdk` | `skills/sentry-react-router-framework-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-react-sdk` | `skills/sentry-react-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-ruby-sdk` | `skills/sentry-ruby-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-sdk-setup` | `skills/sentry-sdk-setup/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-sdk-skill-creator` | `skills/sentry-sdk-skill-creator/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-sdk-upgrade` | `skills/sentry-sdk-upgrade/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-setup-ai-monitoring` | `skills/sentry-setup-ai-monitoring/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-svelte-sdk` | `skills/sentry-svelte-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-tanstack-start-sdk` | `skills/sentry-tanstack-start-sdk/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |
| skill | `sentry-workflow` | `skills/sentry-workflow/SKILL.md` | claude-skill | Sentry SDK/workflow skill. |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `re-point-mcp-lsp` | - emit the sentry HTTP MCP into Codex's .codex-plugin MCP pointer<br>- reimplement the 30 SDK skills as Lisa-native skills stamped synced-from: sentry@claude-plugins-official@1.0.0 (or claude-only where a skill is Claude-specific)<br>- reimplement the seer command as a Lisa-native skill stamped synced-from: sentry@claude-plugins-official@1.0.0 | The dominant component is the sentry HTTP MCP, re-pointed into Codex's .codex-plugin pointer; the seer command and the SDK skills are reimplemented as Lisa skills so no component group is dropped. |
| cursor | `already-native` | - Cursor's variant emits mcp.json from .mcp.json, so the sentry MCP is already native<br>- the 30 SDK skills and the seer command load via Cursor's native .claude-plugin/ reading | Cursor reads .claude-plugin/ natively and its variant emits mcp.json from .mcp.json, so all component groups are already covered with no action. |
| agy | `re-point-mcp-lsp` | - emit the sentry HTTP MCP via agy's user-global mcp-installer (src/agy/mcp-installer.ts)<br>- reimplement the 30 SDK skills as Lisa-native skills stamped synced-from: sentry@claude-plugins-official@1.0.0 (or claude-only where Claude-specific)<br>- reimplement the seer command as a Lisa-native skill stamped synced-from: sentry@claude-plugins-official@1.0.0 | The dominant component is the sentry HTTP MCP, re-pointed via agy's mcp-installer; the seer command and the SDK skills are reimplemented as Lisa skills (agy's fan-out does not carry curated third-party plugins). |
| copilot | `re-point-mcp-lsp` | - emit the sentry HTTP MCP as an inline mcpServers entry on Copilot's manifest<br>- reimplement the 30 SDK skills as Lisa-native skills stamped synced-from: sentry@claude-plugins-official@1.0.0 (or enable Copilot's native equivalent where applicable)<br>- reimplement the seer command as a Lisa-native skill stamped synced-from: sentry@claude-plugins-official@1.0.0 | The dominant component is the sentry HTTP MCP, emitted inline on Copilot's manifest; the seer command and the SDK skills are reimplemented as Lisa skills so no component group is dropped. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.

## Addendum — 2026-07-22 re-review at upstream 1.2.0 (issue #1955)

Upstream 1.2.0 restructured the plugin: the ~30 per-SDK skills are consolidated
into 10 skills (dominated by `sentry-instrument`), the `seer` command is folded
into `sentry-debug-issue`, and the MCP server is declared inline on the plugin
manifest. The Lisa parity skills (`lisa-parity-sentry-sdk-setup`,
`lisa-parity-sentry-seer`) were reviewed against 1.2.0, absorbed the material
guidance changes (install scope gating; untrusted-event-data rules), and re-pinned.

**Claude-side change.** The original routing accepted an "identical-config
benign duplicate" on Claude/Cursor: the base lisa plugin bundles the sentry MCP
(for codex/agy/copilot/cursor) while `install-claude-plugins.sh` also installed
the upstream plugin, so every Claude session registered the Sentry MCP twice.
As of issue #1955 the bundled server is canonical on every agent: the upstream
`sentry@claude-plugins-official` plugin is no longer installed (a version-gated
uninstall retires existing installs) and the merge settings templates set its
`enabledPlugins` entry to `false`. Sentry workflows on Claude are owned by the
Lisa parity skills.
