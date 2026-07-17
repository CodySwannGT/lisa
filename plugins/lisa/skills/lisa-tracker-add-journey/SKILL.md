---
name: lisa-tracker-add-journey
description: "Vendor-neutral wrapper for appending a Validation Journey section to an existing ticket/issue. Reads the required `tracker` from .lisa.config.json and dispatches to lisa-jira-add-journey, lisa-github-add-journey, or lisa-linear-add-journey."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Add Journey: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa-tracker-write`).
2. Dispatch:
   - Missing / empty → stop and report `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` → invoke `lisa-jira-add-journey` with `$ARGUMENTS` verbatim. Arg: a JIRA ticket key.
   - `github` → invoke `lisa-github-add-journey` with `$ARGUMENTS` verbatim. Arg: `org/repo#<number>` or a GitHub issue URL.
   - `linear` → invoke `lisa-linear-add-journey` with `$ARGUMENTS` verbatim. Arg: a Linear Issue identifier (e.g., `ENG-123`).
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the output.

## Rules

- The Validation Journey content format is identical across all vendors (markdown sections with typed `[EVIDENCE: <artifact-type>: <name>]` markers per the `verification` rule taxonomy). The only difference is how the section is appended — JIRA via `editJiraIssue` (Jira wiki markup), GitHub via `gh issue edit --body-file` (markdown), Linear via `save_issue` (markdown).
- A cross-work-item pointer uses `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]`. It is non-claiming and never replaces a runtime-changing leaf's local S14 marker.
- If the ticket already has a Validation Journey with at least one local typed `[EVIDENCE: ...]` marker, the vendor skill reports it and stops. A reference-only journey is incomplete; the vendor skill preserves its prose and appends the missing local evidence. This shim does not retry.
