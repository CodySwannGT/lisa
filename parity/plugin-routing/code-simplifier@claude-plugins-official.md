# Parity routing review — `code-simplifier@claude-plugins-official`

- **Plugin:** `code-simplifier@claude-plugins-official`
- **Upstream version:** `1.0.0`
- **Analyzed:** 2026-05-30
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| agent | `code-simplifier` | `agents/code-simplifier.md` | claude-agent | Single subagent; no MCP/LSP/hooks. Only other tree file is plugin.json. |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - scaffold Lisa-native skill stamped synced-from: code-simplifier@claude-plugins-official@1.0.0 | Codex has no plugin subagent surface and curated third-party plugins are not in Codex's fan-out; reimplement the behavior as a Lisa skill. |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the agent loads unchanged. |
| agy | `reimplement` | - scaffold Lisa-native skill stamped synced-from: code-simplifier@claude-plugins-official@1.0.0 | Curated third-party plugins are not in agy's fan-out, so agy receives nothing natively; reimplement as a Lisa skill. |
| copilot | `enable-vendor-equivalent` | - enable Copilot's native code-simplification/refactor capability for the code-simplifier agent in the project-scoped marketplace | Code simplification is a generic capability Copilot ships natively; prefer enabling over reimplementing. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.
