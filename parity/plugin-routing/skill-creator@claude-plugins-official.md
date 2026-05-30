# Parity routing review — `skill-creator@claude-plugins-official`

- **Plugin:** `skill-creator@claude-plugins-official`
- **Upstream version:** `unknown`
- **Analyzed:** 2026-05-30
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| skill | `skill-creator` | `skills/skill-creator/SKILL.md` | claude-skill | Single skill (bundles internal helper agents + python scripts under skills/skill-creator/). Cache dirs are a git hash and 'unknown' — no semver, so upstreamVersion is 'unknown' (not drift-trackable). |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - scaffold Lisa-native skill (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Curated third-party plugins are not in Codex's fan-out; reimplement as a Lisa skill. Upstream publishes no semver, so it is not drift-trackable — manual review. |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the skill loads unchanged. |
| agy | `reimplement` | - scaffold Lisa-native skill (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Curated third-party plugins are not in agy's fan-out; reimplement as a Lisa skill. Upstream publishes no semver, so it is not drift-trackable — manual review. |
| copilot | `reimplement` | - scaffold Lisa-native skill (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review) | Copilot ships no concrete equivalent for authoring Claude skills, so it falls through the preference order to reimplement. Upstream publishes no semver, so it is not drift-trackable — manual review. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.
