---
name: lisa-codex-parity
description: This skill should be used when adding or changing a Lisa feature surface (hooks, skills, agents, slash-commands, MCP servers, settings, memory) and you need the Codex distribution to reach parity with the Claude distribution. It drives the `codex` CLI in a back-and-forth conversation to investigate what Codex actually supports (source-read AND empirical runtime capture — never docs alone), builds a Claude→Codex gap matrix, implements the missing equivalents, and has Codex empirically verify the result end-to-end. Use it whenever Claude Code or Codex ships a new capability, or whenever you bundle something new into Lisa for Claude and need to mirror it for Codex.
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill"]
---

# Lisa ↔ Codex Parity

Lisa is distributed for **both** Claude Code and Codex. Claude is the production
path; the Codex side is derived/installed separately (see "Where Codex artifacts
live" below). When a feature surface changes on the Claude side — or when either
harness ships a new capability — the Codex side drifts. This skill is the
repeatable protocol for closing that gap by having **Claude and Codex converse**
until they reach parity.

It generalizes the hooks-parity pass that produced
[[reference-codex-hooks-capabilities]] — read that and the worked example below
before starting.

## Core principle: empirical, not documentary

**Do not trust documentation or assumptions about what Codex supports.** Codex's
behavior across versions is subtle and has bitten Lisa before (e.g. plugin-
bundled `hooks/hooks.json` silently never runs; `apply_patch` passes the patch as
a *string* under `tool_input.command`, not an array). Every parity claim must be
backed by one of:

1. **Source-read** — Codex inspects its own installed binary/source/config
   schema (`codex --version`, `codex features list`, `~/.codex/`, vendored Rust
   source, generated schemas).
2. **Runtime capture** — Codex runs a real `codex exec` session and observes
   actual behavior (capture hook stdin, confirm a block happened, confirm
   injected context reached the model).

Tag every finding `[VERIFIED]`, `[VERIFIED-BY-RUN]`, or `[UNKNOWN]`. Treat
`[UNKNOWN]` as "must run a test before relying on it."

## Prerequisites

- The `codex` CLI is installed and authed on this machine. How to drive it non-
  interactively (one-shot, resume, flags, `/tmp` brief→answer pattern) is in
  [[reference-codex-cli-collaboration]]. Key invocation:
  `codex exec -c mcp_servers={} -c model_reasoning_effort="high" "<prompt>"`,
  continue with `codex exec resume --last "<prompt>"`.
- Codex has full filesystem access here, so it can verify claims about Lisa's own
  files itself and run isolated tests under a throwaway `CODEX_HOME`.

## The protocol

### Step 1 — Inventory the Claude side

Pin down exactly what the feature surface is on the Claude side and where it
lives in the repo. Source of truth is `plugins/src/` (never the generated
`plugins/lisa*` artifacts — see PROJECT_RULES.md). For each item record: the
event/trigger, matcher, the script/file, and which stack(s) it applies to.

### Step 2 — Brief Codex; have it investigate the Codex side

Write a brief to `/tmp/<topic>-brief.md` listing the Claude-side items and asking
precise questions about the Codex equivalent. Have Codex write its answer to
`/tmp/<topic>-answer.md`. Insist on source-read **and** runtime capture, with
confidence tags. A good question set covers:

- Does Codex support this surface at all? Via what config mechanism and exact
  schema/shape? (For hooks: `~/.codex/hooks.json` / project `.codex/hooks.json` /
  `config.toml` `[hooks]`, gated by `[features].codex_hooks = true` — **NOT** a
  plugin-bundled `hooks.json`, which does not run.)
- Map each Claude trigger/event/field to its Codex equivalent, or "no
  equivalent."
- Input/output/exit contract differences (field names, tool names, blocking,
  context injection shape).
- Codex-only capabilities Claude lacks (e.g. `PermissionRequest`).
- Porting caveats (env vars not set, cwd, timeouts, matcher semantics).

For load-bearing or `[UNKNOWN]` claims, send a follow-up brief asking Codex to
**run** a focused test and report the command + observed output.

### Step 3 — Build the gap matrix

Classify every Claude-side item into exactly one bucket:

- **Has equivalent** — works on Codex as-is once installed correctly.
- **Needs adaptation** — equivalent event exists but the contract differs (e.g.
  `apply_patch` gives a patch body, not `tool_input.file_path`). Implement the
  adaptation.
- **No equivalent** — Codex genuinely lacks it. Document it as intentionally
  not ported; do not fake it.

### Step 4 — Implement the missing equivalents

Make the changes under the Codex-side source of truth, then rebuild. See "Where
Codex artifacts live." Keep subtle, easy-to-get-wrong logic (envelope parsing,
output shapes) in a single shared helper so it can't drift between scripts.

### Step 5 — Empirical end-to-end verification by Codex

Do not declare parity from unit tests alone. Have Codex stand up a throwaway
project (isolated `CODEX_HOME`), wire in the actual artifacts, run a real
`codex exec` session that exercises the feature, and confirm the observable
outcome (file reformatted, edit blocked + file hash unchanged, context injected,
etc.). Capture commands and outputs in `/tmp/<topic>-e2e-answer.md`.

### Step 6 — Land it

- Add/maintain regression tests (shell hooks are testable by spawning them with
  crafted JSON — see `tests/unit/codex/codex-edit-hooks.test.ts`).
- `bun run typecheck`, `bun run test:unit`, `bun run build`, and ensure the
  plugin build is deterministic so `bun run check:plugins` passes once committed.
- Document the **no-equivalent** items in code comments and update the relevant
  capability memory ([[reference-codex-hooks-capabilities]] and siblings) so the
  next parity pass starts from current knowledge.

## Where Codex artifacts live

- **Skills** load via the `.codex-plugin` `skills` pointer (SKILL.md only) — see
  [[reference-codex-plugin-skill-loading]]. Generated by
  `scripts/generate-codex-plugin-artifacts.mjs` during `bun run build:plugins`.
- **Hooks** are NOT distributed via the plugin (Codex doesn't execute plugin-
  bundled hooks). They are installed into the project's `.codex/hooks.json` by
  `src/codex/hooks-installer.ts` (catalog of which scripts ship per stack), with
  the shell scripts in `src/codex/scripts/` and a tagged-merge writer in
  `src/codex/hooks-merger.ts`.
- **MCP / settings / agents / AGENTS.md** have their own installers under
  `src/codex/` (`*-installer.ts`). Check there before assuming a surface is
  unported.

## Known Codex capability reference (as of codex-cli 0.125.0)

Authoritative details live in [[reference-codex-hooks-capabilities]]. Quick recap:

- Hook events: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `SessionStart`,
  `UserPromptSubmit`, `Stop`. **No** `SubagentStart`, `SessionEnd`,
  `Notification`, `PreCompact`.
- Context injection: `{"hookSpecificOutput":{"hookEventName":"<event>","additionalContext":"..."}}`
  on SessionStart/UserPromptSubmit/PostToolUse (not PreToolUse).
- Blocking: PreToolUse exit 2 + stderr, or `permissionDecision:"deny"`.
- Edit tool is `apply_patch`; patch body is the **string** `tool_input.command`
  (parse `*** Add/Update/Delete File:` headers); no `tool_input.file_path`.
- `CLAUDE_PLUGIN_ROOT`/`CODEX_PLUGIN_ROOT` are not set for hook commands.

Re-verify these against the installed Codex version at the start of each pass —
new Codex releases may add events or change contracts.

## Worked example — the hooks parity pass

The canonical reference run: inventoried Lisa's bundled hooks, drove Codex to
map them to Codex events (source-read), captured the real `apply_patch` hook
envelope by running Codex, found the post-edit hooks silently skipped Codex's
primary edit path and the migration guard's `command[1]` parse was a no-op,
implemented a shared `_extract-edit-paths.sh`, and had Codex prove end-to-end
that format-on-edit reformats an `apply_patch` file and block-migration denies an
`apply_patch` migration edit. See `src/codex/scripts/` and
`tests/unit/codex/codex-edit-hooks.test.ts`.

## Definition of done

- Every Claude-side item is classified (has-equivalent / adapted / no-equivalent)
  with at least one empirical verification backing the "works" claims.
- Implemented equivalents pass unit tests AND a real Codex `codex exec` run.
- No-equivalent items are documented in code + capability memory.
- `typecheck`, `test:unit`, `build`, and `check:plugins` are green.
