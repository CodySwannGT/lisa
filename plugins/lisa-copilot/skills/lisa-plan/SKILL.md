---
name: lisa-plan
description: "Break one PRD or spec into ordered work items in the project's tracker. Accepts a PRD URL, epic key, markdown file, or description. For scanning every ready PRD in a queue, use lisa-intake."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Plan: $ARGUMENTS

Decompose the PRD/spec at `$ARGUMENTS` into ordered work items with acceptance criteria, dependencies, and recommended skills/agents.

## How to work

Do the work yourself, in this session. Delegate to a subagent only when a piece of work is sizeable and genuinely independent, such as a wide codebase investigation — and give it the exact result you need back. Do not delegate work you can finish in a handful of tool calls.

`lisa-intake` invokes this skill in its own session; treat that exactly like a direct invocation.


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

Execute the **Plan** flow as defined in the `intent-routing` reference rule (read on demand). The rule contains the canonical step sequence (gates, sub-flows, output structure). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

**Learned planning checks.** Whichever source skill runs the decomposition, it runs `lisa-task-decomposition` step 0 first: the `Planning (prd|decomposition|ready-gate)` checks that `learning-judge` persisted each time a dispatched worker still had to stop for a human or file a ticket mid-build, loaded through the learnings contract's bounded projection. For a file or plain-text spec, run that step yourself before decomposing. Planning that ignores them repeats the gap that stopped the last worker.

## Capture learnings

Before returning, list what this run learned the hard way that a later run in this project would otherwise relearn — a misleading source, a tool or access that was missing, a step that failed and why. Route each through `lisa-persist-learning` with `rule`, `why`, `provenance`, and `triggering_issue` set to the source PRD or spec. Its judge drops most candidates; that is expected, and zero candidates is a valid result. Never write the ledger or any rule file directly.

## Output

Work items in the configured tracker (JIRA, GitHub Issues, or Linear, per `.lisa.config.json` `tracker`) with acceptance criteria, dependencies, and recommended skills/agents per item. Ordered by dependency. Before finishing, route usage writes through `lisa-usage-accounting`: record the Plan run as a direct entry on the source PRD/spec artifact, attach a plan usage entry (or an explicit `source: unavailable` entry with nullable token/cost fields) to each created work item, and refresh the PRD rollup after `lisa-prd-backlink` regenerates the `## Tickets` child refs. Do not invent plan-specific ledger formats or omit missing usage silently. If the specification cannot be decomposed without further clarification, stop and report what is missing.
