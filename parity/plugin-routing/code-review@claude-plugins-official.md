# Parity routing review — `code-review@claude-plugins-official`

- **Plugin:** `code-review@claude-plugins-official`
- **Upstream version:** `unknown`
- **Analyzed:** 2026-05-30
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| command | `code-review` | `commands/code-review.md` | claude-command | Single slash command; no MCP/LSP/hooks. Cache dirs are a git hash and 'unknown' — no semver, so upstreamVersion is 'unknown' (not drift-trackable). |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - scaffold Lisa-native skill reimplementing the code-review command (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Codex has no plugin command surface and is not in the fan-out; reimplement as a Lisa skill. Upstream publishes no semver, so the reimplementation is not drift-trackable — drift tracking is manual review. |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the command loads unchanged. |
| agy | `reimplement` | - scaffold Lisa-native skill reimplementing the code-review command (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Curated third-party plugins are not in agy's fan-out; reimplement as a Lisa skill. Upstream publishes no semver, so it is not drift-trackable — manual review. |
| copilot | `enable-vendor-equivalent` | - enable Copilot's native pull-request/code-review capability in the project-scoped marketplace | Code review is a generic capability Copilot ships natively; prefer enabling over reimplementing. |
| devin | `reimplement` | - ship the existing Lisa-native code-review command reimplementation (lisa-parity-code-review skill) in the lisa-devin variant — Devin has no plugin command surface, so the skill is the slash command (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Devin installs Lisa's own lisa-devin plugin variant, which ships the Lisa-native reimplementation; curated third-party Claude plugins are not part of Lisa's Devin install. Devin loads no plugin commands, so the command can only reach Devin as a skill. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.
