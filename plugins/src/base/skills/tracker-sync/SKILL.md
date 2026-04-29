---
name: tracker-sync
description: "Vendor-neutral wrapper for posting milestone updates to the linked ticket/issue. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-sync or lisa:github-sync. Posts at: plan created, implementation in progress, PR ready, PR merged. Suggests (never auto-transitions) the next status."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Sync: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor sync skill.

See the `tracker-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-sync` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa:github-sync` with `$ARGUMENTS` verbatim.
3. Pass through the output.

If `$ARGUMENTS` is empty, both vendor skills auto-detect a ticket reference from the active plan file (most recently modified `.md` in `plans/`).

## Rules

- Idempotent updates — running sync at the same milestone twice should not produce duplicate comments. Vendor skills enforce this.
- Never auto-transition status. Suggestions only.
