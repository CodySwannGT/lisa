---
name: jira-verify
description: This skill should be used when verifying that a JIRA ticket meets organizational standards for epic relationships and description quality. It fetches the live ticket and delegates the gate checks to jira-validate-ticket so the bar matches what jira-write-ticket enforces pre-write.
allowed-tools: ["Skill", "mcp__atlassian__getJiraIssue", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Verify JIRA Ticket: $ARGUMENTS

Verify that the existing JIRA ticket `$ARGUMENTS` meets organizational standards. This skill is a thin post-write wrapper around `lisa:jira-validate-ticket`: it fetches the live ticket and asks `lisa:jira-validate-ticket` to run the gates against the fetched state.

This indirection exists so the gate definitions live in exactly one place (`lisa:jira-validate-ticket`). When the bar changes, change it there — `lisa:jira-verify`, `lisa:jira-write-ticket` (Phase 5.5 pre-write), and `lisa:notion-to-tracker` (PRD dry-run) all pick it up.

## Process

1. Resolve cloud ID via `mcp__atlassian__getAccessibleAtlassianResources`.
2. Fetch the ticket via `mcp__atlassian__getJiraIssue` for `$ARGUMENTS`. Pull issue type, summary, description, parent, links, labels, components, and any custom fields needed.
3. Invoke `lisa:jira-validate-ticket` and pass the ticket key. The validator fetches its own copy if needed and runs every gate (Specification + Feasibility) against the live state.
4. Surface the validator's report verbatim to the caller.

## Output

Pass through `lisa:jira-validate-ticket`'s structured output unchanged. Do not summarize or paraphrase — downstream callers (e.g. `lisa:jira-agent`'s pre-flight gate) parse the gate lines.

## Notes

- This skill is read-only. It never edits the ticket, posts comments, or changes status.
- If a gate fails, the recommendation is part of the validator's report; surface it as-is.
- Validation Journey checks (S11) historically required a parser script (`parse-plan.py`); the parser logic now lives inside `lisa:jira-validate-ticket` so this skill no longer shells out to it.
