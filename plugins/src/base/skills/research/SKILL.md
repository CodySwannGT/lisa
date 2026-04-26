---
name: research
description: "Research a problem space and produce a PRD. Investigates the codebase, defines user flows, assesses technical feasibility, and outputs a specification ready to hand to the Plan flow. Vendor-agnostic — the resulting PRD lands wherever the configured destination is (Notion, Confluence, file, etc.)."
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# Research

Produce a PRD for the problem in `$ARGUMENTS`.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Flow

Execute the **Research** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The rule contains the canonical step sequence (gates, sub-flows, deliverables). This skill does NOT restate flow steps — change them in the rule, propagate everywhere.

## Output

A PRD that includes (per the intent-routing rule's Research flow definition): context, problem statement, user flows, acceptance criteria, technical feasibility notes, and any open questions. The PRD lands in the configured destination (Notion database, Confluence space, local markdown file) per project config. The Plan flow consumes it next.
