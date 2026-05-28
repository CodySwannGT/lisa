---
name: lisa-coding-agent-parity
description: This skill should be used when Lisa needs to research feature parity across the coding agents it can install into — Claude Code, Codex, Cursor (cursor-agent), Antigravity (agy), and GitHub Copilot. It produces a four-part research artifact (universal feature catalog, support matrix, plugin-distributability matrix, polyfill designs for the gaps) drawn from both web/documentation research and direct CLI queries. RESEARCH ONLY — implementation lives in the sibling skill `lisa-coding-agent-parity-implement`, which consumes this artifact. Use whenever the agent fleet changes (new CLI added, existing CLI ships a capability), when Lisa needs an updated picture of where parity stands, or before opening any implementation work that touches multiple agents.
allowed-tools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "WebSearch", "WebFetch"]
---

# Lisa ↔ Coding-Agent Parity (RESEARCH)

Lisa is distributed for **multiple coding agents**: Claude Code is the
production path, with Codex, Cursor (`cursor-agent`), Antigravity (`agy`),
and GitHub Copilot (`copilot`) as additional install targets. When any agent
ships a new capability, or when a Lisa feature exists for one agent ahead of
the others, the picture of "what's portable, what isn't, where Lisa
polyfills, what's deliberately agent-only" drifts. This skill is the
repeatable research protocol for refreshing that picture.

**This skill is research-only.** Its output is a four-part artifact — a
universal feature catalog, a support matrix, a plugin-distributability
matrix, and per-cell Lisa polyfill designs. **It does not write installer
code, build per-agent plugin variants, or modify Lisa's source tree.**
Implementation work is the sibling skill
[[lisa-coding-agent-parity-implement]], which consumes this artifact as
its primary input.

The transport for querying agents non-interactively — adapter slots,
dry-run, write guards, parallel dispatch — lives in
[[harness-parity-council]] (`.agents/skills/harness-parity-council/`). Use
that skill whenever this protocol says "query the agents." Web research
uses WebSearch + WebFetch.

## Core principle: empirical, not documentary

**Do not trust documentation OR assumptions alone.** Both lie. Examples
from the canonical run that produced this skill:

- Codex's [[reference-codex-hooks-capabilities]] memory said plugin-bundled
  hooks silently don't run; Codex 0.125.0 actually supports plugin hooks
  for ten events including `SubagentStart`, `SubagentStop`, and
  `PostCompact`. The memory was stale.
- agy's `agy plugin --help` advertises `agy plugin import claude` as an
  import source; at runtime that command returns "No claude extensions
  found" and never imports any of the registered Claude marketplace
  plugins. Docs implied feasibility; runtime falsified it.
- agy's plugin validator accepts the full Claude 7-event `hooks.json`
  schema and `agy plugin install` correctly writes the file into the
  installed plugin tree; **none of the registered hooks fire during a real
  `agy -p` session.** Validator and runtime are separate code paths.

Every claim in the four-part artifact must be backed by one of:

1. **Documentation read** — a publicly-published official doc, GitHub
   issue, or canonical community example. Tag `[VERIFIED-DOC]` with the
   URL.
2. **Source-read** — inspecting the installed binary, its `--help`,
   config home, vendored source, or generated schemas. Tag `[VERIFIED]`.
3. **Runtime capture** — running a real CLI invocation and observing
   actual behavior (capture hook stdin, install a probe plugin, observe
   what loads). Tag `[VERIFIED-BY-RUN]` with the command and a short
   observed-output snippet.

Treat `[UNKNOWN]` and `[VERIFIED-DOC]`-only claims as preliminary — they
should be upgraded to `[VERIFIED-BY-RUN]` before they're load-bearing for
a polyfill design in Step 4.

## The coding agents in scope

The skill scopes to whatever five agents Lisa currently distributes to. As
of this skill's last revision: Claude Code, Codex, Cursor (`cursor-agent`),
Antigravity (`agy`), GitHub Copilot. **No agent is the baseline.**
Capabilities flow in any direction — Codex may have a hook event Claude
lacks; agy may have a first-class plugin manager Codex lacks; Cursor may
have a Tab-specific hook event nobody else has. Every such asymmetry is a
first-class row in the catalog.

Claude remains the lead **orchestrator** (per
[[harness-parity-council]]) — it drives the research and writes the final
synthesis — but Claude is not the reference implementation. No agent's
claim about its own internals is overridden without an empirical
counter-example, regardless of which agent makes the claim.

| Agent           | CLI            | Config home                                     | Distribution today                                                   |
| --------------- | -------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| Claude Code     | `claude`       | `~/.claude/`                                    | GitHub marketplace (`CodySwannGT/lisa`)                              |
| Codex           | `codex`        | `~/.codex/`                                     | `lisa apply` + `.agents/plugins/marketplace.json`                    |
| Cursor          | `cursor-agent` | `~/.cursor/`, shares `~/.claude/plugins/`       | Cursor reads `.claude-plugin/` natively                              |
| Antigravity     | `agy`          | `~/.gemini/config/`, `~/.gemini/antigravity-cli/` | `agy plugin install <local-path>` against an agy-shaped variant      |
| GitHub Copilot  | `copilot`      | `~/.copilot/`                                   | `copilot plugin install lisa@CodySwannGT/lisa` (registered already)  |

When the fleet changes (new CLI added, existing CLI dropped), update this
table as the first action of a research pass.

## Prerequisites

- All five CLIs installed and authed on this machine. `claude` and `codex`
  are the historical baseline; `cursor-agent`, `agy`, and `copilot` were
  added on the `coding-agent-parity` worktree.
- `harness-parity-council` available under `.agents/skills/` — run
  `node .agents/skills/harness-parity-council/runtime-adapters.mjs` to
  confirm resolved command slots, base flags, and help/version probes
  before starting.
- Each CLI's non-interactive entry point understood:
  `claude -p` / `codex exec` / `cursor-agent -p` / `agy -p` /
  `copilot -p`. Resume flags: `--continue` / `resume --last` /
  `--connect` / `--resume` / `-c`.
- Filesystem access is available so probes can install throwaway plugins
  under isolated config homes (`CODEX_HOME`, etc.) and observe behavior.

### CLI invocation matrix (model + effort)

When this skill drives a CLI to investigate or empirically verify
behavior, use the model and reasoning-effort settings below. Do not pick
a smaller model or a lower effort silently — research verdicts depend on
the other side reasoning carefully about its own internals.

| CLI       | Model            | Effort / Thinking         | Invocation                                                                                       |
| --------- | ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `claude`  | Opus 4.7         | high                      | `claude --model opus --effort high`                                                              |
| `codex`   | GPT-5.5          | medium                    | `codex -m gpt-5.5 -c model_reasoning_effort=medium`                                              |
| `copilot` | GPT-5.5          | medium                    | `copilot --model gpt-5.5 --effort medium`                                                        |
| `cursor`  | Composer 2.5     | n/a (no thinking variant) | `cursor-agent --model composer-2.5`                                                              |
| `agy`     | Gemini 3.5 Flash | medium                    | set in-app via Model Selection (no CLI flag — `agy` exposes no model/effort flags as of v1.0.3) |

Notes:

- **`agy`** exposes no `--model`/effort flag. Set Gemini 3.5 Flash, medium
  via the Antigravity app's Model Selection; the CLI honors it. agy is
  also prone to misinterpreting structured prompts (treats long briefs as
  meta-questions about CLI flags). Use short, direct prompts; fall back
  to direct source-read when agy goes off-script.
- **`cursor-agent`** has no thinking variant for Composer 2.5; for
  deep-reasoning questions route to `claude` or `codex`.
- For all five, pass the non-interactive print flag when scripting and
  bound long runs with a timeout (`agy` in particular can hang).

## The protocol

Research proceeds in four steps. Each step's output is appended to a
single artifact file at `/tmp/parity-research.md` (or a Lisa-local temp
path) so the four steps form one continuous document. Earlier steps'
outputs are inputs to later steps.

### Step 1 — Universal feature aggregate

Build the **union catalog** of every feature each in-scope agent exposes.
Cast a wide net: this is the foundation that Steps 2-4 depend on, and
omitting features here propagates errors down the chain.

**Method** — combine three sources for each agent:

1. **Web/doc research** (WebSearch + WebFetch): official docs, GitHub
   issues, release notes, community feature catalogs. Sources to canvass
   per agent:
   - Claude Code: `code.claude.com/docs`, anthropic blog, GitHub
     marketplace plugin examples.
   - Codex: `developers.openai.com/codex/`, GitHub releases for `codex-cli`,
     `core-plugins/src/manifest.rs` schema.
   - Cursor: `cursor.com/docs`, the bundled `index.js` (loader source),
     community marketplace examples.
   - Antigravity (agy): `antigravity.google/docs/*`, Google Cloud
     community blog (Medium), `agy plugin --help` subcommand surface.
   - Copilot: `docs.github.com/en/copilot/*`, the `cli-plugin-reference`
     page, generated TypeScript declarations under
     `~/Library/Caches/copilot/pkg/.../rpc.d.ts`.

2. **CLI self-query**: `<cli> --help` and every visible subcommand's
   `--help`. Walk the help tree fully.

3. **Council brief** (via [[harness-parity-council]]): send each agent
   the same brief asking it to enumerate every feature it exposes —
   *not just plugin-related ones*. Include tool surfaces, model
   selection, output formats, session resumption, sandbox modes, ACP,
   MCP transports, workspaces/worktrees, keybindings, auth methods,
   image/voice input, IDE integrations, update mechanism, telemetry,
   etc. Tag the prompt with the symmetric framing from §1z.

**Categories to canvass** (use as a checklist — not exhaustive; add as
discovered):

- **Authoring surfaces**: skills, sub-agents, slash commands, hooks,
  MCP servers, rules/instructions, memory files, custom prompts,
  workflows, role personas, LSP servers, app connectors.
- **Distribution & lifecycle**: plugin manifest, plugin marketplace,
  plugin install/enable/disable/validate, version pinning, update
  mechanism, session-only loading, marketplace registry.
- **Runtime modes**: interactive vs print (`-p`), agent client protocol
  (ACP), plan mode, ask mode, headless, sandbox modes, trust mode,
  worktree mode, autopilot mode.
- **Inputs & I/O**: model selection, reasoning effort, output formats
  (text/json/stream-json), streaming, image attachments, voice input,
  context windows, prompt caching, multi-line input, custom
  keybindings.
- **Tools**: file edit/write, shell, web fetch, web search, code
  search, file read, glob, MCP tool exposure, tool allowlist /
  permission gates, allowed-paths, allowed-URLs, sub-agent invocation.
- **Auth & identity**: API key, OAuth, login subcommand, account
  identity, organization policy gates, telemetry/analytics defaults.
- **Integrations**: IDE integration (VS Code, JetBrains, etc.),
  shell integration, Git integration, commit attribution, scheduling
  / cron, notifications.
- **Hook events**: every event name each agent exposes (PreToolUse,
  PostToolUse, SessionStart, SessionEnd, SubagentStart, SubagentStop,
  UserPromptSubmit, Stop, PreCompact, PostCompact, Notification,
  PermissionRequest, beforeShellExecution, beforeTabFileRead, …).

**Output of Step 1** — a flat list of every distinct feature found across
the union of all five agents, each with a short description and the
agent(s) that surfaced it. Do not classify per-agent support yet — that's
Step 2. Aim for breadth; minimum ~60 distinct features for a
five-agent fleet. Save to the artifact under heading
`## Step 1 — Universal feature catalog`.

### Step 2 — Support matrix

For each feature in the Step 1 catalog, fill a row showing which agents
natively support that feature. **No assumptions about plugin
distributability yet** — that's Step 3. Step 2 is purely "does this agent
have this feature, in any form (config, CLI flag, plugin-bundled, anywhere)."

Cell forms:

- `✅` — supported natively. Name the exact mechanism in parentheses.
- `✅*` — supported with a caveat (only in interactive mode; only at user
  level; only when feature-flag X enabled). State the caveat.
- `❌` — explicitly not supported (verified by source-read or runtime
  capture, not just absence from docs).
- `⚠ unverified` — claim from docs only, runtime not probed.

**Empirical bar**: every `✅` cell needs a `[VERIFIED-BY-RUN]` tag with a
command + observed output, or a `[VERIFIED-DOC]` tag with URL. `[UNKNOWN]`
cells are allowed but flagged for Step 4 follow-up.

**Output of Step 2** — markdown table, rows = Step 1 features, columns =
agents. Save under `## Step 2 — Support matrix`.

### Step 3 — Plugin-distributability matrix

For each `✅` or `✅*` cell from Step 2, answer the separate question: **can
this feature be packaged inside that agent's plugin format, such that a
user gets the feature by installing the plugin?** This is a different
matrix from Step 2 because many features (CLI flags, OS-level integrations,
auth methods) are agent-supported but not plugin-distributable.

Cell forms:

- `📦 yes` — bundleable in the agent's plugin manifest. Name the manifest
  field or directory convention (e.g. `skills/<n>/SKILL.md`, manifest
  `hooks` block).
- `📦* yes-with-caveat` — bundleable but the runtime behavior differs from
  the standalone case (e.g. agy's hooks/hooks.json validates and installs
  but doesn't fire in `-p` mode — `[VERIFIED-BY-RUN]`).
- `❌ no` — the feature exists on this agent but cannot be carried in its
  plugin format (e.g. MCP on agy: lives at user-config or project-config
  scope, NOT in plugin).
- `n/a` — feature isn't supported on this agent at all (cell was `❌` in
  Step 2).

**Empirical bar**: for any `📦 yes` cell, an empirical probe should have
either installed a plugin carrying that feature and observed it loading,
or read a public canonical plugin that does so. `📦* yes-with-caveat`
cells MUST have `[VERIFIED-BY-RUN]` evidence — the caveat is the whole
point.

**Output of Step 3** — same row/column layout as Step 2, different cell
semantics. Save under `## Step 3 — Plugin-distributability matrix`.

### Step 4 — Lisa polyfill designs

For each (feature, agent) cell that is one of:
- `❌` in Step 2 (agent doesn't support the feature at all), or
- `❌ no` or `📦* yes-with-caveat` in Step 3 (agent supports it but it's
  not distributable via plugin, or it's distributable but runtime
  behavior is broken),

design **how Lisa would polyfill the gap.** This is the design step, not
the implementation step — output is prose + sketch, not code.

**Per-cell deliverable**:

1. **Cell ID**: `<feature> × <agent>`
2. **Gap classification**:
   - **Type A**: feature absent on this agent entirely.
   - **Type B**: feature present but not plugin-distributable.
   - **Type C**: feature plugin-distributable but runtime-broken in
     headless mode.
3. **Polyfill strategy** — one of:
   - **Translate**: emit the feature in a different shape the agent does
     support (e.g. Codex commands → Lisa skills with `lisa-` prefix).
   - **Wrap**: invoke a non-plugin Lisa installer at `lisa apply` time to
     write the feature into a non-plugin location (e.g. agy MCP → write
     `~/.gemini/config/mcp_config.json`).
   - **Bake**: fold the feature's content into a different surface the
     agent does auto-load (e.g. agy rules → bake `rules/eager/*.md`
     bodies into AGENTS.md).
   - **Skip**: document as agent-only, do not polyfill (e.g. Copilot LSP
     servers — Lisa doesn't ship LSPs).
   - **Block**: declare blocked, route to a separate work item to either
     pressure upstream or rethink Lisa's reliance on the feature.
4. **Sketch** — 3-5 sentences naming the file path Lisa would change in
   the implementation phase, the data shape, and any caveats. NOT code.
5. **Empirical verification plan** — the probe `lisa-coding-agent-parity-implement`
   will run to prove the polyfill works.

**Polyfill collision check** — before finalizing each design, check
whether the polyfill would collide with a native mechanism on a different
agent loading the same plugin (e.g. Lisa's plugin-bundled SessionStart
rules hook on Claude would double-fire on Cursor, which auto-loads
`rules/` natively). Per-agent plugin artifacts (the Pattern B decision
from the plugins-surface pass) are the canonical fix.

**Output of Step 4** — one subsection per gap cell. Save under
`## Step 4 — Lisa polyfill designs`.

## Output artifact

The artifact is a single markdown file at `/tmp/parity-research.md` (or a
Lisa-local temp path) with four top-level sections matching Steps 1-4
plus a header summarizing the run (date, agent fleet, CLI versions
probed, evidence sources canvassed).

The artifact is the entire output of this skill. It is the input to
[[lisa-coding-agent-parity-implement]]. No installer code, no per-agent
plugin variants, no commits, no PRs — those belong to the implementation
skill.

## Where each agent's plugin artifacts live (reference)

A reference for Step 1 / Step 3 work — where to look in Lisa's source
tree to understand each agent's existing surface, and where the agent's
installed plugins land on disk.

- **Claude** — Plugin manifest `plugins/src/<plugin>/.claude-plugin/plugin.json`
  with `hooks` block, auto-discovered `skills/`, `agents/`, `commands/`,
  `rules/` (NOT auto-loaded — Lisa polyfills via SessionStart hook).
  Marketplace at `.claude-plugin/marketplace.json` at repo root, 8+
  plugins listed. Installed: `~/.claude/plugins/`. Plugin-root env var:
  `${CLAUDE_PLUGIN_ROOT}`.
- **Codex** — `.codex-plugin/plugin.json` pointer (skills + MCP); hooks
  via `.codex/hooks.json` per-project, OR — as of codex-cli 0.125.0 —
  via plugin-bundled `hooks/hooks.json` or inline manifest `hooks` field.
  Hook events: ten total, including `SubagentStart`, `SubagentStop`,
  `PreCompact`, `PostCompact`. Sub-agents are config-level
  `[agents.<role>]`, NOT a plugin component. Installed:
  `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`.
  Marketplace: `~/.codex/config.toml` `[marketplaces.<n>]`. Lisa installs
  via `src/codex/*-installer.ts` (skills, agents, hooks, AGENTS.md,
  marketplace, settings, manifest tracking).
- **Cursor** — Reads BOTH `.cursor-plugin/plugin.json` AND
  `.claude-plugin/plugin.json` natively (loader's
  `discoverComponents` covers `skills`, `agents`, `commands`, `rules`).
  Hooks auto-normalized from Claude event names. Installed plugins land
  under `~/.claude/plugins/cache/` (Cursor shares Claude's tree).
  Session-only via `--plugin-dir <path>`. Cursor-unique events:
  `beforeShellExecution`, `beforeTabFileRead`.
- **Antigravity (`agy`)** — Plugin manifest is **bare `plugin.json` at
  plugin root** (NOT `.claude-plugin/` or `.gemini-plugin/`). Components:
  `skills/`, `agents/`, `commands/` (auto-converted to skills!), `hooks/hooks.json`.
  MCP is NOT a plugin component — lives at user `~/.gemini/config/mcp_config.json`
  or project `.agents/mcp_config.json`. Auto-loads `AGENTS.md` since
  v1.20.3. Plugin-bundled hooks validate and install but DO NOT FIRE in
  `-p` mode — Lisa cannot rely on agy plugin hooks for headless rule
  injection (use AGENTS.md bake-in instead). Installed: `~/.gemini/config/plugins/<plugin-name>/`.
  Plugin manager: `agy plugin install/uninstall/enable/disable/validate/link/import`.
- **Copilot** — Manifest lookup: `plugin.json` → `.plugin/plugin.json` →
  `.github/plugin/plugin.json` → `.claude-plugin/plugin.json`. Components:
  `skills/<n>/SKILL.md` (default) or manifest `skills` path;
  `agents/<n>.agent.md` (NOTE the `.agent.md` extension — adapter needed
  vs Claude's `<n>.md`); manifest `hooks`; manifest `mcpServers`; LSP
  servers via `lspServers` (Copilot-unique). MCP three layers: User
  `~/.copilot/mcp-config.json`, Workspace `.mcp.json`, Plugin. Installed:
  `~/.copilot/installed-plugins/<marketplace>/<plugin>/` or `_direct/`.
  `CodySwannGT/lisa` is already a registered marketplace.

## Known capability references (memory)

Update these after a research pass surfaces new capabilities. They are
the institutional memory that lets the next pass start from current
knowledge rather than redoing CLI source-reads from scratch.

- [[reference-codex-hooks-capabilities]] — Codex hook events (currently
  stale; 0.125.0 expanded the event list — update after next implementation).
- [[reference-codex-plugin-skill-loading]] — `.codex-plugin/` skills pointer.
- [[reference-codex-commit-attribution]] — Codex commit-attribution gates.
- [[reference-codex-http-mcp-plugin-shape]] — Codex accepts Claude's
  `{type,url}` MCP shape.
- [[reference-codex-automations]] — Codex automations / scheduling.
- [[reference-codex-cli-collaboration]] — `codex exec` non-interactive
  patterns.
- [[reference-lisa-hook-delivery]] — how Lisa hooks reach projects.

Per-agent capability memory for Cursor, agy, Copilot does not yet exist —
write the first one whenever this skill produces a `[VERIFIED-BY-RUN]`
load-bearing finding about that agent.

## Worked example — the plugins-surface research pass (2026-05-28)

The canonical reference run. Topic: Lisa's plugin surface across all five
agents.

- **Step 1** surfaced ~30 features focused on plugin packaging (skills,
  sub-agents, slash commands, hooks, MCP, rules, memory, settings,
  marketplace, version pinning, enable/disable, etc.).
- **Step 2** filled the support matrix with a mix of `[VERIFIED-BY-RUN]`
  (agy via direct probes + plugin install; Cursor via `--plugin-dir`
  smoke test; Copilot via marketplace browse) and `[VERIFIED-DOC]`
  (codex hooks event list).
- **Step 3** flipped multiple cells that looked positive in Step 2:
  agy MCP (supported, but ❌ not plugin-distributable — file lives
  outside the plugin), agy hooks (supported AND plugin-distributable
  per the validator, but `📦*` — runtime DOES NOT FIRE in `-p` mode).
- **Step 4** produced polyfill designs including: Codex commands →
  Lisa-prefixed skills (Translate); agy MCP → `mcp-installer.ts`
  writing user-config (Wrap); agy rules → bake into AGENTS.md (Bake);
  Copilot LSP servers → not portable (Skip).

The full artifact is at `/tmp/plugins-plan.md` (the research-output file
from that run). Sections 1a, 1z, 5, 5.5, 5.6 of that artifact carry the
canonical examples for the matrix-cell formats above.

That pass also surfaced that the previously stale [[reference-codex-hooks-capabilities]]
memory needed updating — Codex 0.125.0 expanded the hook event list.

## Definition of done

- Step 1 catalog covers a clear majority of each agent's documented
  feature surface — ~60+ distinct features for a five-agent fleet, with
  no obvious omissions in any of the canvass categories above.
- Step 2 support matrix has every cell labeled (✅ / ✅* / ❌ /
  ⚠ unverified), and every load-bearing claim is tagged with
  `[VERIFIED-DOC]` (URL), `[VERIFIED]` (source-read command), or
  `[VERIFIED-BY-RUN]` (CLI invocation + observed output).
- Step 3 plugin-distributability matrix has every cell labeled
  (📦 / 📦* / ❌ / n/a). The split between Step 2 support and Step 3
  distributability is explicit — no conflation.
- Step 4 has one polyfill design per gap cell, each with: gap type,
  polyfill strategy, file/data sketch, collision check, and
  verification plan for `lisa-coding-agent-parity-implement`.
- The artifact at `/tmp/parity-research.md` (or chosen path) is a
  single coherent markdown document.
- Capability memory entries are updated for any agent whose surface
  changed materially during the research pass.

**Out of scope explicitly**: no installer code, no plugin variant
generation, no commits, no PRs, no `lisa apply` modifications. Those
belong to [[lisa-coding-agent-parity-implement]].

## Handoff to implementation

When this skill completes, the artifact at `/tmp/parity-research.md`
(or chosen path) is the input contract for
[[lisa-coding-agent-parity-implement]]. The implementation skill:

1. Reads the artifact.
2. Picks a scope (one polyfill, one full agent, one feature surface,
   etc. — depends on the implementation skill's own gating).
3. Authors the installers / plugin variants / build-script changes.
4. Runs the per-cell empirical verifications spec'd in Step 4.
5. Lands the work.

This skill never executes any of those steps. If a user invokes this
skill and asks for "implementation" or "apply this," reject the request
and point at the sibling skill.
