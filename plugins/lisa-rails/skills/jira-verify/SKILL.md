---
name: jira-verify
description: This skill should be used when verifying that a JIRA ticket meets organizational standards for epic relationships and description quality. It fetches the live ticket and delegates the gate checks to jira-validate-ticket so the bar matches what jira-write-ticket enforces pre-write.
allowed-tools: ["Skill", "mcp__atlassian__getJiraIssue", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Verify JIRA Ticket: $ARGUMENTS

Verify that the existing JIRA ticket `$ARGUMENTS` meets organizational standards. This skill is a thin post-write wrapper around `jira-validate-ticket`: it fetches the live ticket and asks `jira-validate-ticket` to run the gates against the fetched state.

This indirection exists so the gate definitions live in exactly one place (`jira-validate-ticket`). When the bar changes, change it there — `jira-verify`, `jira-write-ticket` (Phase 5.5 pre-write), and `notion-to-jira` (PRD dry-run) all pick it up.

## Process

1. Resolve cloud ID via `mcp__atlassian__getAccessibleAtlassianResources`.
2. Fetch the ticket via `mcp__atlassian__getJiraIssue` for `$ARGUMENTS`.
3. Invoke `jira-validate-ticket` and pass the ticket key. The validator runs every gate (Specification + Feasibility) against the live state.
4. Surface the validator's report verbatim.

## Output

Pass through `jira-validate-ticket`'s structured output unchanged. Downstream callers parse the gate lines.

## Notes

- This skill is read-only. It never edits the ticket, posts comments, or changes status.
