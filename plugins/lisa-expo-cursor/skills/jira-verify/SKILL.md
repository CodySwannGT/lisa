---
name: jira-verify
description: This skill should be used when verifying that a JIRA ticket meets organizational standards for epic relationships, description quality, and (for UI tickets) Validation Journey presence. It fetches the live ticket and delegates the gate checks to jira-validate-ticket so the bar matches what jira-write-ticket enforces pre-write.
allowed-tools: ["Skill", "mcp__atlassian__getJiraIssue", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Verify JIRA Ticket: $ARGUMENTS

Verify that the existing JIRA ticket `$ARGUMENTS` meets organizational standards. This skill is a thin post-write wrapper around `lisa:jira-validate-ticket`: it fetches the live ticket and asks `lisa:jira-validate-ticket` to run the gates against the fetched state.

This indirection exists so the gate definitions live in exactly one place (`lisa:jira-validate-ticket`). When the bar changes, change it there — `lisa:jira-verify`, `lisa:jira-write-ticket` (Phase 5.5 pre-write), and `lisa:notion-to-tracker` (PRD dry-run) all pick it up.

## Process

1. Resolve cloud ID via `mcp__atlassian__getAccessibleAtlassianResources`.
2. Fetch the ticket via `mcp__atlassian__getJiraIssue` for `$ARGUMENTS`.
3. Invoke `lisa:jira-validate-ticket` and pass the ticket key. The validator runs every gate (Specification + Feasibility) against the live state, including the Validation Journey check (S11) which applies to any runtime-behavior change — UI tickets in Expo always qualify.
4. Surface the validator's report verbatim.

## Output

Pass through `lisa:jira-validate-ticket`'s structured output unchanged. Downstream callers parse the gate lines.

## Notes

- This skill is read-only. It never edits the ticket, posts comments, or changes status.
- For UI tickets that fail the Validation Journey gate, the validator's remediation will recommend `/lisa:jira-add-journey` — the Expo flavor of `lisa:jira-add-journey` produces the `[SCREENSHOT: ...]` + viewport block that the Playwright-based journey runner consumes.
