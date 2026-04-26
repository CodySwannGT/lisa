---
description: "Plan work. Vendor-agnostic intake — given a PRD URL/path or description, extracts requirements, walks the live product, validates, and creates work items in the configured tracker."
argument-hint: "<PRD-url | @file | ticket-id-or-url | description>"
---

Apply the `intent-routing` rule (loaded via the lisa plugin) and execute the **Plan** flow.

**Orchestration: agent team.** Plan is a multi-specialist flow feeding a shared decomposition. After echoing the flow and orchestration mode, your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

## Source dispatch

Detect the source type from `$ARGUMENTS` and route accordingly. The Plan flow is vendor-agnostic — the public interface speaks "PRD" and "work items", not "Notion" or "JIRA".

| If `$ARGUMENTS` is... | Hand off to |
|------------------------|-------------|
| A Notion URL (`notion.so/...` or a Notion database/page ID) | The `notion-prd-intake` skill (single-PRD mode if one page; database-scan mode if a database URL). It runs the full pipeline: extract artifacts, walk live product, dry-run validate, create tickets in the configured tracker, run the coverage audit, transition Notion `Status`. |
| A JIRA ticket ID or URL (e.g. `SE-123` or `*.atlassian.net/browse/SE-123`) | The `jira-agent`, which reads the ticket and extracts context. (Used when an existing JIRA epic *is* the spec — Plan decomposes it into stories/sub-tasks.) |
| A Linear / GitHub Issues URL or key | *Not yet implemented.* Stop and tell the user the adapter doesn't exist yet — the architecture supports it, but no `linear-prd-intake` / `github-prd-intake` skill has been built. Don't fall back. |
| A file path (`@plan.md`, `./spec.md`) | Read the file as the spec; run the Plan flow's core decomposition with the file content as input. |
| A plain-text description | Use the description as the spec; run the Plan flow's core decomposition. |

If no PRD or specification exists, suggest running the **Research** flow first to produce one.

The underlying intake skills (e.g. `notion-prd-intake`) are internal — developers don't invoke them directly. They speak in vendor-agnostic terms (`/plan <PRD>`); the source/tracker choice is config.

$ARGUMENTS
