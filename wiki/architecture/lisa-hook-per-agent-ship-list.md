# Lisa Hook Per-Agent Ship-List

Pattern B per-agent plugin variants strip Claude-only hooks and polyfills that collide with native auto-discovery on other agents. This audit walks every hook entry in `plugins/src/base/.claude-plugin/plugin.json` and every shell script in `plugins/src/base/hooks/`, classifies each by event and per-agent applicability, and produces the ship-list that the Wave 3 generator scripts consume.

The classification follows two rules:

1. **Universal portability rule**: a hook script ships to an agent only when the agent's plugin runtime supports the registered event AND the script's behavior is meaningful for that agent's user surface.
2. **Polyfill-collision rule**: a polyfill hook MUST be stripped on any agent that natively auto-loads the same content from a different surface, because shipping both would double-inject.

## Hook events used by Lisa

The Claude `plugin.json` registers hook commands on seven events. Per-event support across the fleet (from `wiki/concepts/coding-agent-feature-taxonomy.md` and the canonical Step 2 support matrix).

**Cell legend:**
- ✅ = supported, [VERIFIED] from agent docs unless tagged otherwise
- ✅\* = supported with a caveat noted in the cell
- ⚠ = unverified — claim from agent docs not yet empirically confirmed
- ❌ = not supported

Parenthesized name = the agent's native event-name spelling when it differs from Claude's PascalCase.

| Event | Claude | Codex (0.125.0) | Cursor | agy | Copilot |
| --- | --- | --- | --- | --- | --- |
| `UserPromptSubmit` | ✅ | ✅ [VERIFIED-DOC: `codex features list` 0.125.0 lists `codex_hooks` stable] | ✅ (`beforeSubmitPrompt`) | ✅\* hooks don't fire in `-p` (verified-by-run) | ✅ (`userPromptSubmitted`) [VERIFIED-DOC: Copilot CLI plugin reference] |
| `PreToolUse` | ✅ | ✅ [VERIFIED-DOC: Codex hooks docs] | ✅ (`preToolUse`) | ✅\* doesn't fire in `-p` (verified-by-run) | ✅ (`preToolUse`) [VERIFIED-DOC] |
| `PostToolUse` | ✅ | ✅ [VERIFIED-DOC] | ✅ (`postToolUse`) | ✅\* doesn't fire in `-p` | ✅ (`postToolUse`) |
| `Stop` | ✅ | ✅ | ✅ (`stop`) | ✅\* doesn't fire in `-p` | ✅ (`agentStop`) |
| `SessionStart` | ✅ | ✅ | ✅ (`sessionStart`) | ✅\* doesn't fire in `-p` | ✅ (`sessionStart`) |
| `SessionEnd` | ✅ | ❌ | ✅ (`sessionEnd`) | ⚠ schema unverified | ✅ (`sessionEnd`) |
| `SubagentStart` | ✅ | ✅ (new in 0.125.0) [VERIFIED-DOC: `codex features list` shows `multi_agent` and `multi_agent_v2`; refreshed `reference-codex-hooks-capabilities` memory documents the full ten-event list including SubagentStart] — supersedes the older "no SubagentStart on Codex" claim in the pre-2026-05-28 version of that memory | ⚠ unverified | ⚠ unverified | ❌ (Copilot has `subagentStop` only) [VERIFIED-DOC] |

The agy column carries a blanket `✅* doesn't fire in -p` caveat: agy plugin-bundled hooks pass schema validation and install correctly but DO NOT execute during real `agy -p` sessions (verified-by-run across two probe sessions). Pattern B's agy variant therefore SHOULD NOT ship any hooks — they would only bloat the install. agy rules-injection uses the AGENTS.md bake-in alternative instead.

## Hook script catalog

Each script under `plugins/src/base/hooks/`:

| Script | Purpose | Agent applicability |
| --- | --- | --- |
| `block-no-verify.sh` | PreToolUse(Bash) gate that blocks `git commit --no-verify` and similar | universal — every agent that runs Bash via PreToolUse |
| `enforce-team-first.sh` | Enforces Lisa's "team-first" governance pattern (one agent team per project) | Claude-only (the pattern is Claude-team-specific to Lisa's Anthropic governance flow; not meaningful on other agents) |
| `inject-rules.sh` | SessionStart + SubagentStart polyfill injecting `${CLAUDE_PLUGIN_ROOT}/rules/eager/*.md` content via `additionalContext` | Claude, Codex, Copilot — **STRIP on Cursor** (Cursor auto-loads `rules/` natively, double-inject collision). **STRIP on agy** (hooks don't fire in `-p`; agy uses AGENTS.md bake-in instead). ⚠ Copilot ship is the conservative default since Copilot's plugin-level instruction-source field is undocumented (per `reference-copilot-plugin-capabilities`); empirical probe required before Wave 3 to confirm no double-inject collision against Copilot's instruction system. |
| `inject-flow-context.sh` | SubagentStart polyfill injecting flow context into sub-agents | Claude + Codex (Codex 0.125.0 now supports SubagentStart per refreshed `reference-codex-hooks-capabilities` memory). **STRIP on Cursor / agy / Copilot** (Copilot has no SubagentStart; Cursor unverified; agy hooks don't fire). |
| `install-pkgs.sh` | SessionStart(startup) installer ensuring required CLIs are present | universal — every agent's first session |
| `notify-ntfy.sh` | Stop notification via ntfy.sh | universal (it's a notification, not Claude-specific) |
| `setup-jira-cli.sh` | SessionStart sets up `acli` JIRA CLI auth from settings | universal |
| `debug-hook.sh` | Debug helper | **exclude from every per-agent variant by default** (it is a development helper, not a production hook). Wave 3 contract: generator scripts skip any `*debug*.sh`. |
| `ticket-sync-reminder.sh` | Reminder hook (event TBD — used in some flows) | **unregistered in `plugin.json`** — verify whether the file is intentionally idle or invoked by a non-plugin code path before classifying. Wave 3 contract: generator scripts skip it until classification is resolved. |
| `track-plan-sessions.sh` | Plan session tracking | **unregistered in `plugin.json`** — same as `ticket-sync-reminder.sh`. Skip in generators until classified. |

## `entire hooks claude-code <event>` calls

The `plugin.json` also registers calls to the external `entire` CLI on multiple events (`entire hooks claude-code <user-prompt-submit|post-task|post-todo|pre-task|stop|session-start|session-end>`). These are Lisa's coordinator that runs analytics + flow management for Claude Code specifically. Each call is wrapped in `command -v entire >/dev/null 2>&1 && entire hooks claude-code <event> || true` so the absence of `entire` is graceful.

- The `claude-code` subcommand string is hardcoded — `entire` does NOT have parallel subcommands for codex/cursor/agy/copilot (verified by reading the literal command string).
- **Ship on Claude only**. Strip from all other per-agent plugin variants.

## Per-agent ship-list (the Pattern B input contract)

| Hook entry | Event | Claude variant | Codex variant | Cursor variant | agy variant | Copilot variant |
| --- | --- | --- | --- | --- | --- | --- |
| `entire hooks claude-code user-prompt-submit` | UserPromptSubmit | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/enforce-team-first.sh` (UserPromptSubmit) | UserPromptSubmit | ship | strip | strip | strip | strip |
| `entire hooks claude-code post-task` (matcher=Task) | PostToolUse | ship | strip | strip | strip | strip |
| `entire hooks claude-code post-todo` (matcher=TodoWrite) | PostToolUse | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/enforce-team-first.sh` (matcher=TeamCreate) | PostToolUse | ship | strip | strip | strip | strip |
| `entire hooks claude-code pre-task` (matcher=Task) | PreToolUse | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/block-no-verify.sh` (matcher=Bash) | PreToolUse | ship | ship | ship | strip | ship |
| `${CLAUDE_PLUGIN_ROOT}/hooks/enforce-team-first.sh` (PreToolUse) | PreToolUse | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/notify-ntfy.sh` | Stop | ship | ship | ship | strip | ship |
| `entire hooks claude-code stop` | Stop | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/install-pkgs.sh` (matcher=startup) | SessionStart | ship | ship | ship | strip | ship |
| `${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.sh` | SessionStart | ship | ship | **STRIP** (Cursor auto-loads rules) | strip | ship |
| `${CLAUDE_PLUGIN_ROOT}/hooks/setup-jira-cli.sh` | SessionStart | ship | ship | ship | strip | ship |
| `entire hooks claude-code session-start` | SessionStart | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.sh` (SubagentStart) | SubagentStart | ship | ship | strip | strip | strip (Copilot has no SubagentStart) |
| `${CLAUDE_PLUGIN_ROOT}/hooks/inject-flow-context.sh` | SubagentStart | ship | ship | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/enforce-team-first.sh` (SubagentStart) | SubagentStart | ship | strip | strip | strip | strip |
| `entire hooks claude-code session-end` | SessionEnd | ship | strip (no event) | strip | strip | strip |

## Net by per-agent variant

- **Claude (`plugins/lisa/`)** — ships every hook. Status quo, no change.
- **Codex (`plugins/lisa/` via `.codex-plugin` pointer)** — ships universally-applicable + SubagentStart hooks (`block-no-verify.sh`, `inject-rules.sh`, `inject-flow-context.sh`, `notify-ntfy.sh`, `install-pkgs.sh`, `setup-jira-cli.sh`). Strips all `entire hooks claude-code *` calls and `enforce-team-first.sh`. Codex 0.125.0 now supports plugin-bundled hooks — migrating the Codex hooks installer from per-project `.codex/hooks.json` to plugin-bundled is Wave 3 Action 3 in the research artifact.
- **Cursor (`plugins/lisa-cursor/`)** — ships `block-no-verify.sh`, `notify-ntfy.sh`, `install-pkgs.sh`, `setup-jira-cli.sh`. **STRIPS `inject-rules.sh`** entirely (Cursor auto-loads `rules/` natively — preventing the double-injection collision is Pattern B's whole point). Strips Claude-specific entire calls and enforce-team-first. Strips inject-flow-context (Cursor SubagentStart unverified — defer until research refresh).
- **agy (`plugins/lisa-agy/`)** — **SHIPS NO HOOKS AT ALL**. agy plugin hooks don't fire in `-p` mode. Rules injection on agy uses AGENTS.md bake-in instead (Cluster 4-agy / Option α from the research artifact's Step 4).
- **Copilot (`plugins/lisa-copilot/`)** — ships `block-no-verify.sh`, `inject-rules.sh` (Copilot doesn't auto-load rules from plugin), `notify-ntfy.sh`, `install-pkgs.sh`, `setup-jira-cli.sh`. Strips all SubagentStart hooks (Copilot doesn't have that event). Strips entire calls and enforce-team-first. The Copilot variant's `inject-rules.sh` may need its `${CLAUDE_PLUGIN_ROOT}` path reference adapted if Copilot exposes a different plugin-root env var name (e.g. `${COPILOT_PLUGIN_ROOT}` — unverified; Pattern B generator should probe and document).

## Open questions surfaced by the audit

Blocking for Wave 3:

1. **Cursor SubagentStart event** — Cursor's `discoverComponents` loader normalizes Claude event names; whether `SubagentStart` maps to a Cursor-supported event (perhaps `subagentStart` or similar) is unverified. The audit currently strips SubagentStart hooks from Cursor as a conservative default. Probe needed before Wave 3 finalizes the Cursor generator.
2. **Copilot inject-rules.sh collision risk** — the audit ships `inject-rules.sh` to Copilot conservatively, but Copilot's plugin-level `instructions` source per generated RPC declarations may auto-load `rules/` content the same way Cursor does. If true, shipping the polyfill double-injects. Probe needed: install Lisa via `--plugin-dir` on Copilot, observe whether rules content lands in context twice.
3. **Copilot plugin-root env var name** — `${COPILOT_PLUGIN_ROOT}` is the natural guess but unverified. Generator MUST settle the question (probe or fall back to absolute paths) before Wave 3 emits Copilot hooks.

Deferred / non-blocking:

4. **agy `${CLAUDE_PLUGIN_ROOT}` env var** — agy ships no hooks under Pattern B, so this question is moot for the implementation. Re-evaluate if agy plugin hooks ever fire in interactive mode (currently verified-by-run-not-firing in `-p`).

## Wave 3 consumption

The Pattern B generator scripts (`scripts/generate-cursor-plugin-artifacts.mjs`, `scripts/generate-agy-plugin-artifacts.mjs`, `scripts/generate-copilot-plugin-artifacts.mjs`, plus the extension to `scripts/generate-codex-plugin-artifacts.mjs`) implement this audit by:

1. **Read** `plugins/src/base/.claude-plugin/plugin.json` (the source-of-truth hook block).
2. **Filter hook entries**: walk each `(event, matcher, command)` entry, look up the agent's column in the per-agent ship-list table above, and keep only "ship" entries.
3. **Filter scripts**: walk `plugins/src/base/hooks/*.sh`, exclude any `*debug*.sh` and any script flagged "unregistered" in the catalog (currently `ticket-sync-reminder.sh` and `track-plan-sessions.sh`), then keep only scripts referenced by surviving hook entries.
4. **Translate event names** per the agent's native casing:
   - Claude / Codex: PascalCase (`PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`).
   - Cursor: the loader auto-normalizes Claude PascalCase to its native lowercase (`preToolUse` etc.); generator may emit either form. Prefer Claude form for source consistency.
   - Copilot: lowercased / camelCase per its own contract (`preToolUse`, `postToolUse`, `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `agentStop`, `subagentStop`, `errorOccurred`). Generator MUST rewrite event names.
5. **Translate matcher fields** when the source matcher uses a Claude-specific token:
   - `SessionStart` `matcher: "startup"` is a Claude convention (startup vs resume vs clear). Codex SessionStart `source` field carries the same {startup, resume, clear} signal but matcher application may differ; verify against Codex hooks docs.
   - Cursor / Copilot matcher semantics on session events are unverified. Conservative default: emit the matcher as-is and accept that a "startup-only" hook may fire on every SessionStart on the target agent until the matcher contract is empirically pinned.
6. **Rewrite plugin-root env var** in `command` strings AND in shipped script bodies per the target agent:
   - Claude / Cursor: `${CLAUDE_PLUGIN_ROOT}` (Cursor inherits Claude's env var name per the dual-namespace loader).
   - Codex: prior research found `CLAUDE_PLUGIN_ROOT` / `CODEX_PLUGIN_ROOT` are NOT set for hook commands (per `reference-codex-hooks-capabilities`). Wave 3 generator MUST translate `${CLAUDE_PLUGIN_ROOT}/hooks/<n>.sh` to an absolute path the Codex installer resolves at install time (analogous to how `src/codex/hooks-installer.ts` currently writes absolute paths into project `.codex/hooks.json`).
   - agy: not applicable (variant ships no hooks).
   - Copilot: ⚠ env var name unverified. Community examples literally use `${CLAUDE_PLUGIN_ROOT}` for Antigravity-targeted hooks but Copilot's actual convention is undocumented. Wave 3 generator MUST probe Copilot's runtime env (`${COPILOT_PLUGIN_ROOT}` is the natural guess) before final emit; fall back to absolute paths if no env var is exposed.
7. **Emit** the agent-appropriate `hooks` block in the variant's manifest plus the surviving `hooks/` directory.

For agy specifically the generator skips steps 2-7 entirely and emits no `hooks/` directory plus no `hooks` field in the manifest.

## Verified by run — 2026-05-28 follow-up (Codex 0.125.0 + Copilot 1.0.55)

The Wave 1 claims above were tagged `[VERIFIED-DOC]`. A follow-up pass
empirically tested them and corrected several. Backing evidence is recorded in
the `reference_codex_plugin_hooks_shape_and_firing` session memory.

**Codex plugin-bundled hooks (corrects the Action-3 assumptions):**

- Plugin-bundled hooks **do** fire in Codex 0.125.0 (official docs:
  developers.openai.com/codex/plugins/build) — but only after the plugin is
  installed AND the hooks are trusted via the interactive `/hooks` flow.
  **There is no non-interactive trust bypass in 0.125.0** (the documented
  `--dangerously-bypass-hook-trust` flag is not present), so end-to-end hook
  *firing* cannot be verified in `codex exec` or scripted CI — it is verified by
  authoritative docs + artifact structure, not by an automated run.
- **Discovery path (was wrong in the first Wave 3b cut):** Codex auto-discovers
  `<plugin-root>/hooks/hooks.json` and resolves the manifest `hooks` pointer
  relative to the **plugin root**. The first cut wrote `.codex-plugin/hooks.json`
  with a `./hooks.json` pointer that resolved to a non-existent
  `<root>/hooks.json`; Codex never found it. Fixed: write
  `hooks/hooks.json`, point `./hooks/hooks.json`.
- **Plugin-root env var (corrects step 6):** Codex exposes `${PLUGIN_ROOT}` to
  hook commands. The generator rewrites `${CLAUDE_PLUGIN_ROOT}/hooks/<n>.sh`
  → `${PLUGIN_ROOT}/hooks/<n>.sh` (not the cwd-relative `./hooks/` the first cut
  emitted, nor an absolute path).
- **hooks.json root shape:** events nest under a top-level `hooks` key
  (`{ "hooks": { … } }`) per the `HooksFile` contract in
  `src/codex/hooks-merger.ts`.
- **Marketplace key:** `codex plugin marketplace add CodySwannGT/lisa` registers
  `[marketplaces.lisa]` (name from the manifest), so the enabled-plugin key is
  `lisa@lisa` — not the repo-slug forms previously assumed. `marketplace add`
  reads `.claude-plugin/marketplace.json` (no install policy there) and does NOT
  auto-install; install + trust are interactive. The per-project installer
  (`src/codex/hooks-installer.ts`) remains the verified-working delivery path.

**Copilot (corrects step 6 + agent-path assumptions):**

- Copilot does **not** auto-load a plugin's bundled `rules/` directory
  (`--plugin-dir` probe returned UNKNOWN for a sentinel rule), so `inject-rules.sh`
  must ship for Copilot. It *does* auto-load the project's
  `.github/copilot-instructions.md`, but Lisa's template there is only a pointer.
- Copilot aliases the `CLAUDE_*` plugin env vars (its CLI reference documents
  `${COPILOT_PLUGIN_DATA}` is also `${CLAUDE_PLUGIN_DATA}`), so the
  `${CLAUDE_PLUGIN_ROOT}` form the generator emits in Copilot hook commands is
  supported.
- With an explicit manifest `agents: "./agents/"` pointer, Copilot loads
  non-`.agent.md` agent files via `--plugin-dir`; the generator keeps the
  universally-safe `<n>.agent.md` rename because the marketplace-install path is
  unverified.

**`lisa apply --harness fleet` end-to-end (two dispatch bugs found + fixed):**

- `processCodexEmit` was missing `"fleet"` in its guard, so fleet installs
  silently skipped all Codex artifacts. Fixed; centralized in
  `harnessIncludesAgent(harness, agent)` so the four emit guards can't drift.
- agy's AGENTS.md bake read rules from the stripped `lisa-agy/rules/eager`
  (empty); it now bakes the base plugin's `lisa/rules/eager` (13 rules).
- Verified: a fleet apply emits all four paths (Codex 55 agents / 5 hooks /
  253 skills, Claude `CLAUDE.md`, agy 13 rules baked, Copilot instructions),
  registers the plugin as `lisa@lisa`, and a single-agent harness emits only its
  own agent. No rule double-injection: cursor auto-loads `rules/` (no
  inject-rules hook), copilot/codex/claude inject once via hooks, agy bakes once.
