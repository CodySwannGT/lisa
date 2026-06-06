# Coding-Agent Parity Open Questions

Unresolved items surfaced by the 2026-05-28 parity research pass that should be answered by subsequent ingestion, empirical probing, or upstream documentation reads.

## Copilot Memory File

What is the exact filename Copilot auto-loads for project instructions? Candidates from research: `CLAUDE.md`, `AGENTS.md`, `.copilot/INSTRUCTIONS.md`. The `copilot init` subcommand is documented; running it once in a throwaway project and observing which file appears would resolve this empirically.

## agy Plugin Hooks In Interactive Mode

agy plugin-bundled hooks validate, install correctly to `~/.gemini/config/plugins/<plugin>/hooks/hooks.json`, and the plugin appears in `agy plugin list` as enabled. During real `agy -p` sessions across two separate probe runs, no registered hook ever fired. Whether agy hooks fire in interactive (non-`-p`) mode remains untested; the headless behavior alone originally motivated the AGENTS.md bake-in alternative for rules injection, but the interactive question is still open. _(Update 2026-06-06 — PR #1150: the bake-in alternative was removed. `AGENTS.md` is now canonical and rule-free and Lisa accepts the gap rather than baking, so resolving the interactive-mode question no longer changes the rules-delivery design; it would only affect whether other agy hooks like `block-no-verify` are worth shipping.)_

## agy Plugin-Root Environment Variable

Community Antigravity hook examples use `${CLAUDE_PLUGIN_ROOT}` literally inside hook commands meant for agy. The strong inference is that agy inherits Claude's plugin-root env-var name as a compatibility behavior. Empirical confirmation is blocked by the headless-hooks-don't-fire finding above. If interactive hooks fire, a one-line `env | grep PLUGIN` hook would confirm.

## Cursor Plugin Install Cache Location

Cursor's installed plugins land under `~/.claude/plugins/cache/`. Whether this is intentional cross-pollination with Claude or a transient implementation detail is unclear. If Cursor changes its loader to a `~/.cursor/plugins/` tree in a future release, Lisa's installer expectations would need to follow.

## Codex `agy plugin import claude` Equivalent

agy ships `agy plugin import claude` as a documented subcommand, but the import returns "No claude extensions found" in practice. Whether the missing piece is a Claude-CLI-side "extensions" feature (distinct from plugins) that Lisa should expose, or whether the import path is just unfinished upstream, is unresolved. The Lisa distribution path for agy uses `agy plugin install <local-path>` against the Pattern B variant instead.

## Per-Agent Capability Memory Entries

User-memory entries exist for Codex (`reference-codex-hooks-capabilities`, `reference-codex-plugin-skill-loading`, etc.) but not for Cursor, agy, or Copilot. The first `[VERIFIED-BY-RUN]` load-bearing finding about each of those three agents should land as a memory entry so future parity research starts from current knowledge.

## Stale Codex Hooks Memory

The `reference-codex-hooks-capabilities` memory entry predates Codex 0.125.0's expanded event list. The current event list is `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`. The memory should be refreshed when the next implementation pass empirically re-verifies the events.
