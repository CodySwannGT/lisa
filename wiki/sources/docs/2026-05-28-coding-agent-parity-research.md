# Coding-Agent Parity Research Source Note

Date: 2026-05-28
Origin: `/tmp/parity-research.md` (produced by the `lisa-coding-agent-parity` research skill on the `worktree-coding-agent-parity` worktree)
Scope: feature-parity research across the five coding agents Lisa can install into — Claude Code, Codex, Cursor (`cursor-agent`), Antigravity (`agy`), and GitHub Copilot.

## What Was Ingested

A four-step research artifact:

1. **Universal feature catalog** — 170 distinct features across 12 categories: plugin/distribution surfaces, authoring components, hook events, runtime modes, inputs & I/O, session lifecycle, tools, MCP transport, auth & identity, integrations, output & sharing, misc/specialized.
2. **Support matrix** — per-feature, per-agent native-support classification across all five agents.
3. **Plugin-distributability matrix** — for each supported cell, whether the feature is packageable inside that agent's plugin format.
4. **Lisa polyfill designs** — 16 gap-cell clusters with polyfill strategies (Translate, Wrap, Bake, Skip, Block) and per-cluster sketches.

## CLI Versions Probed

| CLI | Version |
| --- | --- |
| `claude` | 2.1.156 |
| `codex` | 0.125.0 |
| `cursor-agent` | 2026.05.28-418efe5 |
| `agy` | 1.0.3 |
| `copilot` | 1.0.55 |

## Evidence Sources Canvassed

- Web research via WebSearch and WebFetch against `code.claude.com/docs`, `developers.openai.com/codex`, `cursor.com/docs`, `antigravity.google/docs`, `docs.github.com/en/copilot`, plus community catalogs (`awesome-claude-code`, `awesome-codex-cli`, Antigravity Lab, Cursor changelogs, GitHub Copilot CLI reference).
- CLI self-query: `--help` walks for each CLI plus targeted subcommand `--help` (`mcp`, `plugin`, `agents`, `features`).
- Source-read of `codex features list` (61 documented feature flags with stage and state).
- Empirical runtime probes against `agy`: `agy plugin validate` against three candidate manifest layouts (`.claude-plugin/`, `.gemini-plugin/`, bare `plugin.json` — bare wins), `agy plugin install` of a probe plugin (verified install path is `~/.gemini/config/plugins/<name>/`), hook-fire test (verified registered hooks DO NOT fire in `-p` headless mode), MCP file-naming probes (verified MCP is not a plugin component on agy; file lives at `~/.gemini/config/mcp_config.json` or `.agents/mcp_config.json` with `serverUrl` HTTP transport key).
- Empirical runtime probes against `cursor-agent`: `--plugin-dir` smoke test verified Cursor auto-discovers `skills/<n>/SKILL.md` from `.claude-plugin/`-format plugins.
- Empirical runtime probes against `copilot`: marketplace-listing probe verified `copilot` reads `.claude-plugin/marketplace.json` and enumerates Lisa's eight plugins.

## Durable Findings That Land In The Wiki

- The 12-category feature taxonomy is captured in `wiki/concepts/coding-agent-feature-taxonomy.md`.
- The five coding agents are profiled in `wiki/entities/coding-agents.md`.
- The four-step research protocol is in `wiki/playbooks/coding-agent-parity-research.md`.
- Architecture across the five agent installer surfaces and Lisa's polyfill strategies is in `wiki/architecture/coding-agent-parity.md`.
- The Pattern B per-agent plugin variants architectural decision is in `wiki/decisions/2026-05-28-pattern-b-per-agent-plugin-variants.md`.
- Unresolved questions (Copilot memory file, agy hook-fire interactive-mode behavior) are in `wiki/open-questions/coding-agent-parity.md`.

## Not Ingested

- The full 170-feature catalog and per-agent support cell content are research output that drifts as upstream agents ship new releases. The artifact remains at `/tmp/parity-research.md` for the implementation skill (`lisa-coding-agent-parity-implement`) to consume directly; only the durable structural knowledge above lands in the wiki.
- No raw secrets, tokens, OAuth artifacts, or private credentials were present in the research artifact.
