---
name: analyze-plugin
description: "This skill should be used to analyze a single curated third-party Claude plugin (one of Lisa's enabledPlugins) and plan how to bring it to parity across the non-Claude agents Lisa distributes to (Codex, Cursor, agy, Copilot). It inventories the plugin's components, classifies each, decides a per-agent routing outcome, and writes a machine-readable routing artifact plus a human review matrix under parity/plugin-routing/. It is PLAN-ONLY: it STOPS for human approval and makes no source-tree edits — the sibling skill implement-plugin-parity executes an approved artifact."
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"]
---

# Analyze Plugin (PLAN-ONLY)

Lisa curates a small set of third-party Claude plugins in `enabledPlugins`
(`.claude/settings.json` at the repo root and `all/merge/.claude/settings.json`):

```
lisa@lisa, safety-net@cc-marketplace, code-simplifier@claude-plugins-official,
code-review@claude-plugins-official, coderabbit@claude-plugins-official,
skill-creator@claude-plugins-official
```

(`sentry@claude-plugins-official` was curated until issue #1955: the base lisa
plugin bundles the Sentry MCP server for every agent, so the upstream plugin was
retired — its `enabledPlugins` entry is now pinned `false` — and Lisa's parity
skills own the Sentry workflows.)

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

**Version fallback (real plugins are messy — handle all three cases):**

1. A `.claude-plugin/plugin.json` with a valid-semver `version` exists → use the
   max across subdirs (the normal path).
2. No `plugin.json`, or it has no `version` field, **but the version subdir name
   itself is valid semver** (e.g. `typescript-lsp/1.0.0/` with only a README) →
   record that directory name as `upstreamVersion` and note the source in the
   relevant component `notes` ("version from cache dir name; no plugin.json").
3. Neither a semver `version` nor a semver subdir name exists (e.g. subdirs named
   `unknown` or a git hash, as with `code-review` and `skill-creator`) → record
   `upstreamVersion: "unknown"`.

**Drift-trackability consequence (state this in any `reimplement` rationale):**
the `plugin-parity-drift` detector only parses **semver** pins, so a plugin whose
`upstreamVersion` is `"unknown"` **cannot be drift-tracked** if reimplemented —
its `synced-from` stamp would be unparseable. For such a plugin, prefer a
non-`reimplement` outcome where one applies; if `reimplement` is unavoidable, the
`actions` MUST flag "upstream publishes no semver → not drift-trackable; pin/version
needs manual review" rather than silently emitting an unparseable pin.

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

**When the tree carries no machine-readable manifest** (e.g. `typescript-lsp` ships
only `LICENSE` + `README.md`), infer the component from the README prose and record
it with `notes: "inferred from README; no machine-readable manifest"`. Do not invent
components the README doesn't describe.

**Dedupe MCP declarations.** The same MCP server is often declared in more than one
place (`.mcp.json`, an inline `mcpServers` block in `plugin.json`, and/or a root
`mcp.json`). Count **one logical `mcp` component** per distinct server, not one per
declaration.

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
  (Lisa's curated third-party plugins are **not** in the per-agent fan-out — that
  fan-out carries Lisa's *own* plugins, not these — so Codex/agy receive nothing
  natively), `claude-only` for Cursor (loads the `.claude-plugin/` natively), and
  `enable-vendor-equivalent` for Copilot when the vendor ships a comparable
  capability. (The schema example's older "agy converts commands to skills"
  rationale referred to agy's plugin system in general; it does **not** apply
  here because the third-party plugin is never installed into agy.)
- A **hook-bearing** plugin (e.g. a PreToolUse guard like `safety-net`) → there is
  no MCP/LSP re-point and no "skill" equivalent, so `reimplement` for Codex/agy
  means **scaffold a Lisa-native hook** (fanned out via the existing per-agent hook
  generators from #1054–#1058), not a skill — say so explicitly in `actions`.
  `claude-only` for Cursor; for Copilot, `enable-vendor-equivalent` when the plugin
  ships a native Copilot hook runner, else `reimplement`.
- Note any first-of-its-kind emission path (e.g. the first LSP routed to
  Copilot `lspServers`) in `actions` as a flagged follow-up rather than assuming
  the generator already handles it.

**`enable-vendor-equivalent` test (don't over-claim it):** use it only when the
target agent ships, or its marketplace publishes, a *concrete* equivalent — name
it in `actions`. A branded third-party tool (e.g. CodeRabbit) counts only if that
vendor actually publishes a plugin/integration for the target agent; a *generic*
capability the agent already has natively (e.g. Copilot's built-in code review or
simplify) also counts. If neither holds, fall through to `claude-only` or
`reimplement` — never assert a vendor equivalent you cannot name.

**Multi-component plugins — cover every component, drop nothing (the key rule).**
Some plugins span several component kinds at once (e.g. `sentry` = one MCP server
**plus** ~30 SDK skills **plus** a command). The per-agent `outcome` stays a single
value — the **dominant** component's outcome per the preference order (so a plugin
that is fundamentally an MCP server is `re-point-mcp-lsp`). But the per-agent
`actions` array **MUST carry one action line for every component group**, including
the ones the dominant outcome doesn't cover. For `sentry`/codex that means BOTH
"re-point the sentry MCP" AND "reimplement (or claude-only) the 30 SDK skills" —
the skills must not be silently dropped behind the MCP outcome. If a residual
component group has no parity path, say so in `actions` as a flagged gap. A reviewer
reading the artifact must be able to see that **no component went uncovered**.

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
  "upstreamVersion": "1.0.0",          // max semver from the cache, the semver dir name, or "unknown" (see Version fallback)
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
    "agy":     { "outcome": "reimplement",             "actions": ["scaffold Lisa-native skill stamped synced-from: code-simplifier@claude-plugins-official@1.0.0"], "rationale": "Curated third-party plugins are not in agy's fan-out, so agy receives nothing natively; reimplement as a Lisa skill." },
    "copilot": { "outcome": "enable-vendor-equivalent","actions": ["enable copilot's native simplifier equivalent in the project-scoped marketplace"],                "rationale": "vendor ships a comparable capability; prefer enabling over reimplementing." }
  }
}
```

The human matrix `.md` presents the same `components` + `routing` as readable
tables so a reviewer can approve without parsing JSON.

### `actions` templates (use these exact shapes — do not deviate)

**Drift-trackable reimplement** (upstream has semver): one action, with the pin —
`"scaffold Lisa-native skill stamped synced-from: <name>@<marketplace>@<semver>"`.

**Non-drift-trackable reimplement** (`upstreamVersion: "unknown"`): **never write
`synced-from: ...@unknown`** — that pin is unparseable by `plugin-parity-drift`.
Instead emit exactly —
`"scaffold Lisa-native skill (NO synced-from pin: upstream publishes no semver, so it is not drift-trackable — record drift-tracking as manual review)"`.

**Multi-component plugin** (e.g. `sentry` = mcp + command + 30 skills): the per-agent
`actions` array carries **one real coverage action per component group** — and for a
group that has a parity path you write that path, you do **not** write a
"not addressed" flag. A flag is reserved ONLY for a group with genuinely no path.
Worked example — `sentry`/codex:
```json
"actions": [
  "emit the sentry HTTP MCP into Codex's .codex-plugin MCP pointer",
  "reimplement the 30 SDK skills as Lisa-native skills stamped synced-from: sentry@claude-plugins-official@<semver> (or claude-only where a skill is Claude-specific)",
  "reimplement the seer command as a Lisa-native skill stamped synced-from: sentry@claude-plugins-official@<semver>"
]
```
Every component group appears; nothing is left as "NOT addressed."

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
- `upstreamVersion` is resolved by the Version-fallback rules (semver, semver dir
  name, or `"unknown"`), and any `reimplement` of an `"unknown"`-version plugin
  flags the not-drift-trackable consequence.
- Every component the plugin actually ships is represented, and for each agent the
  `actions` cover **every** component group (multi-component plugins drop nothing).
- The sibling `.md` matrix is written.
- No source-tree edits were made.
- **`node scripts/plugin-routing-validate.mjs` exits `0`** — run it before the
  artifact is considered done. It re-checks the schema, the per-agent routing
  coverage, the version contract against the live cache, and the anti-pattern
  gates (no `@unknown` pin, no "not addressed" cop-out, `reimplement` carries its
  `synced-from` stamp). A non-zero exit means the artifact is not done.
- The skill STOPPED with the approval instruction.
