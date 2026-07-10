---
name: lisa-cross-pollinate
description: "Detect a host project's…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep"]
argument-hint: "[path] [--dry-run] [--write]"
---

# Cross-Pollinate: $ARGUMENTS

A host project that installs Lisa may hand-author a definition for **one** coding
agent — a `.claude/skills/foo`, a `.cursor/rules/bar.mdc`, an MCP server only
Claude sees. `/lisa:cross-pollinate` detects those locally-authored definitions
and regenerates each in the formats of the **other** agents the project supports,
so the whole fleet stays in parity with what a developer wrote for any single one.

## The model

```
any agent's format  ->  Claude-format IR  ->  every OTHER configured agent
```

Claude format is the canonical intermediate representation (IR) because every
Lisa generator already sources from it. So translation is always: **normalize
the detected definition up to Claude-format IR, then fan that IR out** to each
target agent using the documented mappings below. Never translate format A → B
directly — that multiplies error and loses fidelity on every hop.

The agents a project supports come from `.lisa.config.json` `harness`
(`claude` | `codex` | `cursor` | `agy` | `copilot` | `opencode` | `both` | `fleet`;
`all` is an alias for `fleet`). Only emit to agents that harness includes.

## Provenance is authoritative — the lockfile, not file paths

`.lisa/cross-pollination.lock.json` (committed) is the source of truth for what
this skill generated. Location heuristics **cannot** work: a generated Cursor
rule sits in the same `.cursor/rules/` directory as a hand-authored one. The
lockfile is the only reliable way to enforce the four invariants:

1. **No loops** — a path recorded as a `target` is NEVER treated as a source on
   the next run. Without this, today's output becomes tomorrow's input and
   translations ping-pong forever.
2. **Garbage collection** — when a source is deleted/renamed, its now-orphaned
   targets are removed.
3. **Never clobber edits (Chesterton's fence)** — if a target's on-disk hash
   differs from the recorded `generatedHash`, a human edited it. Stop and report;
   do not overwrite. They may have intentionally diverged, or want to adopt the
   edit as a new source.
4. **Idempotent** — unchanged source + intact targets => no-op. (This is why it
   is safe to also run during `lisa apply`.)

Lockfile shape:

```json
{
  "version": 1,
  "entries": {
    "skill:security-review": {
      "source":  { "agent": "claude", "path": ".claude/skills/security-review", "hash": "…" },
      "targets": [ { "agent": "codex", "path": ".claude/skills/security-review/agents/openai.yaml", "generatedHash": "…" } ]
    }
  }
}
```

The `logicalId` is `<kind>:<name>` — stable across formats. It links a source to
its targets and detects **collisions**: the same `logicalId` authored
independently in two agents (neither generated). On a collision, NEVER
auto-translate over either side — report it and let the human pick the source of
truth.

## How to run

The deterministic core (scan, provenance, loop/GC/drift/conflict detection, and
the skill + MCP emitters) is a bundled engine. **Always run it first** — it does
the safe, mechanical work and tells you exactly what is left for you to translate
by hand.

```bash
# dry-run (default): report only, writes nothing
node "${CLAUDE_PLUGIN_ROOT}/scripts/cross-pollinate.mjs" "$PROJECT_ROOT" --json
# apply the deterministic emits + update the lockfile
node "${CLAUDE_PLUGIN_ROOT}/scripts/cross-pollinate.mjs" "$PROJECT_ROOT" --write
```

In the Lisa source repo itself the path is
`node plugins/lisa/scripts/cross-pollinate.mjs` (built) or
`node plugins/src/base/scripts/cross-pollinate.mjs` (source).

The JSON report has four lists you act on:

- `emits` — already handled by `--write` (skills, MCP). Verify, don't redo.
- `conflicts` — STOP. Report each to the user; do not translate.
- `orphans` — GC'd by `--write`. Confirm the removals look right.
- `pending` — **your job.** Definitions whose target format the engine does not
  emit deterministically. Translate each per the mappings below, then record
  provenance (see "Recording provenance").

## Per-agent format mappings (for `pending` translation)

Normalize the source to Claude-format IR first, then emit per target:

### Rules
- **Claude ↔ Cursor**: handled deterministically by the engine. Claude reads
  `.claude/rules/<name>.md`; Cursor reads `.cursor/rules/<name>.mdc` with YAML
  frontmatter (`description` from the first H1, `alwaysApply: true`) and intra-rule
  link extensions rewritten. You do not translate these — verify the engine's
  emits.
- **Codex / OpenCode / agy** (`pending`): project rules are delivered via
  `AGENTS.md`, not a per-rule file. MERGE the rule content into `AGENTS.md` under a
  stable marked section rather than writing a separate file (so re-runs replace,
  not append). agy never gets a duplicate rule file (rules-once).
- **Copilot** (`pending`): `.github/copilot-instructions.md` (inline). Merge into a
  marked section, don't scatter.

### Subagents
- **Claude / agy / Cursor / OpenCode**: `agents/<name>.md` (or `.claude/agents/`).
- **Copilot**: `agents/<name>.agent.md` (note the `.agent.md` suffix).
- **Codex**: does not consume agent files. Report as **dropped — unsupported**,
  do not invent a target.

### Commands
- **Claude / Cursor / Copilot**: markdown command files (`.claude/commands/…`).
- **Codex / agy**: auto-derive commands from skills; no separate command file.
  Report as **dropped — derived-from-skill**.

### Hooks (lossy — drop-and-report, never fake support)
- Event-name casing differs per agent (`PreToolUse`→`preToolUse`/`beforeSubmitPrompt`,
  `UserPromptSubmit`→`userPromptSubmitted`, `Stop`→`agentStop`/`stop`, …).
- **agy** lacks `SessionStart`/`SubagentStart` — only `PreToolUse` (e.g.
  block-no-verify) is portable. Everything else: dropped — unsupported.
- **Codex** plugin hooks do not fire in `codex exec` — install into
  `~/.codex/hooks.json`, not a bundled file.
- **Copilot** rejects the entire hooks config if a `SubagentStart`/empty-matcher
  entry is present — drop that event wholesale.
- For every hook you cannot faithfully translate to a target, REPORT it with the
  reason. Do not silently omit (no silent caps).

### MCP (handled by the engine for Claude↔Cursor; report others)
- **Claude**: `.mcp.json`. **Cursor**: `.cursor/mcp.json` (same JSON shape).
- **Copilot**: inline `mcpServers` object in the plugin manifest (bundled
  `.mcp.json` is ignored). **Codex**: TOML / `.codex-plugin` pointer.
  **agy/OpenCode**: user-global installer / `.opencode`. The engine reports these
  as pending; translate per the target's documented shape or report dropped.

## Recording provenance for hand-translated `pending` items

After you write a target by hand, it MUST be recorded in
`.lisa/cross-pollination.lock.json` or the next run will treat it as a source
(loop) or fail to GC it. Re-run the engine after staging your translated files —
on its next pass it adopts and hashes any target already referenced — OR add the
entry yourself following the lockfile shape above (compute `generatedHash` as the
sha256 of the written file/dir). Prefer the engine; only hand-edit the lock if
the engine cannot infer the mapping.

## Output

Report, concisely:
- harness + resolved target agents
- counts: detected sources, written, skipped-drift, GC'd
- every conflict (with the agents involved)
- every pending item you translated, and every hook/agent/command you **dropped**
  with its reason
- confirm `.lisa/cross-pollination.lock.json` was updated and the working tree
  otherwise contains only intended changes

## Rules

- Treat the lockfile as authoritative; never infer "mine vs theirs" from paths.
- Never overwrite a drifted (hand-edited) target — report it.
- Never auto-resolve a collision — report it.
- Only emit to agents the project's `harness` includes.
- Drop-and-report any translation a target genuinely cannot support; never fake
  a location you are unsure of.
- This skill is additive — it does not delete a human's source definitions, only
  its own orphaned generated targets.
