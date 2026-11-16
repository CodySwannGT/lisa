---
name: lisa-tracker-journey
description: "Run a ticket's Validation…"
allowed-tools: ["Skill", "Bash", "Read"]
---
Run a ticket's Validation Journey end to end in whichever tracker the project uses: satisfy prerequisites, perform the steps, capture evidence at each marker, and post the results.


# Tracker Journey: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor journey skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa-tracker-write`).
   Then, when an installed stack plugin ships a `journey-guidance` skill (the Expo and Rails plugins do), invoke it and carry its guidance — how to satisfy prerequisites, run the steps (for example, once per viewport), and name the captured evidence — into the vendor skill below. It is tracker-neutral, so it applies to `jira`, `github`, and `linear` alike. When no stack plugin ships one, continue with the base behaviour; that is not an error.
2. Dispatch:
   - Missing / empty → stop and report `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` → invoke `lisa-jira-journey` with `$ARGUMENTS` verbatim. Arg shape: `<TICKET_ID> [PR_NUMBER]`.
   - `github` → invoke `lisa-github-journey` with `$ARGUMENTS` verbatim. Arg shape: `<ISSUE_REF> [PR_NUMBER]`.
   - `linear` → invoke `lisa-linear-journey` with `$ARGUMENTS` verbatim. Arg shape: `<IDENTIFIER> [PR_NUMBER]`.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the output.

## Rules

- The journey content is identical across vendors; only the parser source differs (the JIRA vendor reads description via Atlassian MCP; the GitHub vendor reads body via `gh issue view --json body`; the Linear vendor reads description via `lisa-linear-access operation: get-issue`).
- Evidence posting always goes through `lisa-tracker-evidence` — never bypass.
