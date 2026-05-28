# Coding-Agent Parity Research Playbook

When the coding-agent fleet Lisa installs into changes — a new CLI is added, an existing CLI ships a capability, or Lisa needs an updated picture of where parity stands — run the parity research protocol. The output is a four-part artifact that feeds the implementation skill `lisa-coding-agent-parity-implement`. This skill never authors installer code.

## When To Use

- A new coding agent is added to Lisa's distribution targets.
- An existing coding agent ships a capability (a new hook event, a new plugin component slot, a new manifest field).
- Before opening implementation work that touches more than one agent.
- When stale capability memory needs refresh (a `[VERIFIED-BY-RUN]` finding has aged enough that it should be re-probed).

## Inputs

- Live access to every CLI in scope so probes can run.
- WebSearch and WebFetch for documentation gathering.
- The `harness-parity-council` skill for parallel agent dispatch when source-read and web research leave gaps.
- The `lisa-coding-agent-parity` skill definition (the canonical protocol description).

## The Four Steps

### Step 1: Universal Feature Aggregate

Build the union catalog of every feature each in-scope agent exposes. Combine three sources per agent: web and documentation research, CLI self-query via `--help` walks and subcommand help, and optionally `harness-parity-council` dispatches. Canvass twelve categories: plugin and distribution surfaces, authoring components, hook events, runtime modes, inputs and I/O, session lifecycle, tools, MCP transport, auth and identity, integrations, output and sharing, miscellaneous specialized.

Aim for ≥60 distinct features for a five-agent fleet. Tag every load-bearing claim with `[VERIFIED-DOC]`, `[VERIFIED]`, or `[VERIFIED-BY-RUN]`.

### Step 2: Support Matrix

For every feature in the Step 1 catalog, fill a row showing which agents natively support it. Cells: `✅`, `✅*` with caveat, `❌`, or `⚠ unverified`. Do not conflate support (Step 2) with plugin-distributability (Step 3).

### Step 3: Plugin-Distributability Matrix

For each `✅` or `✅*` cell from Step 2, answer the separate question: can this feature be packaged inside that agent's plugin format such that a user gets it by installing the plugin? Cells: `📦 yes`, `📦* yes-with-caveat`, `❌ no (supported but not plugin-distributable)`, `n/a (feature absent on this agent)`.

The plugin payload surface is small. Most features (CLI flags, runtime modes, session lifecycle, auth, integrations, output formatting) are uniformly `❌ no` on every agent. The bundleable surface concentrates in Category B (authoring components) and Category C (hook events).

### Step 4: Polyfill Designs

For every gap cell — `❌` in Step 2, `❌ no` in Step 3, or `📦* yes-with-caveat` in Step 3 — design how Lisa polyfills it. Each design picks a strategy:

- **Translate**: emit the feature in a different shape the agent does support, such as Codex commands becoming `lisa-`-prefixed skills.
- **Wrap**: invoke a non-plugin Lisa installer at apply time to write the feature into a non-plugin location, such as agy MCP writing `~/.gemini/config/mcp_config.json`.
- **Bake**: fold the feature's content into a different surface the agent does auto-load, such as agy rules being baked into AGENTS.md.
- **Skip**: document as agent-only and do not polyfill, such as Copilot LSP servers.
- **Block**: declare blocked, route to a separate work item to pressure upstream or rethink Lisa's reliance, such as agy plugin hooks not firing in headless mode.

Each design names the file path Lisa would change, sketches the data shape, runs a polyfill-collision check, and lists the empirical verification plan the implementation skill will execute.

## Output Artifact

A single markdown file (default location `/tmp/parity-research.md`) with four top-level sections matching the four steps plus a header summarizing the run.

## Scope Boundaries

The skill is research-only. It does not write installer code, does not generate per-agent plugin variants, does not commit, does not open PRs, and does not modify Lisa's source tree under `src/` or `plugins/src/`. Implementation work is the sibling skill `lisa-coding-agent-parity-implement`, which consumes the artifact this skill produces.

## Empirical Bar

Three evidence tags:

- `[VERIFIED-DOC]` — a publicly-published official document, GitHub issue, or canonical community example, with URL.
- `[VERIFIED]` — source-read of the installed binary, its `--help`, the config home, vendored source, or generated schemas.
- `[VERIFIED-BY-RUN]` — a real CLI invocation with command and observed-output snippet.

Treat `[VERIFIED-DOC]` claims as preliminary and upgrade to `[VERIFIED-BY-RUN]` before they are load-bearing for a Step 4 polyfill design.

## Definition Of Done

- Step 1 catalog covers a clear majority of each agent's documented feature surface.
- Step 2 every cell is labeled and every load-bearing claim is tagged.
- Step 3 every supported cell is classified as plugin-distributable or not.
- Step 4 has one design per gap cell with strategy, sketch, collision check, and verification plan.
- The artifact is a single coherent document handed off to the implementation skill.
- Capability memory entries are updated for any agent whose surface materially changed during the pass.
