# Pattern B Per-Agent Plugin Fan-Out Specification

Lisa generates per-agent plugin artifacts at build time from a single shared source under `plugins/src/`. The architectural decision is recorded in `wiki/decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md`. This document is the implementation contract Wave 3 generator scripts honor.

## Output shape

`bun run build:plugins` produces the following artifact tree:

```
plugins/
  lisa/                          # Claude variant — existing baseline
    .claude-plugin/
      plugin.json                # Claude manifest with full hooks block
    skills/
    agents/
    commands/
    rules/
    hooks/
    scripts/

  lisa-typescript/               # TypeScript stack add-on (Claude/Codex shape)
  lisa-expo/                     # ... per-stack add-ons — each ALSO fanned out
  lisa-nestjs/                   #     (see "Stack fan-out" below)
  lisa-cdk/
  lisa-rails/
  lisa-harper-fabric/
  lisa-wiki/
  lisa-openclaw/

  # NEW Pattern B per-agent variants:
  lisa-cursor/                   # Cursor variant
    .claude-plugin/
      plugin.json                # Claude-format manifest; `hooks` field REMOVED (relocated to hooks/hooks.json)
    skills/                      # passthrough from base
    agents/                      # passthrough from base
    commands/                    # passthrough — Cursor reads but may deprecate
    rules/                       # FLAT *.mdc (issue #1055): eager <name>.mdc (alwaysApply:true),
                                 #   reference <name>-reference.mdc (alwaysApply:false + description).
                                 #   Cursor does NOT auto-load nested rules/eager|reference/*.md.
    hooks/
      hooks.json                 # Cursor schema: {version:1,hooks:{<camelCaseEvent>:[{command,matcher}]}}
      *.sh                       # surviving scripts (inject-rules.sh STRIPPED — .mdc is the rules path)
    mcp.json                     # (MCP-defining variants only) renamed from .mcp.json — no leading dot
    scripts/

  lisa-agy/                      # Antigravity variant
    plugin.json                  # BARE manifest at root (not .claude-plugin/); no hooks/mcpServers fields
    hooks.json                   # ROOT-level, agy schema (base variant only) — agy loads plugin hooks from here
    hooks/
      block-no-verify.agy.sh     # agy-protocol script referenced by hooks.json ($HOME-absolute, run_command)
    skills/                      # passthrough
    agents/                      # passthrough (agy reads Claude-format .md)
    commands/                    # passthrough (agy auto-converts to skills)
    # NO mcp_config.json — agy ignores plugin-bundled MCP; delivered by the runtime MCP installer (user-global)
    # NO hooks/hooks.json subdir — agy loads the ROOT hooks.json, not a subdir one
    # NO .mcp.json — untranslated Claude file dropped (inert on agy)
    # NO rules/ — rules baked into AGENTS.md (rules-once invariant)
    scripts/

  lisa-copilot/                  # GitHub Copilot variant
    .claude-plugin/
      plugin.json                # Claude-format manifest (Copilot fallback lookup)
    skills/                      # passthrough
    agents/                      # passthrough but filenames may need .agent.md rename
    commands/                    # passthrough — E2E unverified
    rules/                       # passthrough or shipped via hooks (TBD per probe)
    hooks/                       # STRIPPED of SubagentStart hooks (event missing)
    scripts/
```

## Stack fan-out (2026-05-29 follow-up — supersedes "stacks unchanged")

The original spec fanned out only the BASE plugin, leaving cursor/agy/copilot
without the stack add-ons (lisa-typescript, lisa-expo, …) that Claude and Codex
receive. That was a real parity gap: agy and copilot cannot consume the
Claude-shaped stack plugins at all (agy needs a bare root manifest; copilot
needs `.agent.md` agents + camelCase hooks).

`build-plugins.sh` now runs the SAME per-agent generators over every built
Claude plugin (base + 6 stacks + 2 standalones), producing `<plugin>-<agent>`
variants (e.g. `lisa-typescript-cursor`, `lisa-rails-agy`, `lisa-expo-copilot`);
27 variant dirs total (3 base + 24). All are registered in
`.claude-plugin/marketplace.json`.

`lisa apply` selects per-agent stack variants by detected project type:
`processAgyEmit`/`processCopilotEmit` install the base variant plus
`lisa-<detected-type>-<agent>` for each detected stack that has a built variant
(existence-filtered, so `npm-package` — which has no plugin — is skipped).
Cursor needs no installer: its stack variants are published for native
`.claude-plugin` consumption.

Verified by run: a TypeScript project installs `lisa-typescript-{agy,copilot}`
alongside the base; a Rails project installs `lisa-rails-{agy,copilot}`. Per-stack
double-injection is prevented exactly as for the base — e.g. `lisa-rails-cursor`
strips `inject-rules.sh` (rules ship as native `.mdc`; issue #1055) while
`lisa-rails-copilot` keeps it (copilot does not auto-load plugin `rules/`).

### Rule delivery across agents

Lisa splits rules into `rules/eager/` (always injected at session start) and
`rules/reference/` (loaded on demand — an eager breadcrumb points to them; NOT
injected on any agent). Some stacks use a legacy FLAT layout
(`rules/<name>.md`, e.g. `lisa-rails/rules/rails-conventions.md`, no `eager/`
subdir). The canonical resolution is **prefer `rules/eager/`, else fall back to
flat `rules/`** — used by `inject-rules.sh` (Claude/Codex/Copilot) and, since
PR #1052, by agy's AGENTS.md bake (`eagerRuleDirs` in `src/core/lisa.ts`).

**Cursor (corrected, issue #1055): Cursor does NOT read the nested `rules/` tree
natively.** Cursor's native rule loader only applies `.mdc` files (with YAML
frontmatter) discovered under `rules/`; it ignores plain `.md` files in
`rules/eager/` and `rules/reference/`. The earlier claim that "Cursor auto-loads
the whole `rules/` tree natively" was empirically false — a probe with the old
layout returned UNKNOWN (rule not applied), identical to shipping no rule at all
(see `evidence/cursor-rule-probe-1055.md`). The Cursor generator therefore
TRANSFORMS rules into Cursor's native shape: each eager rule →
`rules/<name>.mdc` with frontmatter `alwaysApply: true`; each reference rule →
`rules/<name>-reference.mdc` with `alwaysApply: false` + a `description`
(on-demand). Bodies' `../reference/<name>.md` cross-links are rewritten to the
`<name>-reference.mdc` twin. This flat suffix scheme avoids the same-name
collision (all 13 eager basenames also exist under `rules/reference/`).
`inject-rules.sh` stays stripped on Cursor: the native `.mdc` files are the single
delivery path (rules-once invariant), not a double-inject collision as previously
documented.

Net result: **every agent gets eager + flat-layout rules; only
`rules/reference/` content is on-demand.** On Claude/Codex/Copilot via
`inject-rules.sh`; on agy via the AGENTS.md bake; on Cursor via native `.mdc`
files (eager `alwaysApply:true`, reference `alwaysApply:false`). (Before #1052,
agy's bake read only `rules/eager/` with no flat fallback, so it silently dropped
flat-layout stack rules like rails-conventions — an agy-only gap, now fixed.)

The Codex variant intentionally reuses `plugins/lisa/` since Codex reads Claude-format manifests via its own `.codex-plugin/plugin.json` pointer file co-located in the same directory. No separate `plugins/lisa-codex/` is generated; the existing dual-pointer pattern (`.claude-plugin/plugin.json` for Claude + `.codex-plugin/plugin.json` for Codex) continues to work and is extended by `scripts/generate-codex-plugin-artifacts.mjs` to emit the migrated hooks block per the Wave 1 audit (see `wiki/architecture/lisa-hook-per-agent-ship-list.md`).

## Generator scripts

Three new scripts under `scripts/`:

- `scripts/generate-cursor-plugin-artifacts.mjs`
- `scripts/generate-agy-plugin-artifacts.mjs`
- `scripts/generate-copilot-plugin-artifacts.mjs`

Each generator follows the same shape:

### Input

- `plugins/lisa/` — the built Claude artifact (the existing baseline `bash scripts/build-plugins.sh` produces).
- `plugins/src/base/.claude-plugin/plugin.json` — the source-of-truth manifest hooks block (the script does NOT re-read this; it reads `plugins/lisa/.claude-plugin/plugin.json` which `build-plugins.sh` already populated, ensuring the generators run AFTER the base build).
- `wiki/architecture/lisa-hook-per-agent-ship-list.md` — the audit document used as a reference for human reviewers; the script does NOT parse this at runtime, but the script's filter logic encodes the same rules.
- `scripts/internal-<agent>-skill-policy.json` (NEW per-agent, analogous to the existing `scripts/internal-codex-skill-policy.json`) — denylist of Lisa-internal skills that should not ship to the variant.

### Transformation (the 10-step Wave 3 contract — extends the 7-step contract from the hook audit with skill-policy, manifest-reshape, and marketplace fix steps)

0. **Skill policy filter**: filter `skills/` against `scripts/internal-<agent>-skill-policy.json` (one file per variant, paralleling the existing `scripts/internal-codex-skill-policy.json`). Skills on the per-agent denylist are excluded before copy. The policy file may be empty/absent for variants that have no internal-only skills; the generator handles missing-policy as "ship all skills."
1. **Copy** the filtered `plugins/lisa/` (post step 0) to `plugins/lisa-<agent>/` as the starting point.
2. **Manifest reshape**:
   - Cursor: keep `.claude-plugin/plugin.json` (Cursor's CLI reads it), but **remove the `hooks` field from the manifest** — Cursor hooks are relocated to a standalone `hooks/hooks.json` (step 3). Also (issue #1055) **transform rules** (each `rules/eager/<name>.md` → flat `rules/<name>.mdc` with `alwaysApply: true`; each `rules/reference/<name>.md` → `rules/<name>-reference.mdc` with `alwaysApply: false` + `description`; rewrite body cross-links to the `<name>-reference.mdc` twin; drop the now-empty `rules/eager` and `rules/reference` subdirs) and **rename `.mcp.json` → `mcp.json`** (Cursor reads the no-dot filename).
   - agy: move `.claude-plugin/plugin.json` → bare `plugin.json` at the artifact root. Remove `.claude-plugin/` directory. Drop both the `hooks` and `mcpServers` fields from the manifest — agy ignores plugin-bundled hooks/MCP, so they are delivered by runtime installers (not as plugin components).
   - Copilot: keep `.claude-plugin/plugin.json` (Copilot's fallback lookup reads it). Optionally also emit `plugin.json` at the root so Copilot's primary lookup finds it without the fallback.
3. **Hook filter** (per the per-agent ship-list table in the audit):
   - Cursor: drop `inject-rules.sh` and its `SessionStart`/`SubagentStart` entries (rules ship as native `.mdc`, step 2). Drop `enforce-team-first.sh` and `entire hooks claude-code *` entries. Write the surviving hooks to a standalone **`hooks/hooks.json`** in Cursor's schema — `{ "version": 1, "hooks": { "<camelCaseEvent>": [ { "command": "${CURSOR_PLUGIN_ROOT}/hooks/<script>.sh", "matcher"?: "..." } ] } }` — a FLAT array of `{command,matcher}` per event (NOT Claude's nested `[{matcher,hooks:[{type,command}]}]`), and delete the manifest `hooks` field. NOTE: plugin-bundled hook FIRING is not verifiable via the `cursor-agent` CLI (only project-level `.cursor/hooks.json` fires headless) — the contract is the file SHAPE.
   - agy: the generator emits a PLUGIN-BUNDLED root `hooks.json` (agy schema; matcher `run_command`; base variant only) and ships the agy-protocol script under `hooks/`. Only `block-no-verify` (PreToolUse) is portable — agy doesn't support SessionStart, so `install-pkgs.sh`/`setup-jira-cli.sh` can't ship as agy hooks; `notify-ntfy.sh` was retired in ticket-1054. The command points at `$HOME/.gemini/config/plugins/<variant>/hooks/<script>` (the installed location). See step 5 / `emitAgyPluginHooks`.
   - Copilot: drop `inject-flow-context.sh` and `enforce-team-first.sh` SubagentStart entries (event missing on Copilot), and drop the unsupported `subagentStart` event wholesale so Copilot does not reject the entire inline hook config. Drop `enforce-team-first.sh` entries on all events. Drop `entire hooks claude-code *` entries. Keep the SessionStart `inject-rules.sh` entry because the Copilot probe showed plugin `rules/` are not auto-loaded.
4. **Script filter** in `hooks/`:
   - Always exclude `*debug*.sh` (development-only).
   - Always exclude unregistered scripts (`ticket-sync-reminder.sh`, `track-plan-sessions.sh` per the audit — pending classification).
   - Drop scripts that no surviving manifest entry references.
5. **Event-name translation**:
   - Cursor: **rewrite to Cursor's camelCase** (issue #1055) — `PreToolUse`→`preToolUse`, `PostToolUse`→`postToolUse`, `SessionStart`→`sessionStart`, `Stop`→`stop`, `UserPromptSubmit`→`beforeSubmitPrompt`, `SubagentStart`→`subagentStart`, `SubagentStop`→`subagentStop`, `SessionEnd`→`sessionEnd`. (The earlier "Cursor auto-normalizes PascalCase" claim was false — emit camelCase explicitly.)
   - Codex: keep Claude PascalCase (Codex uses PascalCase natively).
   - Copilot: rewrite manifest hook event names to Copilot's camelCase (`preToolUse`, `postToolUse`, `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `agentStop`).
   - agy: the root `hooks.json` keeps Claude/agy PascalCase event names (PreToolUse), emitted directly by the generator's `AGY_PLUGIN_HOOKS` map.
6. **Plugin-root env var rewriting**:
   - Claude: keep `${CLAUDE_PLUGIN_ROOT}`.
   - Cursor: **use the `${CURSOR_PLUGIN_ROOT}` token** in `hooks/hooks.json` commands — `${CURSOR_PLUGIN_ROOT}/hooks/<script>.sh` (issue #1055). Cursor plugin hooks execute with the OPENED PROJECT ROOT as cwd (not the plugin dir; confirmed by a Cursor maintainer), so a bare `./hooks/` would fail to resolve to the bundled script and could be shadowed by a repo-local `./hooks/*`. `${CURSOR_PLUGIN_ROOT}` is the maintainer-endorsed plugin-dir placeholder (`${CLAUDE_PLUGIN_ROOT}` also works in Cursor; the generator normalizes to the Cursor-native name).
   - Codex: not handled here — Codex hooks ship via the Codex-specific generator (`generate-codex-plugin-artifacts.mjs`) which writes absolute paths or uses the Codex per-project hooks installer fallback.
   - Copilot: keep `${CLAUDE_PLUGIN_ROOT}` in hook commands. Copilot aliases the Claude plugin-root environment variables, and the 2026-05-29 issue `#1056` probe verified that `${CLAUDE_PLUGIN_ROOT}` resolves for Copilot SessionStart hooks.
   - agy: agy exposes no plugin-root env var (`${CLAUDE_PLUGIN_ROOT}` resolves empty — verified ticket-1054), so the root `hooks.json` command uses a `$HOME`-absolute path (`$HOME/.gemini/config/plugins/<variant>/hooks/<script>`), which agy's ExpandEnv resolves.
7. **Agent file rename for Copilot only**:
   - Copilot expects `agents/<n>.agent.md` filenames. Either rename `agents/<n>.md` → `agents/<n>.agent.md` OR override via manifest `agents: "agents/"` field. The generator's first implementation tries the manifest override; if Copilot rejects (probed at generator time), fall back to filename rename.
7.a. **Copilot MCP manifest inline**:
   - Copilot does not auto-discover a plugin-bundled `.mcp.json` file and does not honor a `".mcp.json"` path-string pointer in the manifest. The generator reads a source `.mcp.json`, validates that `mcpServers` is a non-array object with at least one key, and emits that object inline as manifest `mcpServers`. Invalid, empty, array, or string shapes are skipped with a warning rather than producing a broken manifest.
8. **Marketplace.json fix for Copilot install path bug**:
   - **Bug observed by run** (2026-05-28): Lisa's `.claude-plugin/marketplace.json` has `metadata.pluginRoot: "./plugins"` AND each plugin's `source: "./plugins/lisa"`. Copilot concatenates them, producing `plugins/plugins/lisa` which doesn't exist. `copilot plugin install lisa@CodySwannGT/lisa` fails with `Plugin source directory not found: ...marketplaces/CodySwannGT-lisa/plugins/plugins/lisa`.
   - **Proposed fix shape**: change each plugin's `source` field to just the directory name (`lisa`, `lisa-cursor`, etc.) and rely on `pluginRoot` for the `./plugins/` prefix. This is the documented Copilot marketplace shape.
   - **Empirical-verification step (REQUIRED before changing the live `marketplace.json`)**: Wave 3 implementer creates a sibling test marketplace at `tests/fixtures/marketplace-shape-probe/.claude-plugin/marketplace.json` using the proposed shape (bare-name source + pluginRoot). Adds the test marketplace via `claude /plugin marketplace add <local-path>` (or equivalent) and confirms Claude installs from it successfully. Repeats for Cursor via Cursor's marketplace registration RPC if Cursor's loader behavior differs. Only after Claude AND Cursor install succeed against the proposed shape is the live `.claude-plugin/marketplace.json` modified.
   - **Rollback criteria**: if either Claude OR Cursor fails to install from the proposed shape, revert to the current shape and use a Copilot-specific marketplace file at `.github/plugin/marketplace.json` (which Copilot also reads per its manifest-lookup fallback chain) carrying the Copilot-shape entries while `.claude-plugin/marketplace.json` retains the current shape for Claude and Cursor.
9. **Marketplace.json multi-variant listing**:
   - Add entries for `lisa-cursor`, `lisa-agy`, `lisa-copilot` to `.claude-plugin/marketplace.json` alongside the existing `lisa`, `lisa-typescript`, etc. Each entry's `source` field points at the corresponding variant directory using whichever shape step 8 settled on.
   - **No `lisa-codex` marketplace entry is added.** The Codex variant is served by the existing `lisa` entry (Codex reads `.codex-plugin/plugin.json` from `plugins/lisa/` directly). Adding a redundant `lisa-codex` entry would confuse users.

### Output

- `plugins/lisa-<agent>/` directory with the variant's manifest, components, and (where applicable) hooks.
- A short build log printed to stdout listing what was kept and stripped per variant.

## Pre-flight probes the generators must run

The generators are deterministic transformations driven by static rules from the hook audit, but a few decisions depend on runtime agent behavior that the research artifact flagged as `⚠ unverified`. The first execution of each generator probes the target agent (where the agent is installed locally) and caches the result in `scripts/internal-<agent>-runtime-probe.json` so subsequent builds reuse the answer.

### Probes

- **8.a Copilot plugin-root env var**: install a probe plugin with a SessionStart hook that emits `env | grep PLUGIN` to a known file. Run `copilot -p` and read the file. Record the env var name (`${COPILOT_PLUGIN_ROOT}` likely; fall back to absolute paths).
- **8.b Copilot rules auto-load test**: install a probe plugin with `rules/probe.md` and observe whether `copilot` references the content unprompted in a session. If yes, the Copilot variant strips `inject-rules.sh` (per the collision rule added to step 3). If no, the variant ships `inject-rules.sh` as the audit currently specifies.
- **8.c Copilot agent-file extension acceptance**: install a probe plugin with manifest `agents: "agents/"` and bare `agents/<n>.md` files. Run `copilot` and observe whether the agent loads. If not, the generator falls back to `.agent.md` rename.
- **8.d Cursor SubagentStart event**: install a probe plugin with a `SubagentStart` hook and trigger a sub-agent invocation. Observe whether the hook fires. If yes, the Cursor variant ships SubagentStart hooks.

### Probe cache invalidation

The cached probe results in `scripts/internal-<agent>-runtime-probe.json` are invalidated by any of:

- A change in the target CLI version recorded in `scripts/internal-<agent>-cli-versions.json` (the generator records the probed CLI version alongside each probe result; if the CLI is upgraded the cached result is invalidated).
- An explicit `bun run build:plugins -- --force-probes` flag (Wave 3 generator argument).
- The probe cache file itself is missing or unreadable.

### CI behavior

CI environments typically do NOT have all five agent CLIs installed. The generators MUST NOT fail when an agent CLI is unavailable. Rules:

- If the target agent's CLI is not on `$PATH`, the probe records `unverified` in the cache and the generator falls through to the conservative defaults documented in the per-agent ship-list audit.
- The probe cache file `scripts/internal-<agent>-runtime-probe.json` IS committed to git so that one developer's probe results are reused by CI and by other contributors. The probe is empirical at the source level (a contributor with the CLI installed runs it); CI consumes the cached result.
- If a contributor's local probe results conflict with the committed cache (e.g. the contributor's CLI is newer and exposes a different env var), the generator emits a warning, uses the local result for the local build, and prompts the contributor to commit the updated cache file.

When an agent is not installed on the build host AND the cached probe result is `unverified`, the generator uses the conservative default from the audit. The variant build still succeeds — the conservative default is always a valid (if possibly suboptimal) outcome.

## Per-agent installer surface (Wave 3 source files Lisa authors)

The generators above produce plugin payloads. Per-project installers handle the non-payload parts (settings, MCP outside plugins, memory file templates, fallback paths). Each per-agent installer lives under `src/<agent>/` with one paragraph contract:

### `src/cursor/` (NEW directory)

No installers required. Cursor consumes `plugins/lisa-cursor/` (reading its `.claude-plugin/plugin.json` manifest, native `rules/*.mdc`, and `hooks/hooks.json`) at install time and via `--plugin-dir` for session-only use. Lisa's `lisa apply` detects `cursor-agent` in `$PATH` and emits a documentation note pointing the user at marketplace install. No per-project file writes.

### `src/agy/` (NEW directory)

Three runtime installers (+ build-time plugin-bundled hooks, below):

- `src/agy/plugin-installer.ts` — detects `agy` in `$PATH` during `lisa apply`. Runs `agy plugin install $(lisa --path)/plugins/lisa-agy`. Public exports: `installAgyPlugin(destDir, lisaPluginRoot)`. Idempotent — re-running is a no-op once installed. No tagged-merge required.
- `src/agy/mcp-installer.ts` — writes the user-global `~/.gemini/config/mcp_config.json` with Lisa's MCP servers translated from Claude's `{type:"http",url}` shape to agy's `{serverUrl,headers}` shape. Tagged-merge marker `_lisaManaged: true` per server entry; host-authored entries (without the marker) are preserved. Public exports: `installAgyMcpConfig(lisaMcpServers, targetPath)`, `resolveAgyMcpConfigPath`, `collectLisaMcpServers(pluginRoot, detectedTypes)`, `translateMcpEntryToAgy`. **As of ticket-1054 this is the PRIMARY (and only) agy MCP delivery path** — a runtime probe proved agy ignores plugin-bundled MCP AND only reads the user-global file (the project-scope `.agents/mcp_config.json` is never read). `processAgyEmit` calls `collectLisaMcpServers` (reads the built plugin `.mcp.json` files for base + detected stacks, shallow-merged) then `installAgyMcpConfig` into the user-global path. Cross-project caveat: last `lisa apply` carrying MCP wins globally; tagged-merge preserves host entries. Translation lives solely in this installer now — the interim `scripts/lib/agy-mcp-translate.mjs` build helper + its parity test were deleted (their only consumer was the removed generator emission).
- agy hooks: NO runtime installer. Hooks ship as a PLUGIN-BUNDLED root `hooks.json` emitted at build time by `scripts/generate-agy-plugin-artifacts.mjs` (`emitAgyPluginHooks` + the `AGY_PLUGIN_HOOKS` map) and ride along with `agy plugin install`. agy loads a plugin's hooks from the installed plugin ROOT (`~/.gemini/config/plugins/<variant>/hooks.json`); the command references the `$HOME`-absolute agy-protocol script (`hooks/block-no-verify.agy.sh`). Only `block-no-verify` (PreToolUse) is portable — agy lacks SessionStart. The agy-protocol script source lives at `plugins/src/base/hooks/block-no-verify.agy.sh` (agy stdin/stdout decision protocol; distinct from the Claude `block-no-verify.sh`). Interactive-only firing (never `agy -p`).
- `src/agy/rules-bake.ts` — extends the existing `src/codex/agents-md-installer.ts` (or wraps it) to concatenate `plugins/src/base/rules/eager/*.md` content into the AGENTS.md template Lisa writes at the host project root when `agy` is the active runtime. This is the Bake polyfill replacing the hook-based rules injection (per Cluster 4-agy / Option α). Public exports: `bakeAgyRulesIntoAgentsMd(destDir, lisaRulesDir)`.

### `src/copilot/` (NEW directory)

Two installers + possible third:

- `src/copilot/plugin-installer.ts` — detects `copilot` in `$PATH` during `lisa apply`. Runs `copilot plugin install lisa@CodySwannGT/lisa` (only if the marketplace install bug is fixed — see Wave 3 step 8 above). Falls back to a documentation note instructing the user to run the install manually if policy gates block automatic install. Public exports: `installCopilotPlugin(destDir, marketplaceRef)`.
- `src/copilot/agent-installer.ts` — only required if the manifest `agents` path override (Wave 3 step 7 first attempt) does NOT work. Then this installer copies sub-agents from `plugins/lisa-copilot/agents/<n>.md` to per-project `agents/<n>.agent.md` with the Copilot-required `.agent.md` extension. Public exports: `installCopilotAgents(destDir, lisaAgentsDir)`. Idempotent.
- `src/copilot/rules-installer.ts` (CONDITIONAL — depends on Copilot rules auto-load probe) — if Copilot does NOT auto-load `rules/` from plugins, then the variant's `inject-rules.sh` SessionStart hook handles it (already in the plugin payload, no extra installer). If Copilot DOES auto-load (probe positive), this installer is not needed AND the plugin variant strips `inject-rules.sh`.

### `src/claude/` (NEW directory)

Two installers:

- `src/claude/claude-md-installer.ts` — analogous to `src/codex/agents-md-installer.ts`. Writes a create-only `CLAUDE.md` template at the host project root advertising Lisa governance. Public exports: `installClaudeMd(destDir)`. Create-only semantics.
- `src/claude/settings-installer.ts` — only required if Lisa needs to populate `.claude/settings.json` with permissions, allowlists, or `enabledPlugins` entries that the user wouldn't get from the marketplace install alone. Investigation needed in Wave 3 to confirm whether Lisa currently writes anything to `.claude/settings.json` and what's required. Tagged-merge per `_lisaManaged` markers, preserving host keys.

### `src/codex/` (EXISTING — Wave 3 changes)

Extend the existing Codex installers per the decisions made in Wave 2:

- `scripts/generate-codex-plugin-artifacts.mjs` — extended in THREE ways:
  1. **Emit hooks block**: derive a `hooks` block in `.codex-plugin/plugin.json` from the Claude `plugin.json` hooks per the per-agent ship-list audit's Codex column (`block-no-verify.sh`, `inject-rules.sh`, `inject-flow-context.sh`, `install-pkgs.sh`, `setup-jira-cli.sh`). Apply the absolute-path translation that `src/codex/hooks-installer.ts` already implements — import the translation helper from `src/codex/hooks-installer.ts` rather than duplicating it.
  2. **Migrate skills surface** (per `wiki/decisions/2026-05-28-codex-skills-canonical-path.md`): the generator now copies `plugins/lisa/skills/<n>/` into the published plugin artifact AND applies the commands-to-skills transformation by importing `src/codex/command-skill-transformer.ts`. The same `lisa-<cmd>` prefix convention is preserved. The plugin manifest's `skills: "./skills/"` pointer continues to point at this directory.
  3. **Respect the Codex skill policy denylist** at `scripts/internal-codex-skill-policy.json` during the copy step (same denylist behavior `src/codex/skills-installer.ts` honors today).
- `src/codex/hooks-installer.ts` — marked deprecated as primary path. Kept as fallback for users who have NOT installed Lisa as a Codex plugin via marketplace. The fallback detection lives inside `hooks-installer.ts` (early return when `~/.codex/config.toml` contains `[plugins."lisa@CodySwannGT-lisa"]` enabled). Its absolute-path translation helper is exported for the generator to reuse.
- `src/codex/skills-installer.ts` — marked deprecated as primary path per `wiki/decisions/2026-05-28-codex-skills-canonical-path.md`. Kept as fallback for users who have NOT installed Lisa as a Codex plugin. Same early-return detection pattern as `hooks-installer.ts`.
- `src/codex/command-skill-transformer.ts` — stays in place. Imported by BOTH `scripts/generate-codex-plugin-artifacts.mjs` (primary) and `src/codex/skills-installer.ts` (fallback). Single source of transformation logic.
- `src/codex/agents-md-installer.ts` — unchanged in primary behavior (AGENTS.md is not a plugin component on Codex). Possibly factored to share logic with new `src/claude/claude-md-installer.ts`.

## Marketplace listing changes

`.claude-plugin/marketplace.json` extensions:

1. Fix the `pluginRoot` / `source` doubling bug for Copilot install.
2. Add per-agent variant entries:
   - `lisa-cursor` → `./lisa-cursor` (or with pluginRoot prefix per fix-1).
   - `lisa-agy` → `./lisa-agy`.
   - `lisa-copilot` → `./lisa-copilot`.
3. Mark the existing `lisa` entry as the default install for unknown / unspecified runtimes.

Documentation in `wiki/documentation/` will describe which marketplace entry to install per runtime.

## Test plan template (consumed by Wave 3 verification)

Per-variant verification probes:

| Variant | Probe |
| --- | --- |
| `lisa-cursor/` | `cursor-agent -p --plugin-dir plugins/lisa-cursor "list Lisa skills"` returns the full skill set. RULES (issue #1055): `cursor-agent --plugin-dir plugins/lisa-cursor --force -p "<quote an eager rule's codeword>"` returns the rule content (eager `.mdc` applied) — the old nested `.md` layout returned UNKNOWN (see `evidence/cursor-rule-probe-1055.md`). FILE-SHAPE regression is locked by `tests/unit/scripts/generate-cursor-plugin-artifacts*.test.ts`: 26 flat `rules/*.mdc` (13 eager `alwaysApply:true` + 13 `-reference.mdc` `alwaysApply:false`), `hooks/hooks.json` (camelCase, flat `{command,matcher}`), no manifest `hooks`, `mcp.json` on MCP variants. HOOK FIRING is NOT CLI-verifiable for plugin-bundled hooks (only project `.cursor/hooks.json` fires headless) — shape only. |
| `lisa-agy/` | `agy plugin validate plugins/lisa-agy` returns [ok] for skills, agents, commands. `agy plugin install plugins/lisa-agy && agy plugin list` shows the install. `agy -p "what skills are available"` lists the Lisa skills. The base artifact ships a ROOT `hooks.json` (agy schema, `run_command`, `block-no-verify` only) + `hooks/block-no-verify.agy.sh`; stack variants ship none. NO `mcp_config.json`, NO `.mcp.json`, NO `rules/`, NO `hooks/hooks.json` subdir. Out-of-band: the user-global `~/.gemini/config/mcp_config.json` carries Lisa's MCP servers (`serverUrl` shape); AGENTS.md in a test project contains baked rules content. (Hook firing pending real-IDE confirmation — headless quota-blocked.) |
| `lisa-copilot/` | `copilot -p --plugin-dir plugins/lisa-copilot "list Lisa skills and agents"` returns the full set (agents prefixed `lisa:`). After marketplace fix: `copilot plugin install lisa-copilot@CodySwannGT/lisa` succeeds. |
| Codex hooks migration | `codex plugin marketplace add CodySwannGT/lisa && codex plugin install lisa@CodySwannGT-lisa` succeeds. `codex` interactive session in a project that does NOT have `lisa apply` run: Lisa skills work and the SessionStart hook fires (inject-rules content visible in context). |
