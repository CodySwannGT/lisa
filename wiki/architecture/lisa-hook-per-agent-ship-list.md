# Lisa Hook Per-Agent Ship-List

> **2026-06-06 supersede (agy rules story).** Every "rules via the AGENTS.md bake (rules-once invariant)" claim for agy below is **out of date**. PR #1150 removed the agy rule-baking installer (`src/agy/agents-md-installer.ts`). `AGENTS.md` is now canonical and **rule-free** for all agents, `CLAUDE.md` is a thin `@AGENTS.md` pointer, and `lisa doctor` migrates existing projects (`src/core/instruction-files-migration.ts`). The conclusion that `inject-rules.sh` is **stripped on agy** is still correct, but the *reason* has changed: agy gets no eager-rule injection at all (it has no SessionStart event for the hook, and the bake that used to substitute for it is gone). Not delivering eager rules to agy is the accepted trade-off. Read the agy rows below through this correction.

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
| `UserPromptSubmit` | ✅ | ✅ [VERIFIED-DOC: enabled by `[features].hooks`; `codex_hooks` is deprecated] | ✅ (`beforeSubmitPrompt`) | ✅\* hooks don't fire in `-p` (verified-by-run) | ✅ (`userPromptSubmitted`) [VERIFIED-DOC: Copilot CLI plugin reference] |
| `PreToolUse` | ✅ | ✅ [VERIFIED-DOC: Codex hooks docs] | ✅ (`preToolUse`) | ✅\* doesn't fire in `-p` (verified-by-run) | ✅ (`preToolUse`) [VERIFIED-DOC] |
| `PostToolUse` | ✅ | ✅ [VERIFIED-DOC] | ✅ (`postToolUse`) | ✅\* doesn't fire in `-p` | ✅ (`postToolUse`) |
| `Stop` | ✅ | ✅ | ✅ (`stop`) | ✅\* doesn't fire in `-p` | ✅ (`agentStop`) |
| `SessionStart` | ✅ | ✅ | ✅ (`sessionStart`) | ✅\* doesn't fire in `-p` | ✅ (`sessionStart`) |
| `SessionEnd` | ✅ | ❌ | ✅ (`sessionEnd`) | ⚠ schema unverified | ✅ (`sessionEnd`) |
| `SubagentStart` | ✅ | ✅ (new in 0.125.0) [VERIFIED-DOC: `codex features list` shows `multi_agent` and `multi_agent_v2`; refreshed `reference-codex-hooks-capabilities` memory documents the full ten-event list including SubagentStart] — supersedes the older "no SubagentStart on Codex" claim in the pre-2026-05-28 version of that memory | ⚠ unverified | ⚠ unverified | ❌ (Copilot has `subagentStop` only) [VERIFIED-DOC] |

> **Update (ticket-1054, agy 1.0.3 — runtime-verified):** runtime probes established how agy actually consumes each surface (after two earlier dead ends):
> - **Hooks: plugin-bundled, ROOT-level.** agy DOES load a plugin's hooks from a `hooks.json` at the installed plugin ROOT (`~/.gemini/config/plugins/<variant>/hooks.json`). The earlier failure was a `hooks/` SUBDIR hooks.json, which agy does NOT scan. So `generate-agy-plugin-artifacts.mjs` emits a root `hooks.json` in agy's schema (top-level hook-name → event → handlers), matcher `run_command` (agy's shell tool), and ships the agy-protocol script into the variant's `hooks/` subdir; the command points at the `$HOME`-absolute installed script path (agy exposes no plugin-root env var, so `$HOME` is used). Only events agy supports map (PreToolUse/PostToolUse/PreInvocation/PostInvocation/Stop) — SessionStart is unsupported, so `install-pkgs.sh`/`setup-jira-cli.sh` CANNOT ship as agy hooks; only `block-no-verify` (PreToolUse) maps. Only the BASE plugin manifest carries the universal hooks, so only `lisa-agy` gets a hooks.json (stack variants get none).
> - **MCP: user-global only.** agy ignores plugin-bundled MCP and only auto-loads `~/.gemini/config/mcp_config.json` (the per-project `.agents/mcp_config.json` is NOT read by the CLI), so MCP is delivered by the runtime installer `installAgyMcpConfig`.
>
> The agy column's `✅*` marks below are historical Wave-1 annotations; ignore the earlier "fires from subdir" wording. The agy ship-list below is documentation; the generator's `AGY_PLUGIN_HOOKS` map is the source of truth for what actually ships (only `block-no-verify` is agy-portable). `notify-ntfy.sh` was retired entirely in ticket-1054 (see the catalog note below), dropping every agent's universal set from 4 to 3. `inject-rules.sh` is stripped on agy. (Was: "rules still use the AGENTS.md bake (rules-once invariant)." Corrected 2026-06-06 — the bake was removed (PR #1150); agy now gets no eager-rule injection, the accepted trade-off, since it has no SessionStart event and `AGENTS.md` is rule-free.)

## Hook script catalog

Each script under `plugins/src/base/hooks/`:

| Script | Purpose | Agent applicability |
| --- | --- | --- |
| `block-no-verify.sh` | PreToolUse(Bash) gate that blocks `git commit --no-verify` and similar | universal — every agent that runs Bash via PreToolUse |
| `enforce-team-first.sh` | Enforces Lisa's "team-first" governance pattern (one agent team per project) | Claude-only (the pattern is Claude-team-specific to Lisa's Anthropic governance flow; not meaningful on other agents) |
| `inject-rules.sh` | SessionStart + SubagentStart polyfill injecting `${CLAUDE_PLUGIN_ROOT}/rules/eager/*.md` content via `additionalContext` | Claude, Codex, Copilot — **STRIP on Cursor** (issue #1055: the Cursor generator converts rules to native `.mdc` files — eager `rules/<name>.mdc` `alwaysApply:true`, reference `rules/<name>-reference.mdc` `alwaysApply:false` — which is the single rules-delivery path; Cursor does NOT auto-load the nested `rules/eager|reference/*.md` tree, so the polyfill would deliver rules a SECOND, broken way). **STRIP on agy** (agy has no SessionStart event for the polyfill, and as of 2026-06-06 — PR #1150 — gets no eager-rule injection at all: `AGENTS.md` is rule-free and the old bake is removed; the agy artifact ships no `rules/`. Previously documented as "rules delivered exactly once via the AGENTS.md bake — the rules-once invariant"). ⚠ Copilot ship is the conservative default since Copilot's plugin-level instruction-source field is undocumented (per `reference-copilot-plugin-capabilities`); empirical probe required before Wave 3 to confirm no double-inject collision against Copilot's instruction system. |
| `inject-flow-context.sh` | SubagentStart polyfill injecting flow context into sub-agents | Claude + Codex (Codex 0.125.0 now supports SubagentStart per refreshed `reference-codex-hooks-capabilities` memory). **STRIP on Cursor / agy / Copilot** (Copilot has no SubagentStart; Cursor unverified; SubagentStart is not in agy's universal ship-list). |
| `install-pkgs.sh` | SessionStart(startup) installer ensuring required CLIs are present | universal — every agent's first session |
| ~~`notify-ntfy.sh`~~ | ~~Stop notification via ntfy.sh~~ | **RETIRED (ticket-1054)** — removed from Lisa's source entirely (the script, the base `Stop` hook entry, the Codex hook def, and every per-agent ship-list). It was emitting a `No such file or directory` Stop-hook error and is no longer used. |
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
| `${CLAUDE_PLUGIN_ROOT}/hooks/block-no-verify.sh` (matcher=Bash) | PreToolUse | ship | ship | ship | ship | ship |
| `${CLAUDE_PLUGIN_ROOT}/hooks/enforce-team-first.sh` (PreToolUse) | PreToolUse | ship | strip | strip | strip | strip |
| ~~`${CLAUDE_PLUGIN_ROOT}/hooks/notify-ntfy.sh`~~ | ~~Stop~~ | **RETIRED (ticket-1054)** — entry removed from `plugins/src/base/.claude-plugin/plugin.json` | — | — | — | — |
| `entire hooks claude-code stop` | Stop | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/install-pkgs.sh` (matcher=startup) | SessionStart | ship | ship | ship | **STRIP** (agy has no SessionStart event) | ship |
| `${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.sh` | SessionStart | ship | ship | **STRIP** (rules ship as native `.mdc`; issue #1055) | **STRIP** (agy has no SessionStart event; AGENTS.md is rule-free — bake removed 2026-06-06, PR #1150; no eager-rule injection on agy) | ship |
| `${CLAUDE_PLUGIN_ROOT}/hooks/setup-jira-cli.sh` | SessionStart | ship | ship | ship | **STRIP** (agy has no SessionStart event) | ship |
| `entire hooks claude-code session-start` | SessionStart | ship | strip | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/inject-rules.sh` (SubagentStart) | SubagentStart | ship | ship | strip | strip | strip (Copilot has no SubagentStart) |
| `${CLAUDE_PLUGIN_ROOT}/hooks/inject-flow-context.sh` | SubagentStart | ship | ship | strip | strip | strip |
| `${CLAUDE_PLUGIN_ROOT}/hooks/enforce-team-first.sh` (SubagentStart) | SubagentStart | ship | strip | strip | strip | strip |
| `entire hooks claude-code session-end` | SessionEnd | ship | strip (no event) | strip | strip | strip |

## Net by per-agent variant

- **Claude (`plugins/lisa/`)** — ships every hook. Status quo, no change.
- **Codex (`plugins/lisa/` via `.codex-plugin` pointer)** — ships universally-applicable + SubagentStart hooks (`block-no-verify.sh`, `inject-rules.sh`, `inject-flow-context.sh`, `install-pkgs.sh`, `setup-jira-cli.sh`). Strips all `entire hooks claude-code *` calls and `enforce-team-first.sh`. `lisa apply` publishes only the base, detected-stack, and explicitly configured plugin entries in the repository `.agents/plugins/marketplace.json`; Codex loads those plugin-bundled hooks without user-wide plugin installation or duplicate project hook copies.
- **Cursor (`plugins/lisa-cursor/`)** — ships `block-no-verify.sh`, `install-pkgs.sh`, `setup-jira-cli.sh`, written to a standalone **`hooks/hooks.json`** in Cursor's schema (`{version:1, hooks:{<camelCaseEvent>:[{command:"${CURSOR_PLUGIN_ROOT}/hooks/<script>.sh", matcher?}]}}`; flat per-event arrays) — the manifest's `hooks` field is REMOVED. Commands use the `${CURSOR_PLUGIN_ROOT}` token (NOT a bare `./`): Cursor plugin hooks run with the opened project root as cwd, so a relative path would not resolve to the bundled script and could be shadowed by a repo-local `./hooks/*` (issue #1055). **STRIPS `inject-rules.sh`** entirely: rules are delivered as native Cursor `.mdc` files (issue #1055 — eager `rules/<name>.mdc` `alwaysApply:true`, reference `rules/<name>-reference.mdc` `alwaysApply:false`), which is the single rules-once path; Cursor does NOT auto-load the nested `.md` tree. Renames `.mcp.json` → `mcp.json`. Strips Claude-specific entire calls and enforce-team-first. Strips inject-flow-context (Cursor SubagentStart unverified — defer until research refresh). NOTE: plugin-bundled hook FIRING is not verifiable via the `cursor-agent` CLI (only project `.cursor/hooks.json` fires headless); the regression suite asserts file SHAPE.
- **agy (`plugins/lisa-agy/`)** — only `block-no-verify` is agy-portable (PreToolUse). `install-pkgs`/`setup-jira-cli` are SessionStart, which agy hooks don't support; `inject-rules`/`enforce-team-first`/`inject-flow-context`/the `entire` calls are stripped as on Cursor. Delivery: a PLUGIN-BUNDLED root `hooks.json` (agy schema, matcher `run_command`, command → `$HOME/.gemini/config/plugins/lisa-agy/hooks/block-no-verify.agy.sh`) emitted by `generate-agy-plugin-artifacts.mjs`, plus the agy-protocol script under the variant's `hooks/`. It rides along with `agy plugin install`. The generated `plugins/lisa-agy/` artifact ships the root `hooks.json` + `hooks/block-no-verify.agy.sh` but **no `mcp_config.json`, no `.mcp.json`, no `rules/`, no `hooks/hooks.json` subdir** — MCP goes through the runtime installer (`installAgyMcpConfig` → user-global `~/.gemini/config/mcp_config.json`). Rules: as of 2026-06-06 (PR #1150) agy gets no eager-rule injection — `AGENTS.md` is rule-free and the old bake is removed (was: "rules through the AGENTS.md bake"). Stack variants carry no manifest hooks, so they emit no `hooks.json`. _(ticket-1054: superseded both the original "ships no hooks" finding and the interim "subdir hooks"/"runtime installer" approaches — agy loads a ROOT-level plugin hooks.json.)_
- **Copilot (`plugins/lisa-copilot/`)** — ships `block-no-verify.sh`, `inject-rules.sh` (Copilot doesn't auto-load rules from plugin), `install-pkgs.sh`, `setup-jira-cli.sh`. Strips all SubagentStart hooks (Copilot doesn't have that event). Strips entire calls and enforce-team-first. The Copilot variant's `inject-rules.sh` may need its `${CLAUDE_PLUGIN_ROOT}` path reference adapted if Copilot exposes a different plugin-root env var name (e.g. `${COPILOT_PLUGIN_ROOT}` — unverified; Pattern B generator should probe and document).

## Open questions surfaced by the audit

Blocking for Wave 3:

1. **Cursor SubagentStart event** — the Cursor generator now emits explicit camelCase event keys (issue #1055), so `SubagentStart`→`subagentStart`; whether Cursor actually fires that event for plugin hooks is unverified (and plugin-hook firing is not CLI-verifiable at all — only project `.cursor/hooks.json` fires headless). The audit currently strips SubagentStart hooks from Cursor as a conservative default. Probe needed in a real Cursor IDE session.
2. **Copilot inject-rules.sh collision risk** — the audit ships `inject-rules.sh` to Copilot conservatively, but Copilot's plugin-level `instructions` source per generated RPC declarations may auto-load `rules/` content the same way Cursor does. If true, shipping the polyfill double-injects. Probe needed: install Lisa via `--plugin-dir` on Copilot, observe whether rules content lands in context twice.
3. **Copilot plugin-root env var name** — `${COPILOT_PLUGIN_ROOT}` is the natural guess but unverified. Generator MUST settle the question (probe or fall back to absolute paths) before Wave 3 emits Copilot hooks.

Deferred / non-blocking:

4. **agy `${CLAUDE_PLUGIN_ROOT}` env var** — _resolved (ticket-1054)._ Runtime probe: agy exposes **no plugin-root env var** (`${CLAUDE_PLUGIN_ROOT}` resolves empty). The plugin-bundled root `hooks.json` therefore references the installed script via a `$HOME`-absolute path (`$HOME/.gemini/config/plugins/<variant>/hooks/<script>`), which agy's ExpandEnv resolves.

## Wave 3 consumption

The Pattern B generator scripts (`scripts/generate-cursor-plugin-artifacts.mjs`, `scripts/generate-agy-plugin-artifacts.mjs`, `scripts/generate-copilot-plugin-artifacts.mjs`, plus the extension to `scripts/generate-codex-plugin-artifacts.mjs`) implement this audit by:

1. **Read** `plugins/src/base/.claude-plugin/plugin.json` (the source-of-truth hook block).
2. **Filter hook entries**: walk each `(event, matcher, command)` entry, look up the agent's column in the per-agent ship-list table above, and keep only "ship" entries.
3. **Filter scripts**: walk `plugins/src/base/hooks/*.sh`, exclude any `*debug*.sh` and any script flagged "unregistered" in the catalog (currently `ticket-sync-reminder.sh` and `track-plan-sessions.sh`), then keep only scripts referenced by surviving hook entries.
4. **Translate event names** per the agent's native casing:
   - Claude / Codex: PascalCase (`PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `SubagentStart`, `SubagentStop`).
   - Cursor: **emit camelCase explicitly** (issue #1055): `PreToolUse`→`preToolUse`, `PostToolUse`→`postToolUse`, `SessionStart`→`sessionStart`, `Stop`→`stop`, `UserPromptSubmit`→`beforeSubmitPrompt`, `SubagentStart`→`subagentStart`, `SubagentStop`→`subagentStop`, `SessionEnd`→`sessionEnd`. (The earlier "loader auto-normalizes PascalCase" assumption was false — the generator writes camelCase keys into `hooks/hooks.json`.)
   - Copilot: lowercased / camelCase per its own contract (`preToolUse`, `postToolUse`, `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `agentStop`, `subagentStop`, `errorOccurred`). Generator MUST rewrite event names.
5. **Translate matcher fields** when the source matcher uses a Claude-specific token:
   - `SessionStart` `matcher: "startup"` is a Claude convention (startup vs resume vs clear). Codex SessionStart `source` field carries the same {startup, resume, clear} signal but matcher application may differ; verify against Codex hooks docs.
   - Cursor / Copilot matcher semantics on session events are unverified. Conservative default: emit the matcher as-is and accept that a "startup-only" hook may fire on every SessionStart on the target agent until the matcher contract is empirically pinned.
6. **Rewrite plugin-root env var** in `command` strings AND in shipped script bodies per the target agent:
   - Claude: `${CLAUDE_PLUGIN_ROOT}`.
   - Cursor: `${CURSOR_PLUGIN_ROOT}/hooks/<script>.sh` in `hooks/hooks.json` (issue #1055). Plugin hooks run with the opened project root as cwd (Cursor-maintainer confirmed), so a bare `./hooks/` would not resolve and could be shadowed by a repo-local `./hooks/*`; `${CURSOR_PLUGIN_ROOT}` is the endorsed plugin-dir token (the generator normalizes `${CLAUDE_PLUGIN_ROOT}` → `${CURSOR_PLUGIN_ROOT}`).
   - Codex: plugin-bundled hook commands resolve through Codex's `PLUGIN_ROOT`. Hook scripts retain `${CLAUDE_PLUGIN_ROOT}` first for Claude compatibility and fall back to `${PLUGIN_ROOT}` for Codex.
   - agy: the plugin-bundled root `hooks.json` references the installed script via a `$HOME`-absolute path (`$HOME/.gemini/config/plugins/<variant>/hooks/<script>`); agy exposes no plugin-root env var, and ExpandEnv resolves `$HOME`.
   - Copilot: ⚠ env var name unverified. Community examples literally use `${CLAUDE_PLUGIN_ROOT}` for Antigravity-targeted hooks but Copilot's actual convention is undocumented. Wave 3 generator MUST probe Copilot's runtime env (`${COPILOT_PLUGIN_ROOT}` is the natural guess) before final emit; fall back to absolute paths if no env var is exposed.
7. **Emit** the agent-appropriate `hooks` block in the variant's manifest plus the surviving `hooks/` directory.

For agy the generator emits a PLUGIN-BUNDLED root `hooks.json` (agy schema; only `block-no-verify`/PreToolUse is portable, base variant only) + the agy-protocol script under `hooks/`, and drops `rules/`, `.mcp.json`, the stale `hooks/hooks.json` subdir, and the manifest's `hooks`/`mcpServers` fields. MCP is delivered separately by `installAgyMcpConfig` into the user-global `~/.gemini/config/mcp_config.json` (agy ignores plugin-bundled MCP). See `pattern-b-fan-out-spec.md`.

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
- **Discovery path (corrected again in #1058):** Codex resolves the manifest
  `hooks` pointer relative to the **plugin root** (same as the `skills`/
  `mcpServers` pointers). An early cut wrote `.codex-plugin/hooks.json` with a
  `./hooks.json` pointer that resolved to a non-existent `<root>/hooks.json`, so
  Codex never found it; the interim fix (Wave 3b, #1049) "corrected" this by
  writing `<plugin-root>/hooks/hooks.json` + pointer `./hooks/hooks.json`. That
  **broke Claude**: Lisa ships ONE plugin dir consumed by both runtimes, and
  `<plugin-root>/hooks/hooks.json` is exactly where Claude Code (and the cursor/
  copilot variants) auto-discover plugin hooks — Claude ran the Codex-shaped
  `${PLUGIN_ROOT}` file, where `${PLUGIN_ROOT}` is undefined, so the path
  expanded to an empty prefix (`/hooks/<n>.sh: No such file`) at startup.
  **Final fix (#1058):** the generator emits the Codex hooks.json to
  `.codex-plugin/hooks.json` (a dir Claude never scans) with the matching
  plugin-root-relative pointer `./.codex-plugin/hooks.json`, and purges any
  stale `<plugin-root>/hooks/hooks.json`. The hook *scripts* stay shared at
  `<plugin-root>/hooks/*.sh`; `${PLUGIN_ROOT}/hooks/<n>.sh` resolves to them
  regardless of where hooks.json itself lives.
- **Plugin-root env var (corrects step 6):** Codex exposes `${PLUGIN_ROOT}` to
  hook commands. The generator rewrites `${CLAUDE_PLUGIN_ROOT}/hooks/<n>.sh`
  → `${PLUGIN_ROOT}/hooks/<n>.sh` (not the cwd-relative `./hooks/` the first cut
  emitted, nor an absolute path).
- **hooks.json root shape:** events nest under a top-level `hooks` key
  (`{ "hooks": { … } }`) per the `HooksFile` contract in
  `src/codex/hooks-merger.ts`.
- **Marketplace delivery:** `lisa apply` writes a filtered repository catalog at
  `.agents/plugins/marketplace.json` and marks its selected entries
  `INSTALLED_BY_DEFAULT`. Current Codex loads the selected plugin components
  directly from the project dependency without a Lisa-managed user-wide plugin
  registration. Legacy Lisa-tagged project hooks are removed during apply.

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
- Copilot rejects the entire inline hook config if an unsupported `subagentStart`
  entry is present with an empty matcher. Issue `#1056` made the generator strip
  the unsupported event wholesale for Copilot so SessionStart rule injection can
  fire.
- Copilot does not auto-discover plugin-bundled `.mcp.json` files and does not
  honor a manifest path-string pointer. The Copilot generator now inlines a valid
  non-empty `mcpServers` object from `.mcp.json` and skips invalid shapes.

**`lisa apply --harness fleet` end-to-end (two dispatch bugs found + fixed):**

- `processCodexEmit` was missing `"fleet"` in its guard, so fleet installs
  silently skipped all Codex artifacts. Fixed; centralized in
  `harnessIncludesAgent(harness, agent)` so the four emit guards can't drift.
- agy's AGENTS.md bake read rules from the stripped `lisa-agy/rules/eager`
  (empty); it was fixed to bake the base plugin's `lisa/rules/eager` (13 rules).
  _(Historical: this whole bake mechanism was removed on 2026-06-06 — PR #1150.
  agy now emits the canonical, rule-free `AGENTS.md` and gets no eager-rule
  injection.)_
- Verified (at the time of this run, pre-2026-06-06): a fleet apply emits all
  four paths (Codex 55 agents / 5 hooks / 253 skills, Claude `CLAUDE.md`, agy 13
  rules baked, Copilot instructions), registers the plugin as `lisa@lisa`, and a
  single-agent harness emits only its own agent. No rule double-injection: cursor
  applies native `.mdc` rules once (eager `alwaysApply:true` / reference
  `alwaysApply:false`; no inject-rules hook — issue #1055 corrected the earlier
  "cursor auto-loads `rules/`" claim, which was false for the nested `.md` tree),
  copilot/codex/claude inject once via hooks, agy baked once. _(Post-2026-06-06:
  agy no longer bakes or injects eager rules at all — see PR #1150.)_

## OpenCode hook delivery (follow-up to PR #1197)

OpenCode does **not** consume the Pattern B per-agent filter above. Like Codex,
it uses a per-project overlay (`src/opencode/hooks-installer.ts`), so its hooks
are mapped to OpenCode-native surfaces first and to runtime plugins only where
genuine behavior is required. Verified-by-run on opencode 1.16.2 (free model,
`opencode run` headless):

| Lisa hook | OpenCode delivery |
| --- | --- |
| `block-no-verify` | `opencode.json` → `permission.bash` deny globs (`*--no-verify*`, `*HUSKY=0*`, `*HUSKY_SKIP_HOOKS=*`, `*core.hooksPath*/dev/null*`). Cheaper + more robust than a hook; OpenCode rejects matches before they run. |
| `format-on-edit` | OpenCode's **built-in prettier formatter** already formats on edit — Lisa emits no formatter config (overriding it would be worse than the default). |
| `inject-rules` | Not needed — rules ship via the canonical `AGENTS.md`, which OpenCode reads natively. |
| `install-pkgs`, `setup-jira-cli` | `.opencode/plugin/lisa-session-bootstrap.ts` (universal) — the plugin factory runs once at session start, the SessionStart equivalent. Fully fail-open. |
| `block-suppress-directives` (ts) | `.opencode/plugin/lisa-block-suppress-directives.ts` — `tool.execute.before` throws to block the edit/write. |
| `block-migration-edits` (nestjs) | `.opencode/plugin/lisa-block-migration-edits.ts` — `tool.execute.before` throws. |
| `lint-on-edit` (ts) | `.opencode/plugin/lisa-lint-on-edit.ts` — `tool.execute.after` runs ESLint `--fix`, throws on remaining problems. |
| `sg-scan-on-edit` (ts/rails) | `.opencode/plugin/lisa-sg-scan-on-edit.ts` — `tool.execute.after` runs `ast-grep scan`. |
| `rubocop-on-edit` (rails) | `.opencode/plugin/lisa-rubocop-on-edit.ts` — `tool.execute.after` runs RuboCop `-a`. |
| `enforce-team-first`, `inject-flow-context` | Not ported (Claude-team-specific / no equivalent), matching Codex. |

OpenCode exposes only `edit`/`write` filesystem tools (no `apply_patch`), so file
paths come straight from the tool args. Plugin templates live in
`src/opencode/plugin-templates/` (excluded from this repo's tsconfig/eslint — they
run under OpenCode's Bun runtime) and are copied verbatim into the host's
`.opencode/plugin/`, gated by detected project type exactly like the Codex hook
catalog. `opencode.json` is a shared merged root file (not tracked in the
`.opencode/`-relative manifest); plugin files are manifest-tracked for stale
cleanup. Note: OpenCode's first `opencode run` pays a Bun cold-start (~30s) to
transpile project plugins.
