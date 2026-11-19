# Parity routing review — `coderabbit@claude-plugins-official`

- **Plugin:** `coderabbit@claude-plugins-official`
- **Upstream version:** `1.3.0`
- **Analyzed:** 2026-11-19 (re-review; originally 2026-05-30 at 1.1.1)
- **Status:** `proposed` (flip to `approved` before running `implement-plugin-parity`)

## Components

| kind | id | path | classification | notes |
| --- | --- | --- | --- | --- |
| mcp | `coderabbit` | `.claude-plugin/plugin.json` | mcp-server | Remote HTTP MCP (https://mcp.coderabbit.ai/, OAuth) for hosted account and pull-request workflows; new in 1.3.0. Not used by upstream local reviews. |
| agent | `code-reviewer` | `agents/code-reviewer.md` | claude-agent | Subagent wrapping the CodeRabbit CLI review. |
| agent | `autofix` | `agents/autofix.md` | claude-agent | Read-only subagent that collects unresolved CodeRabbit review threads and returns a fix plan (new in 1.3.0). |
| command | `setup` | `commands/setup.md` | claude-command | Connects the CodeRabbit MCP and sets up the standalone CLI (new in 1.3.0; replaces the removed coderabbit-review command as the plugin's only Claude command). |
| skill | `autofix` | `skills/autofix/SKILL.md` | claude-skill | Applies CodeRabbit review-thread feedback with per-change approval. |
| skill | `code-review` | `skills/code-review/SKILL.md` | claude-skill | Default code-review skill (local review through the CodeRabbit CLI). |
| skill | `coderabbit-config` | `skills/coderabbit-config/SKILL.md` | claude-skill | Creates and validates .coderabbit.yaml through the CodeRabbit CLI (new in 1.3.0). |

## Per-agent routing

| agent | outcome | actions | rationale |
| --- | --- | --- | --- |
| codex | `reimplement` | - reimplement the code-reviewer agent and the code-review skill as one Lisa-native skill (lisa-parity-coderabbit) stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- reimplement the autofix agent and autofix skill as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- reimplement the setup command and the coderabbit-config skill as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.3.0 (both drive the CodeRabbit CLI, which is agent-agnostic)<br>- the coderabbit remote MCP (mcp.coderabbit.ai) gets no Lisa counterpart: upstream 1.3.0 uses it only for hosted account and pull-request workflows, its own local-review skill never calls it, and the Lisa reimplementation is a local review that calls no review service | Codex has no plugin agent/command surface and is not in the fan-out; reimplement every component group as Lisa skills. (The CodeRabbit CLI itself is agent-agnostic and can be invoked from the reimplemented skills.) |
| cursor | `claude-only` | _(none)_ | Cursor reads .claude-plugin/ natively; the agents, command, skills and the MCP declared in plugin.json load unchanged. |
| agy | `reimplement` | - reimplement the code-reviewer agent and the code-review skill as one Lisa-native skill (lisa-parity-coderabbit) stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- reimplement the autofix agent and autofix skill as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- reimplement the setup command and the coderabbit-config skill as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.3.0 (both drive the CodeRabbit CLI, which is agent-agnostic)<br>- the coderabbit remote MCP (mcp.coderabbit.ai) gets no Lisa counterpart: upstream 1.3.0 uses it only for hosted account and pull-request workflows, its own local-review skill never calls it, and the Lisa reimplementation is a local review that calls no review service | Curated third-party plugins are not in agy's fan-out; reimplement every component group as Lisa skills. |
| copilot | `enable-vendor-equivalent` | - enable Copilot's native code-review capability (covers the code-reviewer agent and code-review skill) in the project-scoped marketplace<br>- the autofix agent and autofix skill have no generic Copilot equivalent — reimplement them as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- the setup command and coderabbit-config skill have no generic Copilot equivalent — reimplement them as Lisa-native skills stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- the coderabbit remote MCP (mcp.coderabbit.ai) gets no Lisa counterpart: upstream 1.3.0 uses it only for hosted account and pull-request workflows, its own local-review skill never calls it, and the Lisa reimplementation is a local review that calls no review service | Code review is a generic capability Copilot ships natively (enable it for the review components); the CodeRabbit-specific autofix has no native equivalent so it is reimplemented. |
| devin | `reimplement` | - ship the existing Lisa-native reimplementation of the code-reviewer agent and code-review skill (lisa-parity-coderabbit) in the lisa-devin variant, stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- the autofix agent and skill, the setup command and the coderabbit-config skill reach Devin as Lisa-native skills in the lisa-devin variant — Devin has no plugin agent or command surface — stamped synced-from: coderabbit@claude-plugins-official@1.3.0<br>- the coderabbit remote MCP (mcp.coderabbit.ai) gets no Lisa counterpart: upstream 1.3.0 uses it only for hosted account and pull-request workflows, its own local-review skill never calls it, and the Lisa reimplementation is a local review that calls no review service | Devin installs Lisa's own lisa-devin plugin variant, which ships the Lisa-native reimplementation; curated third-party Claude plugins are not part of Lisa's Devin install. |

> Plan-only artifact. Review the routing, then flip `"status": "proposed"` → `"approved"` in the paired `.json` to authorize `implement-plugin-parity`.
