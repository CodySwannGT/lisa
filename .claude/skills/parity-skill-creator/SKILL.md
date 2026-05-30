---
name: parity-skill-creator
description: Lisa-native parity placeholder for the upstream `skill-creator@claude-plugins-official` plugin's skill-creator skill (authoring new Claude skills). v1 SCAFFOLD ONLY — declares intent; it does not yet reimplement the behavior. Reimplements skill-creator for the Codex, agy, and Copilot runtimes (Cursor loads upstream natively). NO drift pin: upstream publishes no semver, so it is not drift-trackable.
allowed-tools: ["Read", "Edit", "Write", "Bash"]
---

# Parity: skill-creator (SCAFFOLD)

> **Status: v1 SCAFFOLD / PLACEHOLDER.** The real skill-authoring logic is **TODO / out-of-scope for v1**. This file declares parity intent only.

## Not drift-trackable

**This scaffold intentionally carries NO `synced-from` pin.** The upstream `skill-creator@claude-plugins-official` plugin publishes **no semver** (its cache version resolves to `unknown`/none), so a `@unknown` pin would be unparseable and meaningless to the drift detector. **Drift for this reimplementation is tracked manually** — review the upstream plugin by hand when the curated plugin set is refreshed.

## What this reimplements

Upstream ships a single `skill-creator` **skill** that scaffolds and authors new Claude skills.

Per the approved routing artifact (`parity/plugin-routing/skill-creator@claude-plugins-official.json`):

- **codex** → `reimplement` as this Lisa-native skill.
- **agy** → `reimplement` as this Lisa-native skill.
- **copilot** → `reimplement` (Copilot ships no concrete equivalent for authoring Claude skills, so it falls through the preference order to reimplement).
- **cursor** → `claude-only` (the skill loads unchanged).

## TODO (not v1)

- [ ] Author the Lisa-native skill-creation workflow.
- [ ] Wire delivery to the Codex, agy, and Copilot runtimes.
- [ ] Manual drift check: compare against upstream `skill-creator@claude-plugins-official` (no semver → not automatable).

**Do NOT port or copy upstream plugin code.** Reimplement from scratch against Lisa conventions; this is a native shell, not a translation of the upstream skill.
