---
name: parity-code-review
description: Lisa-native parity placeholder for the upstream `code-review@claude-plugins-official` plugin's code-review command. v1 SCAFFOLD ONLY — declares intent; it does not yet reimplement the behavior. Reimplements the code-review command for the Codex and agy runtimes (Cursor loads upstream natively; Copilot uses its native review equivalent). NO drift pin: upstream publishes no semver, so it is not drift-trackable.
allowed-tools: ["Read", "Edit", "Write", "Bash"]
---

# Parity: code-review command (SCAFFOLD)

> **Status: v1 SCAFFOLD / PLACEHOLDER.** The real review logic is **TODO / out-of-scope for v1**. This file declares parity intent only.

## Not drift-trackable

**This scaffold intentionally carries NO `synced-from` pin.** The upstream `code-review@claude-plugins-official` plugin publishes **no semver** (its cache version resolves to `unknown`/none), so a `@unknown` pin would be unparseable and meaningless to the drift detector. **Drift for this reimplementation is tracked manually** — review the upstream plugin by hand when the curated plugin set is refreshed.

## What this reimplements

Upstream ships a single `code-review` **command**.

Per the approved routing artifact (`parity/plugin-routing/code-review@claude-plugins-official.json`):

- **codex** → `reimplement` the code-review command as this Lisa-native skill.
- **agy** → `reimplement` the code-review command as this Lisa-native skill.
- **cursor** → `claude-only` (the command loads unchanged).
- **copilot** → `enable-vendor-equivalent` (Copilot's native pull-request/code-review capability; not reimplemented here).

## TODO (not v1)

- [ ] Author the Lisa-native code-review workflow.
- [ ] Wire delivery to the Codex and agy runtimes.
- [ ] Manual drift check: compare against upstream `code-review@claude-plugins-official` (no semver → not automatable).

**Do NOT port or copy upstream plugin code.** Reimplement from scratch against Lisa conventions; this is a native shell, not a translation of the upstream command.
