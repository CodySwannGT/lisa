---
name: plan
description: "Decompose a single PRD or specification into ordered work items in the configured tracker. Vendor-agnostic — the source can be a Notion PRD URL, a Confluence PRD URL, a Linear project URL, a GitHub Issue URL, an existing JIRA epic key, a markdown file, or a free-form description; the destination tracker is whatever the project is configured to use via `.lisa.config.json` `tracker` (JIRA or GitHub Issues). Single-PRD mode only — for batch scanning of all Ready PRDs in a queue, use the lisa:intake skill."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Plan: $ARGUMENTS

Decompose the PRD/spec at `$ARGUMENTS` into ordered work items with acceptance criteria, dependencies, and recommended skills/agents.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), the very first thing you do is create the team. Two tool calls only, in this exact order:

1. `ToolSearch` with `query: "select:TeamCreate"` — `TeamCreate` is a deferred tool whose schema must be loaded before it can be invoked. A cold call returns `InputValidationError` and tempts a fallback to direct `Agent` calls, which bypasses the team.
2. `TeamCreate` — actually create the team.

Until `TeamCreate` returns successfully, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Reading the PRD, exploring the code, fetching context — all of those are tasks for the team you are about to create, not for the lead session before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Source dispatch

Detect the input type from `$ARGUMENTS` and route to the appropriate source skill:

| If `$ARGUMENTS` is... | Hand off to |
|------------------------|-------------|
| A Notion **page** URL or page ID (single PRD) | `lisa:notion-to-tracker` (with the PRD URL; runs the full pipeline: extract artifacts → walk live product → validate → write tickets → coverage audit) |
| A Notion **database** URL or database ID | Stop and report — single-PRD mode only. Direct the caller to `lisa:intake` for batch scanning of a database. |
| A Confluence **page** URL containing `/wiki/spaces/<KEY>/pages/<ID>/...` (single PRD) | `lisa:confluence-to-tracker` (with the PRD URL; same full pipeline as the Notion path) |
| A Confluence **space** URL (`/wiki/spaces/<KEY>` with no `/pages/...`) | Stop and report — single-PRD mode only. Direct the caller to `lisa:intake` for batch scanning of a space. |
| A Linear **project** URL (`https://linear.app/<workspace>/project/<slug>-<id>`) | `lisa:linear-to-tracker` (with the project URL; same full pipeline as the Notion / Confluence paths). The Linear project's description, attached documents, and sub-issues form the PRD body. |
| A Linear **workspace** URL (`https://linear.app/<workspace>` with no `/project/...`) or **team** URL | Stop and report — single-PRD mode only. Direct the caller to `lisa:intake` for batch scanning of a workspace or team. |
| A JIRA ticket ID/URL of an Epic (existing epic *is* the spec) | `lisa:jira-agent` (read epic, decompose into stories/sub-tasks) |
| A GitHub **issue** URL (`https://github.com/<org>/<repo>/issues/<number>`) or `<org>/<repo>#<number>` token (single PRD) | `lisa:github-to-tracker` (with the issue ref; runs the full pipeline: extract artifacts → walk live product → validate → write tickets → coverage audit). The destination tracker is read from `.lisa.config.json` `tracker`. |
| A GitHub **repository** URL or `<org>/<repo>` token (no issue number) | Stop and report — single-PRD mode only. Direct the caller to `lisa:intake` for batch scanning of a GitHub repo. |
| A GitHub Issue URL of a build-side ticket (`type:Epic` / `type:Story` / etc., not `prd-*`-labelled) when `tracker = github` | `lisa:github-agent` (read issue, decompose into Sub-tasks). Symmetric counterpart to the JIRA-Epic branch above. |
| A file path (`@plan.md`, `./spec.md`) | Read the file as the spec; run the Plan flow's core decomposition with the file content as input. |
| A plain-text description | Use the description as the spec; run the Plan flow's core decomposition. |

If no PRD or specification exists, suggest running the `lisa:research` skill first to produce one.

## Flow

Execute the **Plan** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The rule contains the canonical step sequence (gates, sub-flows, output structure). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

## Output

Work items in the configured tracker (JIRA or GitHub Issues, per `.lisa.config.json` `tracker`) with acceptance criteria, dependencies, and recommended skills/agents per item. Ordered by dependency. If the specification cannot be decomposed without further clarification, stop and report what is missing.
