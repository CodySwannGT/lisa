---
name: tracker-create
description: "Vendor-neutral wrapper for creating tickets/issues from code files or descriptions. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-create, lisa:github-create, or lisa:linear-create. Plans hierarchy structure (epic / story / sub-task), then delegates each individual write through the tracker-write shim."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Create: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor planning skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-create` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa:github-create` with `$ARGUMENTS` verbatim.
   - `linear` → invoke `lisa:linear-create` with `$ARGUMENTS` verbatim.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the output.

## Rules

- All vendor skills delegate every individual ticket write through `lisa:tracker-write`. They never call vendor-specific write tools directly.
- This shim is for ad-hoc creation from code files / descriptions. PRD-driven creation goes through the `*-to-tracker` skills (notion / confluence / linear / github).
