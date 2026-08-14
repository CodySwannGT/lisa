# Parity routing review — `safety-net@cc-marketplace`

- **Plugin:** `safety-net@cc-marketplace`
- **Upstream version:** `2.0.4`
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
| copilot | `enable-vendor-equivalent` | - **Correction (this re-review):** the Lisa-native `parity-safety-net.sh` hook and `lisa-parity-safety-net-rules` skill DO ship into the generated Copilot artifact via the universal base-plugin fan-out (#1054–1058); the Copilot generator has no safety-net-specific exclusion. The prior "Lisa emits nothing" wording was inaccurate.<br>- safety-net's native Copilot CLI hook runner (`cc-safety-net install --copilot-cli`) remains a separate, user-opt-in install; if enabled, it runs alongside the Lisa hook (dual engine), not instead of it (see `parity/FOLLOWUPS.md` §2)<br>- likewise the rule-management skill ships regardless of whether the user has the vendor runner's built-in `cc-safety-net rule` commands installed | The vendor ships a concrete, named Copilot CLI runner plus built-in rule management, which is why `enable-vendor-equivalent` was preferred over `reimplement` for Copilot in the 1.0.6 review. In practice the #1050 universal fan-out ships Lisa's own hook/skill to every agent variant including Copilot regardless of this outcome label, so the actions above now document the real dual-engine coexistence. Whether to actively exclude the Lisa hook/skill from Copilot (making the outcome literally true) is an owner-level call — see "Flagged for owner review" below. |

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

Each comparable case below was run through **both** engines — upstream via
`node dist/bin/cc-safety-net.js explain --json <cmd>` (reading the `result` and
`ruleId` fields) and Lisa's hook via a fake `PreToolUse` payload piped to
`parity-safety-net.sh`, asserting the exit code. The `policy-protection` row is
non-comparable (Lisa has no policy file to probe) and is included only for
completeness — see its `n/a` note. The two comparable upstream guard families
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
| `policy-protection` | delete of upstream's own policy file | BLOCK | n/a (non-comparable; Lisa has no such file) |

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
user-enabled, manual outcome that Lisa itself never *activates*. Reversing
#1960 is an owner-level standards call, so it is surfaced here rather than
decided.

**Correction (this re-review, addressing a review finding):** "Lisa itself
never emits" was previously mis-stated as "Lisa emits nothing" for Copilot
specifically. That is not true of the *hook and skill files* — the #1050
universal base-plugin fan-out ships `parity-safety-net.sh` and
`lisa-parity-safety-net-rules` into the generated Copilot artifact exactly as
it does for every other agent, with no safety-net-specific carve-out in
`generate-copilot-plugin-artifacts.mjs`. What Lisa does not do is *enable the
vendor's own plugin/runner* inside Copilot's marketplace — that part of the
claim holds. So today a Copilot user who also opts into
`cc-safety-net install --copilot-cli` runs **both** engines side by side. The
per-agent routing table above and `parity/FOLLOWUPS.md` §2 have been corrected
to describe this dual-engine coexistence rather than "Lisa emits nothing."
Deciding whether to suppress the Lisa hook/skill for Copilot specifically (so
the vendor runner is the sole guard there) is the same owner-level call as the
Codex/agy vendor-integration question above, and is left open pending that
decision.

## Addendum — 2026-08-14, catching this artifact up to the 2.0.4 pin

The `synced-from` pin itself moved to `2.0.4` separately, in `a0ad92f7d`, on the
strength of a surface comparison recorded in that commit message: a digest of the
sorted (path, content) manifest of every rule-bearing directory in the plugin
cache came out identical across 2.0.3 and 2.0.4 — `src/` 230 files at digest
`7e346e205fbd1aa7` on both, `skills/` and `hooks/` byte-identical — leaving only
`version` strings, per-integration manifests, rebuilt `dist/` output, and one
statusline test-harness fix. **Nothing was absorbed, and nothing needs to be.**
Combined with the 2.0.3 review (Kimi Code + Amp installer support, no
rule-contract change), the whole 2.0.1 → 2.0.4 range leaves Lisa's
reimplementation untouched.

This addendum only brings **this artifact** up to that pin. It had been left at
`2.0.1`.

**The two guard-family gaps are unchanged** and still deferred: `secret.*` and
`rm.git-metadata`, tracked in `parity/FOLLOWUPS.md` §5.

### Process note — the artifact keeps lagging the skill pin

This is the third consecutive safety-net refresh to move the `synced-from` stamp
and leave the routing artifact behind. When this correction was written the skill
read `2.0.4` while this artifact still read `2.0.1`, and the sentry artifact read
`1.3.1` against a `1.3.2` skill pin.

**The push gate structurally cannot catch it.** `.husky/pre-push.local` runs
`plugin-parity-drift.mjs`, which reads only skill frontmatter. So
`plugin-routing-validate.mjs` can sit red indefinitely while every push stays
green, and the thing that finally trips over it is the next
`implement-plugin-parity` run, for which the validator is the pre-flight gate.
The lag is not an attention failure — nothing in the loop reports it.

Both artifacts are corrected here. Wiring the validator into the push gate or CI
is what would actually close the loop; it is recorded as a follow-up rather than
done inline, because the validator was red on arrival and enabling it as a gate
would newly block every push — a gate-policy change that deserves its own review.

### Follow-up closed — 2026-08-14, issue #2552

That review happened and the wiring landed. `.husky/pre-push.local` now runs
`plugin-routing-validate.mjs` alongside the drift detector, so a lagging artifact
blocks the push that creates it. Re-running the sentry lag by hand (artifact back
to `1.3.1` against the `1.3.2` cache) blocks with
`upstreamVersion 1.3.1 != cache max 1.3.2` **while the drift gate on the same run
still reports `✅ Plugin parity pins are current`** — which is precisely the
half-blind reading that let the lag survive three refreshes.

Enabling it did not newly block anyone. A machine with no plugin cache used to be
a hard failure for every artifact (`no semver in the cache to confirm`); the
validator now reports that as **unverifiable** and still exits 0, keeping the
schema, routing, coverage, and anti-pattern gates. A cacheless clone therefore
validates strictly more than before, not less.

The same issue also closed the hole PR #2548 walked through: six generated parity
`SKILL.md` files carrying literal `<<<<<<< HEAD` blocks passed everything,
because the pin value sat *inside* the conflict block. `check-conflict-markers.mjs`
reads the bytes of every tracked file, in the push gate and in the required
`🧩 Plugin artifacts match source` job — the latter because a cloud agent never
runs the local hook.
