---
name: research
description: "Research a problem space and produce a PRD. Investigates the codebase, defines user flows, assesses technical feasibility, and outputs a specification ready to hand to the Plan flow. Vendor-agnostic — the resulting PRD lands wherever the configured destination is (Notion, Confluence, file, etc.)."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Research

Produce a PRD for the problem in `$ARGUMENTS`.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use `TeamCreate` if available. In Claude, if `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema. If `TeamCreate` is not available, use the current runtime's tool-discovery mechanism (for Codex, `tool_search`) to discover available multi-agent/team tools, then call the appropriate team creation tool. If no team creation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Gathering context inline as the lead is the exact bypass path that produces ad-hoc work instead of a real team flow.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Flow

Execute the **Research** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The rule contains the canonical step sequence (gates, sub-flows, deliverables). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

## Output

A PRD that includes (per the intent-routing rule's Research flow definition): context, problem statement, user flows, acceptance criteria, technical feasibility notes, and any open questions. The PRD lands in the configured destination (Notion database, Confluence space, local markdown file) per project config. The Plan flow consumes it next.
