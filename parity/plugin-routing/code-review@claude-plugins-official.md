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
| codex | `reimplement` | - scaffold Lisa-native skill (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Codex has no plugin command surface and is not in the fan-out; reimplement as a Lisa skill. Upstream publishes no semver, so the reimplementation is not drift-trackable — drift tracking is manual review. |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the command loads unchanged. |
| agy | `reimplement` | - scaffold Lisa-native skill (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Curated third-party plugins are not in agy's fan-out; reimplement as a Lisa skill. Upstream publishes no semver, so it is not drift-trackable — manual review. |
| copilot | `enable-vendor-equivalent` | - enable Copilot's native pull-request/code-review capability in the project-scoped marketplace | Code review is a generic capability Copilot ships natively; prefer enabling over reimplementing. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.
