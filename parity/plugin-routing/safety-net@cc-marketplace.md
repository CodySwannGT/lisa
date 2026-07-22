# Parity routing review — `safety-net@cc-marketplace`

- **Plugin:** `safety-net@cc-marketplace`
- **Upstream version:** `1.0.6`
- **Analyzed:** 2026-07-22 (re-review; originally 2026-05-30 at 0.9.0)
- **Status:** `approved`

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

## Addendum — 2026-07-22 re-review at upstream 1.0.6 (issue #1960)

Upstream 1.0.6 consolidated the two rule-management skills into a single
`cc-safety-net` skill, moved custom rules to a JSON rulebook system driven by
the `npx cc-safety-net rule` CLI, and grew the Bash-guard engine (semantic
segment analysis, wrapper stripping, interpreter one-liner scanning). Lisa's
`lisa-parity-safety-net-rules` skill deliberately keeps the flat ERE-lines-file
design (auditable, no npx dependency, identical on every agent runtime) and is
re-pinned at `1.0.6`.

**Claude-side change.** The original routing left the upstream plugin installed
on Claude/Cursor alongside Lisa's own `parity-safety-net.sh` PreToolUse hook,
so every Bash command in a Claude session was screened twice by two different
guard engines. As of issue #1960 the Lisa hook is canonical on every agent:
its guard set was audited against upstream 1.0.6 (`.lisa/research-1960-guard-audit.md`)
and every material default-mode guard was **reimplemented** (never ported) into
`parity-safety-net.sh` — git discard family (checkout/switch/restore/stash/
clean/branch -D/tag -d/reflog delete/worktree remove --force, reset --merge),
rm target hardening (cwd `.`, `..`-traversal, out-of-project absolute paths
with a /tmp+$TMPDIR allowance, `$VAR` targets, cwd=$HOME gate), quote-aware
target boundaries (closing the `bash -c "rm -rf /"` / interpreter one-liner
bypass), find/xargs deletion, always-on disk destroyers (dd/mkfs/shred), and a
fail-closed exit-2 path for malformed hook input — proven by the 138-fixture
matrix in `tests/unit/hooks/parity-safety-net-guards.test.ts`. Documented
deliberate divergences kept: dirty-tree-only `reset --hard`,
protected-branch-only force-push blocking, and Lisa-only guards upstream lacks
(SQL DROP/TRUNCATE, bare `rm -rf *`, `git checkout .`). Mirroring the #1955
sentry retirement, the upstream `safety-net@cc-marketplace` plugin is no longer
installed (a version-gated uninstall retires existing installs) and the merge
settings templates set its `enabledPlugins` entry to `false`.
