---
name: tracker-add-journey
description: "Vendor-neutral wrapper for appending a Validation Journey section to an existing ticket/issue. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-add-journey or lisa:github-add-journey."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Add Journey: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor skill.

See the `tracker-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-add-journey` with `$ARGUMENTS` verbatim. Arg: a JIRA ticket key.
   - `github` → invoke `lisa:github-add-journey` with `$ARGUMENTS` verbatim. Arg: `org/repo#<number>` or a GitHub issue URL.
3. Pass through the output.

## Rules

- The Validation Journey content format is identical across both vendors (markdown sections with `[EVIDENCE: name]` markers). The only difference is how the section is appended — JIRA via `editJiraIssue`, GitHub via `gh issue edit --body-file`.
- If the ticket already has a Validation Journey, the vendor skill reports it and stops. This shim does not retry.
