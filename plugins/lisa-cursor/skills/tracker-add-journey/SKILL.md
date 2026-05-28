---
name: tracker-add-journey
description: "Vendor-neutral wrapper for appending a Validation Journey section to an existing ticket/issue. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-add-journey, lisa:github-add-journey, or lisa:linear-add-journey."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Add Journey: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-add-journey` with `$ARGUMENTS` verbatim. Arg: a JIRA ticket key.
   - `github` → invoke `lisa:github-add-journey` with `$ARGUMENTS` verbatim. Arg: `org/repo#<number>` or a GitHub issue URL.
   - `linear` → invoke `lisa:linear-add-journey` with `$ARGUMENTS` verbatim. Arg: a Linear Issue identifier (e.g., `ENG-123`).
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the output.

## Rules

- The Validation Journey content format is identical across all vendors (markdown sections with `[EVIDENCE: name]` markers). The only difference is how the section is appended — JIRA via `editJiraIssue` (Jira wiki markup), GitHub via `gh issue edit --body-file` (markdown), Linear via `save_issue` (markdown).
- If the ticket already has a Validation Journey, the vendor skill reports it and stops. This shim does not retry.
