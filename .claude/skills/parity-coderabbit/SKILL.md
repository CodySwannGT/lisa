---
name: parity-coderabbit
description: Lisa-native parity placeholder for the upstream `coderabbit@claude-plugins-official` plugin (its code-reviewer agent, coderabbit-review command, and autofix + code-review skills). v1 SCAFFOLD ONLY — declares intent and carries the drift-tracking pin; it does not yet reimplement the behavior. Reimplements the CodeRabbit review/autofix capability for the Codex and agy runtimes (Cursor loads upstream natively; Copilot enables its native review equivalent but the CodeRabbit-specific autofix is reimplemented).
allowed-tools: ["Read", "Edit", "Write", "Bash"]
synced-from: coderabbit@claude-plugins-official@1.1.1
---

# Parity: coderabbit (SCAFFOLD)

> **Status: v1 SCAFFOLD / PLACEHOLDER.** The real review/autofix logic is **TODO / out-of-scope for v1**. This file declares parity intent and anchors the `synced-from` drift pin.

## What this reimplements

Upstream `coderabbit@claude-plugins-official` ships four components:

- **agent** `code-reviewer` — subagent wrapping the CodeRabbit CLI review.
- **command** `coderabbit-review`.
- **skill** `autofix`.
- **skill** `code-review`.

Per the approved routing artifact (`parity/plugin-routing/coderabbit@claude-plugins-official.json`):

- **codex** → `reimplement` every component group as Lisa-native skills (this scaffold).
- **agy** → `reimplement` every component group as Lisa-native skills (this scaffold).
- **cursor** → `claude-only` (agent, command, and skills load unchanged).
- **copilot** → `enable-vendor-equivalent` for the review components; the CodeRabbit-specific `autofix` skill has no native equivalent and is reimplemented.

The CodeRabbit CLI itself is agent-agnostic and can be invoked from the reimplemented skills.

## Drift tracking

Pinned to `coderabbit@claude-plugins-official@1.1.1`.

## TODO (not v1)

- [ ] Reimplement the `code-reviewer` agent behavior as a Lisa-native skill.
- [ ] Reimplement the `coderabbit-review` command.
- [ ] Reimplement the `autofix` and `code-review` skills.
- [ ] Wire delivery to the Codex and agy runtimes.

**Do NOT port or copy upstream plugin code.** Reimplement from scratch against Lisa conventions; this is a native shell, not a translation of the upstream plugin.
