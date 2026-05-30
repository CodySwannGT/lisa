---
name: implement-plugin-parity
description: This skill should be used to execute an APPROVED plugin-parity routing artifact produced by analyze-plugin. It hard-gates on `status:"approved"`, then performs only the artifact's declared deterministic actions — emitting MCP/LSP into agent variants via the existing generators/installers, enabling vendor equivalents, and scaffolding `synced-from`-stamped Lisa skills for approved reimplement cases. It reuses Lisa's existing generators/installers as black boxes and NEVER ports upstream plugin code. An un-approved or schema-invalid artifact is a no-op error.
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"]
---

# Implement Plugin Parity (EXECUTION)

This skill consumes an **approved** routing artifact written by `analyze-plugin`
and executes its plan. It is the execution half of the parity subsystem; the
planning half (`analyze-plugin`) and the drift check (`plugin-parity-drift`) are
its siblings.

## Hard approval gate (do this first)

0. **Pre-flight validation gate.** Run
   `node scripts/plugin-routing-validate.mjs` (optionally scoped with
   `--routing-dir`/`--cache-root`). If it exits non-zero → **STOP**; the artifact
   set is schema-invalid, version-stale, or trips an anti-pattern gate, and must
   be re-run through `analyze-plugin` and re-approved before implementation. Do
   not act on an artifact that fails this gate.
1. Read `parity/plugin-routing/<plugin>@<marketplace>.json`.
2. If the file is missing, malformed, or fails the routing-artifact schema
   (embedded below) → **STOP** with an error. Do nothing else.
3. If `status` is not exactly `"approved"` → **STOP** and print:
   _"Artifact is `<status>`, not `approved`. A human must review the matrix and
   flip `status` to `approved` (visible in the git diff) before
   implement-plugin-parity will run."_ Make **no** changes.
4. Only when `status === "approved"` (and the pre-flight gate passed) do you
   perform the actions below.

This gate is the whole point of separating analyze from implement: nothing
deterministic happens to the source tree until a human has approved the routing
in the committed artifact. **The gate is human/CI-enforced, not a programmatic
interlock** — "approval" is a committed, git-diff-visible `status` flag a
reviewer flips, and this skill simply refuses to act unless it reads
`"approved"`. There is no separate lock; the audit trail is the git history of
the artifact.

## Routing artifact schema (the contract this skill validates)

The artifact this skill consumes is written by `analyze-plugin`; this is a
compact copy of its schema so an executor reading this skill alone can validate
it (the authoritative copy lives in `analyze-plugin/SKILL.md` and the design
doc). Reject the artifact if any required field is missing or mistyped:

```jsonc
{
  "schemaVersion": 1,
  "plugin": "code-simplifier@claude-plugins-official", // canonical id == synced-from plugin-ref
  "pluginName": "code-simplifier",
  "marketplace": "claude-plugins-official",
  "upstreamVersion": "1.0.0",      // resolved from the cache; used for the synced-from stamp
  "analyzedAt": "2026-05-30",      // informational only
  "status": "proposed",            // "proposed" | "approved" — MUST be "approved" to run
  "components": [                  // inventory; each: { kind, id, path, classification, notes }
    { "kind": "agent", "id": "code-simplifier", "path": "agents/code-simplifier.md", "classification": "claude-agent", "notes": "" }
  ],
  "routing": {                     // exactly one entry per agent; outcome from the locked enum
    "codex":   { "outcome": "reimplement",              "actions": ["..."], "rationale": "..." },
    "cursor":  { "outcome": "claude-only",              "actions": [],      "rationale": "..." },
    "agy":     { "outcome": "reimplement",              "actions": ["..."], "rationale": "..." },
    "copilot": { "outcome": "enable-vendor-equivalent", "actions": ["..."], "rationale": "..." }
  }
}
```

Outcome enum (locked): `already-native | re-point-mcp-lsp |
enable-vendor-equivalent | claude-only | reimplement`.

## What it does (deterministic actions only)

For each agent's routing entry, perform **only** the declared `actions`,
according to the `outcome`:

- `already-native` — no action; the existing fan-out already covers it.
- `re-point-mcp-lsp` — emit the MCP/LSP server into that agent's variant by
  invoking the **existing** generator/installer as a black box (see "Reused
  building blocks"). Do not hand-write variant manifests.
- `enable-vendor-equivalent` — enable the agent's native equivalent in its
  project-scoped marketplace per the declared action.
- `claude-only` — no action; documented as intentionally not ported.
- `reimplement` — scaffold a Lisa-native skill stamped
  `synced-from: <name>@<marketplace>@<upstreamVersion>` (the value from the
  artifact). **v1 scaffolds only** — create the skill shell + frontmatter pin;
  the actual reimplementation logic is out of scope per the issue. This is the
  only action that creates a drift-tracked artifact.

After any `re-point-mcp-lsp` work that flows through the build, run
`bun run build:plugins` so the agent variants regenerate deterministically, and
confirm `bun run check:plugins` still passes.

## Reused building blocks (cite, never reimplement)

These are invoked as black boxes — this skill never edits them and never copies
upstream plugin source into them:

- `scripts/build-plugins.sh` — `build_plugin` (Claude→Codex derive) and the
  per-agent fan-out (`build_per_agent_variant`). Triggered via
  `bun run build:plugins`.
- `scripts/generate-codex-plugin-artifacts.mjs` — Codex `.codex-plugin/`
  derivation (skills + MCP pointer + hooks).
- `scripts/generate-cursor-plugin-artifacts.mjs` — Cursor variant (`.mdc`
  rules, `mcp.json`, native hooks).
- `scripts/generate-agy-plugin-artifacts.mjs` (`generateAgyVariant`) — agy
  variant; **drops** `.mcp.json`/`mcpServers` (MCP is user-global only).
- `scripts/generate-copilot-plugin-artifacts.mjs` — Copilot surfaces a bundled
  `.mcp.json`'s servers as an **inline `mcpServers`** object on the manifest;
  also uniquely supports `lspServers`.
- `src/agy/mcp-installer.ts` — agy runtime MCP delivery
  (`~/.gemini/config/mcp_config.json`, `serverUrl` shape, `_lisaManaged`
  tagged-merge). The non-plugin path for agy MCP.

If a routed action needs a **new** emission path that none of these already
provides (e.g. the first LSP routed to Copilot `lspServers`), do **not** silently
attempt it — that is a separate work item. Surface it, leave it for a follow-up,
and complete the rest.

## Placement constraints

- Scaffolded reimplementation skills are **Lisa-repo-internal** and live at root
  `.claude/skills/<name>/SKILL.md` — NEVER in `plugins/src/` or
  `all/copy-overwrite/` (per PROJECT_RULES.md, same rule that keeps the parity
  skills root-only).
- Never port upstream plugin code. A `reimplement` scaffold is a Lisa-native
  shell carrying the `synced-from` pin so `plugin-parity-drift` can track it; the
  behavior is authored separately, not copied from the upstream plugin.

## The `synced-from` stamp

Every scaffolded reimplement skill carries exactly:

```yaml
synced-from: <name>@<marketplace>@<upstreamVersion>
```

where the three fields come from the approved artifact's `pluginName`,
`marketplace`, and `upstreamVersion`. This stamp is what `plugin-parity-drift`
reads to detect when upstream has advanced past the pinned version.

## Definition of done

- The artifact was `status:"approved"` (otherwise this skill was a no-op error).
- Only the artifact's declared `actions` were performed.
- Any `reimplement` produced a root `.claude/skills/<name>/SKILL.md` stamped with
  the correct `synced-from` pin.
- No upstream plugin source was copied; no generator/installer file was edited.
- If the build was involved, `bun run build:plugins` is deterministic and
  `bun run check:plugins` passes.
- Any required new emission path was flagged as a follow-up rather than
  improvised.
