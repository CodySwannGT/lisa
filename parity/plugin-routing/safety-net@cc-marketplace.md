# Parity routing review — `safety-net@cc-marketplace`

- **Plugin:** `safety-net@cc-marketplace`
- **Upstream version:** `2.0.1`
- **Analyzed:** 2026-08-11 (re-review; previously 2026-07-22 at 1.0.6, originally 2026-05-30 at 0.9.0)
- **Status:** `approved`

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| hook | `pretooluse-bash-guard` | `hooks/hooks.json` | hook | PreToolUse guard running `dist/bin/cc-safety-net.js hook --coding-cli`. Byte-identical to 1.0.6; the engine behind it was rebuilt in 2.0.0 and grew two guard families Lisa does not mirror (`secret.*`, `rm.git-metadata`). As of 2.0.0 upstream also screens file tools, not just Bash. |
| skill | `cc-safety-net` | `skills/cc-safety-net/SKILL.md` | claude-skill | Single consolidated rule-management skill, byte-identical between 1.0.6 and 2.0.1. Drives the JSON rulebook via `cc-safety-net rule`. |

> **Inventory correction.** Through the 1.0.6 re-review this artifact still listed the
> 0.9.0-era `set-custom-rules` + `verify-custom-rules` skill pair. Upstream had already
> consolidated them into the single `cc-safety-net` skill by 1.0.6 — verified against the
> cache tree, which contains only `skills/cc-safety-net/SKILL.md` at both 1.0.6 and 2.0.1.
> The component list above is the corrected inventory.

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - keep the Lisa-native PreToolUse hook (`parity-safety-net.sh`, fanned out via the #1054–1058 hook generators) as the canonical Bash guard, stamped synced-from: safety-net@cc-marketplace@2.0.1<br>- keep the consolidated `lisa-parity-safety-net-rules` skill as the Lisa-native equivalent of the upstream `cc-safety-net` skill, stamped synced-from: safety-net@cc-marketplace@2.0.1 | No MCP/LSP re-point exists for a hook plugin. Upstream 2.0 now publishes a native Codex integration, which would ordinarily outrank `reimplement` — see the flagged decision below. |
| cursor | `claude-only` | _(none)_ | Cursor reads `.claude-plugin/` natively, so Lisa's hook and rules skill load unchanged. The upstream plugin stays uninstalled (retired in #1960) so a session is screened by one guard engine, not two. |
| agy | `reimplement` | - keep the Lisa-native PreToolUse hook (`parity-safety-net.sh`, fanned out via the #1054–1058 hook generators) as the canonical Bash guard, stamped synced-from: safety-net@cc-marketplace@2.0.1<br>- keep the consolidated `lisa-parity-safety-net-rules` skill as the Lisa-native equivalent of the upstream `cc-safety-net` skill, stamped synced-from: safety-net@cc-marketplace@2.0.1 | Curated third-party plugins are not in agy's fan-out, so agy receives nothing natively. Same flagged decision as Codex. |
| copilot | `enable-vendor-equivalent` | - the hook is covered by safety-net's native Copilot CLI hook runner (`cc-safety-net install --copilot-cli`), enabled by the user — Lisa emits nothing (see `parity/FOLLOWUPS.md` §2)<br>- the rule-management skill is covered by the same runner's built-in `cc-safety-net rule` commands | The vendor ships a concrete, named Copilot CLI runner plus built-in rule management. Unchanged from the 1.0.6 review. |

> Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.

## Addendum — 2026-08-11 re-review at upstream 2.0.1

### What changed upstream (1.0.6 → 2.0.1)

The **component surface did not change**: `hooks/hooks.json` and
`skills/cc-safety-net/SKILL.md` are byte-identical between the two cached
versions. What changed is entirely behind the hook — 2.0.0 was a major-version
engine rebuild (canonical command IR, immutable policy snapshots, an ordered
guard pipeline with `explain` decision tracing) plus new product surface
(safety presets, a policy GUI, an audit log, and a universal installer covering
twelve agent CLIs).

### Guard-family gap (empirically measured, not inferred)

Each case below was run through **both** engines — upstream via
`node dist/bin/cc-safety-net.js explain --json <cmd>` (reading the `result` and
`ruleId` fields) and Lisa's hook via a fake `PreToolUse` payload piped to
`parity-safety-net.sh`, asserting the exit code. Two upstream guard families
introduced in 2.0.0 have **no Lisa counterpart**:

| upstream rule id | probe | upstream | Lisa hook |
| --- | --- | --- | --- |
| `secret.home.ssh` | `cat ~/.ssh/id_rsa` | BLOCK | allow |
| `secret.home.ssh` | `cp ~/.ssh/id_ed25519 /tmp/x` | BLOCK | allow |
| `secret.basename.env` | `cat .env` | BLOCK | allow |
| `secret.pattern.env-variant` | `cat config/.env.production` | BLOCK | allow |
| `secret.home.aws` | `cat ~/.aws/credentials` | BLOCK | allow |
| `secret.home.gcloud-config` | `cat ~/.config/gcloud/credentials.db` | BLOCK | allow |
| `secret.cli.claude-code` | `cat ~/.claude/.credentials.json` | BLOCK | allow |
| `secret.basename.npmrc` | `cat ~/.npmrc` | BLOCK | allow |
| `secret.ext-pattern.key` | `cat /etc/ssl/private/server.key` | BLOCK | allow |
| `rm.git-metadata` | recursive delete of `.git` | BLOCK | allow |
| `rm.git-metadata` | `rm .git/hooks/pre-commit` | BLOCK | allow |
| `policy-protection` | delete of upstream's own policy file | BLOCK | allow (n/a — Lisa has no such file) |

Control cases (`ls -la`, `echo FOO=1 >> .env.example`) are allowed by both, and
the README's broader "Git metadata mutation" claim is **narrower in practice**
than the prose suggests: upstream 2.0.1 allows `echo "x" > .git/config`,
`git update-ref -d`, `git submodule deinit -f --all`, and recursive deletes of
`.git/objects` and `.git/worktrees`.

### Decision — re-pin now, absorb the gap under its own issue

This re-review **re-pins to 2.0.1 and does not absorb the two new families**,
matching how the 1.0.6 refresh was sequenced: the pin refresh landed first
(`feat(parity): refresh drifted parity pins to current upstreams`) and the guard
absorption followed as its own tracked work (#1960) with a research audit and a
fixture matrix. Absorbing `secret.*` here would mean importing a large curated
path/pattern corpus **and** registering the hook on file tools — today
`parity-safety-net.sh` is a `Bash`-only `PreToolUse` matcher, so the file-tool
half of upstream's coverage is not even reachable without a matcher change that
ships to every downstream project. That is a behavioral change with
cross-project blast radius and belongs behind its own review, not a pin refresh.
Recorded as deferred work in `parity/FOLLOWUPS.md` §5.

### Flagged for owner review — upstream now ships native multi-CLI integrations

Upstream 2.0 added a universal installer covering **twelve** agent CLIs,
including Codex, Antigravity, Cursor, and Copilot CLI. Under the locked
preference order (`already-native > re-point-mcp-lsp > enable-vendor-equivalent
> claude-only > reimplement`) a named vendor integration for Codex and agy would
outrank `reimplement`, which would flip both cells and retire Lisa's own hook.

That is **not** taken here, for three reasons: the installer is an npx/Node
dependency that writes per-agent config outside Lisa's distribution model;
#1960 deliberately made the Lisa hook canonical on every agent so one audited
guard set ships identically everywhere; and `parity/FOLLOWUPS.md` §2 already
records that Lisa has no mechanism to enable a third-party vendor plugin inside
another agent's marketplace — `enable-vendor-equivalent` is documented as a
user-enabled, manual outcome that Lisa never emits. Reversing #1960 is an
owner-level standards call, so it is surfaced here rather than decided.
