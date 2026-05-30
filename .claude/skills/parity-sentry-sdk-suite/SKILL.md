---
name: parity-sentry-sdk-suite
description: Single Lisa-native parity tracking placeholder for the 30 SDK-setup / workflow skills shipped by the upstream `sentry@claude-plugins-official` plugin. v1 SCAFFOLD ONLY — one tracking marker for the whole suite (NOT 30 separate skills); declares intent and carries the drift-tracking pin; it does not yet reimplement any of the skills. Covers the Codex, agy, and Copilot runtimes (Cursor loads upstream natively). The sentry MCP itself is re-pointed separately.
allowed-tools: ["Read", "Edit", "Write", "Bash"]
synced-from: sentry@claude-plugins-official@1.0.0
---

# Parity: sentry SDK skill suite (SCAFFOLD)

> **Status: v1 SCAFFOLD / PLACEHOLDER.** No SDK skill is reimplemented yet — that is **TODO / out-of-scope for v1**. This single file is the parity marker / drift anchor for the **entire** suite. Per the task spec we deliberately do **NOT** create 30 separate empty skills; one tracking placeholder represents the group.

## What this reimplements

Upstream `sentry@claude-plugins-official` ships 30 SDK-setup / workflow **skills** (in addition to the `seer` command — tracked by `parity-sentry-seer` — and the HTTP MCP, which is re-pointed per agent separately).

Per the approved routing artifact (`parity/plugin-routing/sentry@claude-plugins-official.json`):

- **codex** → `reimplement` the 30 SDK skills as Lisa-native skills (or `claude-only` where a skill is Claude-specific).
- **agy** → `reimplement` the 30 SDK skills as Lisa-native skills (or `claude-only` where Claude-specific).
- **copilot** → `reimplement` the 30 SDK skills (or enable Copilot's native equivalent where applicable).
- **cursor** → `already-native` (loads via `.claude-plugin/` reading; no action).

## The 30 upstream skills (TODO — each to be reimplemented or marked claude-only)

1. `sentry-android-sdk`
2. `sentry-browser-sdk`
3. `sentry-cloudflare-sdk`
4. `sentry-cocoa-sdk`
5. `sentry-code-review`
6. `sentry-create-alert`
7. `sentry-dotnet-sdk`
8. `sentry-elixir-sdk`
9. `sentry-feature-setup`
10. `sentry-fix-issues`
11. `sentry-flutter-sdk`
12. `sentry-go-sdk`
13. `sentry-nestjs-sdk`
14. `sentry-nextjs-sdk`
15. `sentry-node-sdk`
16. `sentry-otel-exporter-setup`
17. `sentry-php-sdk`
18. `sentry-pr-code-review`
19. `sentry-python-sdk`
20. `sentry-react-native-sdk`
21. `sentry-react-router-framework-sdk`
22. `sentry-react-sdk`
23. `sentry-ruby-sdk`
24. `sentry-sdk-setup`
25. `sentry-sdk-skill-creator`
26. `sentry-sdk-upgrade`
27. `sentry-setup-ai-monitoring`
28. `sentry-svelte-sdk`
29. `sentry-tanstack-start-sdk`
30. `sentry-workflow`

## Drift tracking

Pinned to `sentry@claude-plugins-official@1.0.0`. A single pin tracks the suite; when upstream moves ahead the detector flags this marker so the whole suite can be re-reviewed.

## TODO (not v1)

- [ ] For each upstream skill above, decide reimplement vs claude-only vs enable-vendor-equivalent (Copilot) and author the Lisa-native version where reimplemented.
- [ ] Wire delivery to the Codex, agy, and Copilot runtimes.

**Do NOT port or copy upstream plugin code.** Reimplement from scratch against Lisa conventions; this is a native shell, not a translation of the upstream skills.
