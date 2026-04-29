---
name: tracker-journey
description: "Vendor-neutral wrapper for executing a ticket/issue's Validation Journey end-to-end. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-journey or lisa:github-journey. Parses the journey, satisfies prerequisites, executes the steps, captures evidence at each marker, and posts results via tracker-evidence."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Journey: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor journey skill.

See the `tracker-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-journey` with `$ARGUMENTS` verbatim. Arg shape: `<TICKET_ID> [PR_NUMBER]`.
   - `github` → invoke `lisa:github-journey` with `$ARGUMENTS` verbatim. Arg shape: `<ISSUE_REF> [PR_NUMBER]`.
3. Pass through the output.

## Rules

- The journey content is identical across vendors; only the parser source differs (the JIRA vendor reads description via Atlassian MCP; the GitHub vendor reads body via `gh issue view --json body`).
- Evidence posting always goes through `lisa:tracker-evidence` — never bypass.
