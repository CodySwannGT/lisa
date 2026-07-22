# Parity routing review — `sentry@claude-plugins-official`

- **Plugin:** `sentry@claude-plugins-official`
- **Upstream version:** `1.2.0`
- **Analyzed:** 2026-07-22 (re-review; originally 2026-05-30 at 1.0.0)
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| mcp | `sentry` | `.claude-plugin/plugin.json` | mcp-server | HTTP MCP server (https://mcp.sentry.dev/mcp?utm_source=plugin). As of 1.2.0 declared inline in plugin.json mcpServers only. |
| skill | `sentry-create-alert` | `skills/sentry-create-alert/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-debug-issue` | `skills/sentry-debug-issue/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-feature-setup` | `skills/sentry-feature-setup/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-get-started` | `skills/sentry-get-started/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-instrument` | `skills/sentry-instrument/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-otel-exporter-setup` | `skills/sentry-otel-exporter-setup/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-sdk-upgrade` | `skills/sentry-sdk-upgrade/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-setup-ai-monitoring` | `skills/sentry-setup-ai-monitoring/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-snapshots-cocoa` | `skills/sentry-snapshots-cocoa/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |
| skill | `sentry-workflow` | `skills/sentry-workflow/SKILL.md` | claude-skill | Consolidated Sentry workflow skill (1.2.0). |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `re-point-mcp-lsp` | - emit the sentry HTTP MCP into Codex's .codex-plugin MCP pointer<br>- reimplement the 10 consolidated workflow skills as Lisa-native skills (Lisa consolidates further into lisa-parity-sentry-sdk-setup) stamped synced-from: sentry@claude-plugins-official@1.2.0 (or claude-only where a skill is Claude-specific)<br>- reimplement the sentry-debug-issue AI-debugging workflow (formerly the seer command) as a Lisa-native skill (lisa-parity-sentry-seer) stamped synced-from: sentry@claude-plugins-official@1.2.0 | The dominant component is the sentry HTTP MCP, re-pointed into Codex's .codex-plugin pointer; the consolidated workflow skills (incl. the folded-in seer/debug workflow) are reimplemented as Lisa skills so no component group is dropped. |
| cursor | `already-native` | - Cursor's variant emits mcp.json from .mcp.json, so the sentry MCP is already native<br>- the 10 consolidated skills load via Cursor's native .claude-plugin/ reading | Cursor reads .claude-plugin/ natively and its variant emits mcp.json from .mcp.json, so all component groups are already covered with no action. |
| agy | `re-point-mcp-lsp` | - emit the sentry HTTP MCP via agy's user-global mcp-installer (src/agy/mcp-installer.ts)<br>- reimplement the 10 consolidated workflow skills as Lisa-native skills (Lisa consolidates further into lisa-parity-sentry-sdk-setup) stamped synced-from: sentry@claude-plugins-official@1.2.0 (or claude-only where Claude-specific)<br>- reimplement the sentry-debug-issue AI-debugging workflow (formerly the seer command) as a Lisa-native skill (lisa-parity-sentry-seer) stamped synced-from: sentry@claude-plugins-official@1.2.0 | The dominant component is the sentry HTTP MCP, re-pointed via agy's mcp-installer; the consolidated workflow skills (incl. the folded-in seer/debug workflow) are reimplemented as Lisa skills (agy's fan-out does not carry curated third-party plugins). |
| copilot | `re-point-mcp-lsp` | - emit the sentry HTTP MCP as an inline mcpServers entry on Copilot's manifest<br>- reimplement the 10 consolidated workflow skills as Lisa-native skills (Lisa consolidates further into lisa-parity-sentry-sdk-setup) stamped synced-from: sentry@claude-plugins-official@1.2.0 (or enable Copilot's native equivalent where applicable)<br>- reimplement the sentry-debug-issue AI-debugging workflow (formerly the seer command) as a Lisa-native skill (lisa-parity-sentry-seer) stamped synced-from: sentry@claude-plugins-official@1.2.0 | The dominant component is the sentry HTTP MCP, emitted inline on Copilot's manifest; the consolidated workflow skills (incl. the folded-in seer/debug workflow) are reimplemented as Lisa skills so no component group is dropped. |

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
