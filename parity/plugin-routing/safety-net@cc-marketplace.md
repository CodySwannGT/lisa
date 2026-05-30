# Parity routing review — `safety-net@cc-marketplace`

- **Plugin:** `safety-net@cc-marketplace`
- **Upstream version:** `0.9.0`
- **Analyzed:** 2026-05-30
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| hook | `pretooluse-bash-guard` | `hooks/hooks.json` | hook | PreToolUse Bash guard that runs dist/bin/cc-safety-net.js --claude-code to block destructive git/filesystem commands. |
| skill | `set-custom-rules` | `skills/set-custom-rules/SKILL.md` | claude-skill | Configures custom safety-net rules. |
| skill | `verify-custom-rules` | `skills/verify-custom-rules/SKILL.md` | claude-skill | Validates custom safety-net rules. |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - scaffold a Lisa-native PreToolUse hook (fanned out via the per-agent hook generators from #1054–#1058) stamped synced-from: safety-net@cc-marketplace@0.9.0<br>- reimplement the set-custom-rules and verify-custom-rules skills as Lisa-native skills stamped synced-from: safety-net@cc-marketplace@0.9.0 | A hook-bearing plugin has no MCP/LSP re-point; reimplement as a Lisa-native hook (via the existing per-agent hook generators) plus reimplement the two rule-management skills so no component group is dropped. |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the hook and both skills load unchanged. |
| agy | `reimplement` | - scaffold a Lisa-native PreToolUse hook (fanned out via the per-agent hook generators from #1054–#1058) stamped synced-from: safety-net@cc-marketplace@0.9.0<br>- reimplement the set-custom-rules and verify-custom-rules skills as Lisa-native skills stamped synced-from: safety-net@cc-marketplace@0.9.0 | Curated third-party plugins are not in agy's fan-out; reimplement as a Lisa-native hook plus the two rule-management skills. |
| copilot | `enable-vendor-equivalent` | - enable safety-net's native Copilot CLI hook runner (cc-safety-net --copilot-cli) in the project-scoped marketplace<br>- the set-custom-rules and verify-custom-rules skills are covered by cc-safety-net's native built-in commands for the Copilot CLI runner | safety-net ships a concrete Copilot CLI hook runner (cc-safety-net --copilot-cli) plus built-in rule-management commands, so enable the vendor's native Copilot support rather than reimplementing. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.
