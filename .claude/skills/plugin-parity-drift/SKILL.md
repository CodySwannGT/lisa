---
name: plugin-parity-drift
description: This skill should be used to check whether any Lisa-native reimplementation of a curated third-party Claude plugin has drifted behind its upstream version. It wraps the deterministic detector at scripts/plugin-parity-drift.mjs, which scans `synced-from`-stamped SKILL.md files, resolves each plugin's current upstream version from the installed plugin cache, and reports stale/ahead/missing pins via a CI-gateable exit code. Use it in CI, before a release, or any time the curated plugin set is updated. It only reports — it never edits a skill or auto-bumps a pin.
allowed-tools: ["Bash", "Read"]
---

# Plugin Parity Drift Detector

Lisa reimplements some curated third-party Claude plugins as Lisa-native skills
so the behavior reaches agents that can't load the Claude plugin (Codex, agy,
Copilot). Each such skill is **version-pinned** to the upstream plugin it
mirrors. When upstream advances, the Lisa reimplementation silently falls
behind. This skill detects that drift deterministically.

It is the empirical core of the parity subsystem (issue #1059) and is designed
to run in CI. The sibling skills are `analyze-plugin` (plans parity work) and
`implement-plugin-parity` (executes an approved plan, including stamping the
`synced-from` pins this detector reads).

## The `synced-from` pin grammar

A Lisa-native skill that reimplements an upstream plugin carries a `synced-from`
pin **in addition to** the frontmatter every skill requires (`name`,
`description`, `allowed-tools`; note `$ARGUMENTS` is not substituted in skills):

```yaml
synced-from: <name>@<marketplace>@<version>
```

Examples:

```yaml
synced-from: code-simplifier@claude-plugins-official@1.0.0
synced-from: coderabbit@claude-plugins-official@1.1.1
```

**Grammar (EBNF):**

```
synced-from   = plugin-ref "@" version
plugin-ref    = name "@" marketplace      ; the canonical Claude plugin id, exactly as in enabledPlugins
name          = 1*( ALPHA / DIGIT / "-" / "_" )
marketplace   = 1*( ALPHA / DIGIT / "-" / "_" )
version       = semver                    ; MAJOR.MINOR.PATCH[-prerelease][+build], semver 2.0.0
```

**Parse rule:** semver never contains `@`, so the value is split on the **last**
`@` (right side = version, remainder = `plugin-ref`), then the `plugin-ref` is
split once more on its single `@`. The `plugin-ref` is byte-identical to the
`enabledPlugins` key and to the cache path `<marketplace>/<name>/`, so it
doubles as the resolver lookup key. A malformed value is reported `unparseable`.

## How "current upstream" is resolved (deterministic)

For each `plugin-ref = name@marketplace`, the detector resolves the current
version purely from the installed-plugin cache tree — **no network, no `Date`,
no `installed_plugins.json`**:

```
cacheRoot/<marketplace>/<name>/<version-subdir>/.claude-plugin/plugin.json
```

It reads each subdir's manifest `version` field (NOT the directory name),
collects the valid semver values, and picks the **max** by semver precedence.
Non-semver dirs (`unknown`, git hashes) are skipped because the manifest
`version` is authoritative. "Highest installed version" is the
machine-independent definition of current upstream.

## Running it

```bash
node scripts/plugin-parity-drift.mjs [--skills-root <dir>]... [--cache-root <dir>] [--json]
```

- `--skills-root <dir>` (repeatable; default `<repo>/.claude/skills`): roots
  scanned recursively for `**/SKILL.md`.
- `--cache-root <dir>` (default `$CLAUDE_PLUGIN_CACHE`, else
  `~/.claude/plugins/cache`): the installed-plugin cache root.
- `--json`: emit the machine-readable report (§3.5 of the design) instead of the
  human markdown table. The exit code is identical in both modes.

Default invocation (what CI runs):

```bash
node scripts/plugin-parity-drift.mjs
```

## Per-skill statuses

| Condition                          | status          | drift? |
| ---------------------------------- | --------------- | ------ |
| current == pinned                  | `ok`            | no     |
| current > pinned                   | `stale`         | yes    |
| current < pinned                   | `ahead`         | yes    |
| plugin not in the cache            | `not-installed` | yes    |
| installed but no parseable semver  | `unresolved`    | yes    |
| `synced-from` value malformed      | `unparseable`   | yes    |

## Exit codes (CI contract)

- `0` — no drift: every synced skill is `ok`.
- `1` — drift found: ≥1 skill is `stale` / `ahead` / `not-installed` /
  `unresolved` / `unparseable`.
- `2` — operational/usage error: unknown flag, missing `--cache-root` path, or
  no resolvable `--skills-root`. Distinct from drift so CI can tell a real drift
  from a broken invocation.

## CI usage

Add a CI step that fails the build on exit 1:

```yaml
- name: Plugin parity drift
  run: node scripts/plugin-parity-drift.mjs
```

The CI step needs the installed plugin cache present (default
`~/.claude/plugins/cache`, or set `CLAUDE_PLUGIN_CACHE` / pass `--cache-root`) so
that synced skills can be resolved. **Exception:** a repo with zero
reimplementations (no `synced-from` skills) passes cleanly with exit `0` even
when the cache is absent — the detector scans skills first and short-circuits to
"no drift" before requiring the cache, so a fresh runner without the cache never
fails the build for a project that has nothing to track.

A `stale` result is the signal to run `analyze-plugin` for that plugin and then
`implement-plugin-parity` to refresh the reimplementation and re-stamp the pin.

## What it never does

The detector is **report-only**. It never edits a skill, never bumps a pin, and
never touches the cache. Re-pinning is a deliberate human/`implement-plugin-parity`
action so that "we re-reviewed the upstream change" is always an explicit step,
never an automatic one.

## Verifying the detector itself

The committed fixture under `parity/fixtures/drift/` plus
`tests/unit/scripts/plugin-parity-drift.test.ts` (run via `bun run test:unit`)
prove the stale/ok/ignored classification, the max-semver resolution across
sibling version dirs, the exit-code contract, and that the detector leaves the
scanned skill bytes unchanged.
