---
name: parity-sentry-seer
description: Lisa-native parity placeholder for the upstream `sentry@claude-plugins-official` plugin's `seer` command (Sentry's AI root-cause/issue-analysis workflow). v1 SCAFFOLD ONLY — declares intent and carries the drift-tracking pin; it does not yet reimplement the behavior. Reimplements the seer command for the Codex, agy, and Copilot runtimes (Cursor loads upstream natively). The sentry MCP itself is re-pointed separately, not by this skill.
allowed-tools: ["Read", "Edit", "Write", "Bash"]
synced-from: sentry@claude-plugins-official@1.0.0
---

# Parity: sentry seer command (SCAFFOLD)

> **Status: v1 SCAFFOLD / PLACEHOLDER.** The real seer workflow logic is **TODO / out-of-scope for v1**. This file declares parity intent and anchors the `synced-from` drift pin.

## What this reimplements

Upstream `sentry@claude-plugins-official` ships a `seer` **command** that drives Sentry's AI-assisted issue root-cause / fix workflow.

Per the approved routing artifact (`parity/plugin-routing/sentry@claude-plugins-official.json`), the sentry plugin's dominant component is its HTTP MCP, which is **re-pointed** per agent (Codex `.codex-plugin` pointer, agy `mcp-installer`, Copilot inline `mcpServers`) — that re-point is handled separately, NOT by this skill. The `seer` command is reimplemented as a Lisa-native skill so its component group is not dropped:

- **codex** → `reimplement` the seer command as this Lisa-native skill.
- **agy** → `reimplement` the seer command as this Lisa-native skill.
- **copilot** → `reimplement` the seer command as this Lisa-native skill.
- **cursor** → `already-native` (Cursor reads `.claude-plugin/` natively; no action).

## Drift tracking

Pinned to `sentry@claude-plugins-official@1.0.0`. (The 30 SDK-setup skills are tracked separately by `parity-sentry-sdk-suite`.)

## TODO (not v1)

- [ ] Author the Lisa-native seer workflow against the re-pointed sentry MCP.
- [ ] Wire delivery to the Codex, agy, and Copilot runtimes.

**Do NOT port or copy upstream plugin code.** Reimplement from scratch against Lisa conventions; this is a native shell, not a translation of the upstream command.
