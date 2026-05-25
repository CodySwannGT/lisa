---
name: research
description: "Research a problem space and create a PRD in the configured PRD source. Investigates the codebase, defines user flows, assesses technical feasibility, synthesizes the spec, then creates it in the source (Notion / Confluence / GitHub / Linear per .lisa.config.json `source`) via lisa:prd-source-write — there is no loose document artifact. Vendor-agnostic. Accepts an optional `prd_ready` flag (default false → the PRD is created in the `draft` role; true → created `ready` so lisa:intake auto-claims it) and an optional dedupe `marker`/`dedupe_key` (used when invoked by lisa:project-ideation) so re-runs reference the existing PRD instead of duplicating it."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Research

Produce a PRD for the problem in `$ARGUMENTS`, then create it in the configured PRD source.

## Inputs

- The problem statement / feature idea (required) — free text, a feasibility card, or a URL.
- `prd_ready` (optional, default `false`) — `false` creates the PRD in the source's `draft` role for
  human review; `true` creates it in the `ready` role so `lisa:intake` (PRD side) auto-claims it.
- `dedupe_key` / `marker` (optional) — a stable dedupe marker (e.g. supplied by
  `lisa:project-ideation`) embedded in the created PRD so re-runs reference the existing PRD rather
  than creating a duplicate.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation or subagent-delegation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude: use `TeamCreate`. If `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Gathering context inline as the lead is the exact bypass path that produces ad-hoc work instead of a real team flow.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Flow

Execute the **Research** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The rule contains the canonical step sequence (gates, sub-flows, deliverables). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

## Output

A PRD **created in the configured PRD source** (per the intent-routing rule's Research flow
definition) containing: context, problem statement, user flows, acceptance criteria, technical
feasibility notes, open questions, and the "Recommended Tooling for Plan Phase" section. The final
flow step invokes `lisa:prd-source-write`, which creates the PRD in the configured `source` (Notion
page in the PRD database, Confluence page under the lifecycle parent, GitHub issue, or Linear
project) in the `draft` role by default or `ready` when `prd_ready=true`. **The PRD lives in the
source — there is no loose document artifact.** A `source` must be configured; if it is not, stop and
report it rather than emitting a document. The Plan flow consumes the created PRD next.
