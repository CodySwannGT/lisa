---
name: analyze-plugin
description: This skill should be used to analyze a single curated third-party Claude plugin (one of Lisa's enabledPlugins) and plan how to bring it to parity across the non-Claude agents Lisa distributes to (Codex, Cursor, agy, Copilot). It inventories the plugin's components, classifies each, decides a per-agent routing outcome, and writes a machine-readable routing artifact plus a human review matrix under parity/plugin-routing/. It is PLAN-ONLY: it STOPS for human approval and makes no source-tree edits — the sibling skill implement-plugin-parity executes an approved artifact.
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"]
---

# Analyze Plugin (PLAN-ONLY)

Lisa curates a small set of third-party Claude plugins in `enabledPlugins`
(`.claude/settings.json` at the repo root and `all/merge/.claude/settings.json`):

```
lisa@lisa, safety-net@cc-marketplace, code-simplifier@claude-plugins-official,
code-review@claude-plugins-official, coderabbit@claude-plugins-official,
sentry@claude-plugins-official, skill-creator@claude-plugins-official
```

(+ `typescript-lsp@claude-plugins-official` in stack settings.) These reach
Claude — and Cursor, which reads `.claude-plugin/` natively — but **not**
Codex / agy / Copilot. This skill analyzes one curated plugin and produces a
parity plan: what each component is, and how each agent should obtain
equivalent behavior.

**This skill is plan-only.** It writes a routing artifact and a human matrix and
then **STOPS**. It does not emit MCP, scaffold skills, run generators, or edit
any source. If asked to "implement", "apply", or "build" the parity, reject the
request and point at the sibling skill `implement-plugin-parity` — analysis and
execution are deliberately separated by a human approval gate (mirroring how
`lisa-coding-agent-parity` refuses implementation and points at its sibling).

## Input

One curated plugin's canonical id: `<name>@<marketplace>` — e.g.
`code-simplifier@claude-plugins-official`. This is byte-identical to the
`enabledPlugins` key and to the cache path `<marketplace>/<name>/`.

## Procedure

### 1. Locate the installed plugin

Find the plugin tree in the cache (no network):

```
~/.claude/plugins/cache/<marketplace>/<name>/<version>/
```

Resolve the **current upstream version** the same way the drift detector does —
read each version subdir's `.claude-plugin/plugin.json` `version` field and take
the max valid semver. Record it as `upstreamVersion`.

### 2. Inventory the components

Walk the plugin tree and inventory every component. Each entry records its
`kind`, an `id`, the `path` within the plugin, a `classification`, and free-form
`notes`:

- `kind`: `skill` | `agent` | `command` | `hook` | `mcp` | `lsp`
- `classification`: `claude-skill` | `claude-agent` | `claude-command` |
  `hook` | `mcp-server` | `lsp-server`

Look for: `skills/*/SKILL.md`, `agents/*.md`, `commands/*.md`, a `hooks` block in
`.claude-plugin/plugin.json` (or `hooks/hooks.json`), `.mcp.json` (MCP servers),
and any LSP declaration.

### 3. Decide a per-agent routing outcome

Produce **exactly one** routing entry per non-Claude-native agent: `codex`,
`cursor`, `agy`, `copilot`. Each entry has an `outcome` from the locked enum, a
list of declarative `actions`, and a `rationale`.

**Outcome enum (locked):**

- `already-native` — the agent already gets the behavior via the existing
  per-agent fan-out; no action.
- `re-point-mcp-lsp` — the component is (or carries) an MCP/LSP server; emit it
  into that agent's variant via the existing generator/installer (Codex
  `.codex-plugin` MCP pointer; Cursor `mcp.json`; agy → `src/agy/mcp-installer.ts`
  user-global; Copilot → inline `mcpServers` / `lspServers` on the manifest).
- `enable-vendor-equivalent` — enable the agent's native equivalent capability
  in its project-scoped marketplace.
- `claude-only` — intentionally not ported (e.g. Cursor already covers it via
  native `.claude-plugin/` loading, or there is no equivalent). Documented, no
  action.
- `reimplement` — scaffold a Lisa-native skill stamped
  `synced-from: <name>@<marketplace>@<upstreamVersion>`. **This is the only
  outcome that creates a drift-tracked artifact.** v1 plans the scaffold only —
  the actual reimplementation logic is out of scope per the issue.

**Decision rule (locked preference order):** for each `(plugin × agent)` cell,
choose the **first applicable** outcome in this order:

```
already-native  >  re-point-mcp-lsp  >  enable-vendor-equivalent  >  claude-only  >  reimplement
```

`reimplement` is the **last resort**: every reimplementation signs Lisa up to
track another vendor's release cadence (a standing drift liability surfaced by
`plugin-parity-drift`). Prefer any earlier outcome that reaches parity without
forking — only reimplement when no native fan-out, MCP/LSP re-point, vendor
equivalent, or accepted Claude-only coverage applies.

Routing heuristics:

- An MCP/LSP-bearing plugin → `re-point-mcp-lsp` for Codex/agy/Copilot; Cursor
  is usually `already-native` (its variant emits `mcp.json` from `.mcp.json`).
- A pure subagent/skill/command with no MCP → `reimplement` for Codex and agy
  (no equivalent plugin subagent surface), `claude-only` for Cursor (loads the
  `.claude-plugin/` natively), and `enable-vendor-equivalent` for Copilot when
  the vendor ships a comparable capability.
- Note any first-of-its-kind emission path (e.g. the first LSP routed to
  Copilot `lspServers`) in `actions` as a flagged follow-up rather than assuming
  the generator already handles it.

### 4. Write the artifact + matrix, then STOP

Write two paired files (the full `<name>@<marketplace>` id keeps one artifact
per plugin so re-running never clobbers another):

- `parity/plugin-routing/<name>@<marketplace>.json` — the machine-readable
  routing artifact, `"status": "proposed"`.
- `parity/plugin-routing/<name>@<marketplace>.md` — a human review matrix (a
  markdown table of components and per-agent routing).

Then **STOP** and tell the human to review the artifact and flip
`"status": "proposed"` → `"approved"` (a one-line edit, visible in the git diff)
before running `implement-plugin-parity`.

## Routing artifact schema

```jsonc
{
  "schemaVersion": 1,
  "plugin": "code-simplifier@claude-plugins-official", // canonical id (== synced-from plugin-ref)
  "pluginName": "code-simplifier",
  "marketplace": "claude-plugins-official",
  "upstreamVersion": "1.0.0",          // resolved from the cache at analysis time
  "analyzedAt": "2026-05-30",          // informational only (not load-bearing)
  "status": "proposed",                // "proposed" | "approved" (human flips to approved)
  "components": [
    {
      "kind": "agent",
      "id": "code-simplifier",
      "path": "agents/code-simplifier.md",
      "classification": "claude-agent",
      "notes": "single subagent; no MCP/LSP"
    }
  ],
  "routing": {
    "codex":   { "outcome": "reimplement",             "actions": ["scaffold Lisa-native skill stamped synced-from: code-simplifier@claude-plugins-official@1.0.0"], "rationale": "Codex has no plugin subagent surface; behavior reimplemented as a Lisa skill." },
    "cursor":  { "outcome": "claude-only",             "actions": [],                                                                                                  "rationale": "Cursor reads .claude-plugin/ natively; the agent loads unchanged." },
    "agy":     { "outcome": "reimplement",             "actions": ["scaffold Lisa-native skill stamped synced-from: code-simplifier@claude-plugins-official@1.0.0"], "rationale": "agy converts commands to skills but has no equivalent subagent plugin surface." },
    "copilot": { "outcome": "enable-vendor-equivalent","actions": ["enable copilot's native simplifier equivalent in the project-scoped marketplace"],                "rationale": "vendor ships a comparable capability; prefer enabling over reimplementing." }
  }
}
```

The human matrix `.md` presents the same `components` + `routing` as readable
tables so a reviewer can approve without parsing JSON.

## Constraints

- **Plan-only.** No source edits, no generator runs, no MCP emission, no skill
  scaffolding. The only writes are the two `parity/plugin-routing/` files.
- The artifact is a **durable, committed contract** between this skill and
  `implement-plugin-parity` — it must survive across sessions, machines, and
  reviewers (hence `parity/`, not `/tmp`).
- An MCP-only plugin (no `reimplement` outcome) produces **no** `synced-from`
  skill and therefore never appears in the drift report — drift tracking is
  scoped exactly to reimplementations.

## Definition of done

- `parity/plugin-routing/<name>@<marketplace>.json` exists, validates against the
  schema above, is `status:"proposed"`, and has exactly one routing entry per
  agent (codex/cursor/agy/copilot).
- The sibling `.md` matrix is written.
- No source-tree edits were made.
- The skill STOPPED with the approval instruction.
