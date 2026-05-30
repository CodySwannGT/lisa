---
name: parity-code-simplifier
description: Lisa-native parity placeholder for the upstream `code-simplifier@claude-plugins-official` plugin's code-simplifier agent. v1 SCAFFOLD ONLY — it marks intent and carries the drift-tracking pin; it does not yet reimplement the behavior. Reimplements the agent's code-simplification/refactor capability for the Codex and agy runtimes (Cursor loads the upstream agent natively; Copilot uses its native equivalent).
allowed-tools: ["Read", "Edit", "Write", "Bash"]
synced-from: code-simplifier@claude-plugins-official@1.0.0
---

# Parity: code-simplifier (SCAFFOLD)

> **Status: v1 SCAFFOLD / PLACEHOLDER.** The real simplification logic is **TODO / out-of-scope for v1**. This file exists to declare parity intent and to anchor the `synced-from` drift pin so `scripts/plugin-parity-drift.mjs` can flag when upstream moves ahead.

## What this reimplements

Upstream `code-simplifier@claude-plugins-official` ships a single `code-simplifier` **agent** that simplifies and refines recently modified code for clarity and maintainability while preserving behavior.

Per the approved routing artifact (`parity/plugin-routing/code-simplifier@claude-plugins-official.json`):

- **codex** → `reimplement` as this Lisa-native skill.
- **agy** → `reimplement` as this Lisa-native skill.
- **cursor** → `claude-only` (Cursor reads `.claude-plugin/` natively; no action).
- **copilot** → `enable-vendor-equivalent` (Copilot's native refactor capability; not reimplemented here).

## Drift tracking

Pinned to `code-simplifier@claude-plugins-official@1.0.0`. The drift detector compares this pin against the current upstream version in the plugin cache and reports staleness.

## TODO (not v1)

- [ ] Author the actual Lisa-native simplification workflow.
- [ ] Wire delivery to the Codex and agy runtimes.

**Do NOT port or copy upstream plugin code.** This is a Lisa-native shell — when the real logic is authored it must be written from scratch against Lisa conventions, not translated from the upstream agent.
