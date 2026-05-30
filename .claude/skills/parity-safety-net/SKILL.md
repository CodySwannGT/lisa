---
name: parity-safety-net
description: Lisa-native parity placeholder for the upstream `safety-net@cc-marketplace` plugin (its PreToolUse Bash-guard hook plus the set-custom-rules and verify-custom-rules skills). v1 SCAFFOLD ONLY — declares intent and carries the drift-tracking pin; it does not yet reimplement the behavior. Reimplements the Bash-command guard hook and its rule-management skills for the Codex and agy runtimes (Cursor loads upstream natively; Copilot enables safety-net's native Copilot CLI runner).
allowed-tools: ["Read", "Edit", "Write", "Bash"]
synced-from: safety-net@cc-marketplace@0.9.0
---

# Parity: safety-net (SCAFFOLD)

> **Status: v1 SCAFFOLD / PLACEHOLDER.** The real guard-hook and rule-management logic is **TODO / out-of-scope for v1**. This file declares parity intent and anchors the `synced-from` drift pin.

## What this reimplements

Upstream `safety-net@cc-marketplace` ships three components:

- **hook** `pretooluse-bash-guard` — a PreToolUse hook that vets Bash commands against configurable safety rules before they run.
- **skill** `set-custom-rules`.
- **skill** `verify-custom-rules`.

Per the approved routing artifact (`parity/plugin-routing/safety-net@cc-marketplace.json`):

- **codex** → `reimplement` the hook plus both rule-management skills as Lisa-native components (this scaffold).
- **agy** → `reimplement` the hook plus both rule-management skills as Lisa-native components (this scaffold).
- **cursor** → `claude-only` (the hook and both skills load unchanged).
- **copilot** → `enable-vendor-equivalent` (safety-net's native `cc-safety-net --copilot-cli` runner and its built-in rule-management commands; not reimplemented here).

### Delivery note for the hook

A hook-bearing plugin has no MCP/LSP re-point. When the real logic is authored, the Lisa-native PreToolUse Bash-guard hook will be **delivered via the per-agent hook generators** (the fan-out machinery from #1054–#1058), not bundled in this skill. This skill is only the parity marker / drift anchor for that future hook.

## Drift tracking

Pinned to `safety-net@cc-marketplace@0.9.0`.

## TODO (not v1)

- [ ] Author the Lisa-native PreToolUse Bash-guard hook logic.
- [ ] Wire the hook through the per-agent hook generators for Codex and agy.
- [ ] Reimplement the `set-custom-rules` and `verify-custom-rules` skills.

**Do NOT port or copy upstream plugin code.** Reimplement from scratch against Lisa conventions; this is a native shell, not a translation of the upstream plugin.
