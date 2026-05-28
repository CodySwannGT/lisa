---
name: github-verify
description: This skill should be used when verifying that a GitHub Issue meets organizational standards for parent-sub-issue relationships and description quality. It fetches the live issue and delegates the gate checks to github-validate-issue so the bar matches what github-write-issue enforces pre-write. The GitHub counterpart of lisa:jira-verify.
allowed-tools: ["Skill", "Bash"]
---

# Verify GitHub Issue: $ARGUMENTS

Verify that the existing GitHub Issue `$ARGUMENTS` (`org/repo#<number>` or full URL) meets organizational standards. This skill is a thin post-write wrapper around `lisa:github-validate-issue`: it fetches the live issue and asks the validator to run the gates against the fetched state.

This indirection exists so the gate definitions live in exactly one place (`lisa:github-validate-issue`). When the bar changes, change it there — `lisa:github-verify`, `lisa:github-write-issue` (Phase 5.5 pre-write), and `lisa:github-to-tracker` (PRD dry-run) all pick it up.

## Process

1. Confirm `gh auth status` succeeds.
2. Parse `$ARGUMENTS`. Resolve `<org>`, `<repo>`, `<number>`.
3. Fetch the issue via `gh issue view <number> --repo <org>/<repo> --json number,title,body,labels,state,milestone,assignees,author,createdAt,updatedAt,closed,closedAt,url`.
4. Invoke `lisa:github-validate-issue` and pass the issue ref. The validator fetches its own copy and runs every gate (Specification + Feasibility) against the live state.
5. Surface the validator's report verbatim to the caller.

## Output

Pass through `lisa:github-validate-issue`'s structured output unchanged. Do not summarize or paraphrase — downstream callers (e.g. `lisa:github-agent`'s pre-flight gate) parse the gate lines.

## Notes

- This skill is read-only. It never edits the issue, posts comments, or changes labels.
- If a gate fails, the recommendation is part of the validator's report; surface it as-is.
- The Validation Journey check (S11) parses the `## Validation Journey` markdown section — same parser logic as `lisa:github-add-journey` and `lisa:github-journey`.
