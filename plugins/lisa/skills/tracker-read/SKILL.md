---
name: tracker-read
description: "Vendor-neutral wrapper for fetching the full scope of a ticket/issue and its related graph. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-read-ticket, lisa:github-read-issue, or lisa:linear-read-issue. Returns a consolidated context bundle so downstream agents never act on a single ticket in isolation."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Read: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor read skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-read-ticket` with `$ARGUMENTS` verbatim. The argument is a JIRA key (e.g., `PROJ-123`).
   - `github` → invoke `lisa:github-read-issue` with `$ARGUMENTS` verbatim. The argument is `org/repo#<number>` or a full GitHub issue URL.
   - `linear` → invoke `lisa:linear-read-issue` with `$ARGUMENTS` verbatim. The argument is a Linear identifier (e.g., `ENG-123`) or a project URL.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Return the vendor skill's context bundle verbatim.

## Rules

- Read-only — never modify the ticket/issue.
- The three vendors emit different context-bundle formats (because their data models differ). Callers must be tolerant of all — or, more precisely, agents at the next layer parse the per-vendor bundle.
- If the input format doesn't match the configured tracker (e.g. tracker is jira but `$ARGUMENTS` looks like a Linear identifier), stop and report — never auto-translate.
