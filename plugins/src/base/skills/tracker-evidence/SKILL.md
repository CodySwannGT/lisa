---
name: tracker-evidence
description: "Vendor-neutral wrapper for posting verification evidence. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-evidence or lisa:github-evidence. Uploads evidence to the GitHub `pr-assets` release, updates the PR description, posts a comment on the originating ticket/issue, and transitions the ticket/issue to its post-build review state."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Evidence: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor evidence skill.

See the `tracker-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-evidence` with `$ARGUMENTS` verbatim. Arg shape: `<TICKET_ID> <EVIDENCE_DIR> <PR_NUMBER>`.
   - `github` → invoke `lisa:github-evidence` with `$ARGUMENTS` verbatim. Arg shape: `<ISSUE_REF> <EVIDENCE_DIR> <PR_NUMBER>` where `ISSUE_REF` is `org/repo#<number>` or a GitHub issue URL.
3. Pass through the vendor skill's output.

## Rules

- The GitHub `pr-assets` release lives on the implementation repo (the one with the PR), regardless of which tracker hosts the ticket/issue. Both vendor skills upload there.
- Never post evidence to a different ticket than the one named — `$ARGUMENTS` is the source of truth.
