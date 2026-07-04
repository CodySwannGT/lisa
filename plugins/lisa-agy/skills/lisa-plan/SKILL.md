---
name: lisa-plan
description: "Decompose a single PRD or specification into ordered work items in the configured tracker. Vendor-agnostic — the source can be a Notion PRD URL, a Confluence PRD URL, a Linear project URL, a GitHub Issue URL, an existing JIRA epic key, a markdown file, or a free-form description; the destination tracker is whatever the project is configured to use via `.lisa.config.json` `tracker` (JIRA, GitHub Issues, or Linear). Single-PRD mode only — for batch scanning of all Ready PRDs in a queue, use the lisa-intake skill."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Plan: $ARGUMENTS

Decompose the PRD/spec at `$ARGUMENTS` into ordered work items with acceptance criteria, dependencies, and recommended skills/agents.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation or subagent-delegation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude: use `TeamCreate`. If `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Reading the PRD, exploring the code, fetching context — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

## Source dispatch

Detect the input type from `$ARGUMENTS` and route to the appropriate source skill:

| If `$ARGUMENTS` is... | Hand off to |
|------------------------|-------------|
| A Notion **page** URL or page ID (single PRD) | `lisa-notion-to-tracker` (with the PRD URL; runs the full pipeline: extract artifacts → walk live product → validate → write tickets → coverage audit) |
| A Notion **database** URL or database ID | Stop and report — single-PRD mode only. Direct the caller to `lisa-intake` for batch scanning of a database. |
| A Confluence **page** URL containing `/wiki/spaces/<KEY>/pages/<ID>/...` (single PRD) | `lisa-confluence-to-tracker` (with the PRD URL; same full pipeline as the Notion path) |
| A Confluence **space** URL (`/wiki/spaces/<KEY>` with no `/pages/...`) | Stop and report — single-PRD mode only. Direct the caller to `lisa-intake` for batch scanning of a space. |
| A Linear **project** URL (`https://linear.app/<workspace>/project/<slug>-<id>`) | `lisa-linear-to-tracker` (with the project URL; same full pipeline as the Notion / Confluence paths). The Linear project's description, attached documents, and sub-issues form the PRD body. |
| A Linear **workspace** URL (`https://linear.app/<workspace>` with no `/project/...`) or **team** URL | Stop and report — single-PRD mode only. Direct the caller to `lisa-intake` for batch scanning of a workspace or team. |
| A JIRA ticket ID/URL of an Epic (existing epic *is* the spec) | `lisa-jira-agent` (read epic, decompose into stories/sub-tasks) |
| A Linear Project URL of a Project that *is* the spec, when destination tracker = `linear` | `lisa-linear-agent` (read project, decompose into Issues / sub-Issues). Symmetric counterpart to the JIRA-Epic and GitHub-Epic branches. |
| A GitHub **issue** URL (`https://github.com/<org>/<repo>/issues/<number>`) or `<org>/<repo>#<number>` token (single PRD) | `lisa-github-to-tracker` (with the issue ref; runs the full pipeline: extract artifacts → walk live product → validate → write tickets → coverage audit). The destination tracker is read from `.lisa.config.json` `tracker`. |
| A GitHub **repository** URL or `<org>/<repo>` token (no issue number) | Stop and report — single-PRD mode only. Direct the caller to `lisa-intake` for batch scanning of a GitHub repo. |
| A GitHub Issue URL of a build-side ticket (`type:Epic` / `type:Story` / etc., not `prd-*`-labelled) when `tracker = github` | `lisa-github-agent` (read issue, decompose into Sub-tasks). Symmetric counterpart to the JIRA-Epic branch above. |
| A file path (`@plan.md`, `./spec.md`) | Read the file as the spec; run the Plan flow's core decomposition with the file content as input. |
| A plain-text description | Use the description as the spec; run the Plan flow's core decomposition. |

If no PRD or specification exists, suggest running the `lisa-research` skill first to produce one.

## Flow

Execute the **Plan** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The rule contains the canonical step sequence (gates, sub-flows, output structure). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

## Output

Work items in the configured tracker (JIRA, GitHub Issues, or Linear, per `.lisa.config.json` `tracker`) with acceptance criteria, dependencies, and recommended skills/agents per item. Ordered by dependency. Before finishing, route usage writes through `lisa-usage-accounting`: record the Plan run as a direct entry on the source PRD/spec artifact, attach a plan usage entry (or an explicit `source: unavailable` entry with nullable token/cost fields) to each created work item, and refresh the PRD rollup after `lisa-prd-backlink` regenerates the `## Tickets` child refs. Do not invent plan-specific ledger formats or omit missing usage silently. If the specification cannot be decomposed without further clarification, stop and report what is missing.
