---
name: verify
description: "Ship and verify code. Commits any pending changes, opens or updates the PR, handles the review loop, merges when green, monitors the deploy, and runs remote verification (health checks, Validation Journey replay, Sentry/log inspection) in the target environment. Folds in the legacy /ship alias."
allowed-tools: ["Skill", "Bash", "Read", "Grep", "Glob"]
---

# Verify: $ARGUMENTS

Ship the current branch and prove it works in the target environment.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Flow

Execute the **Verify** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The flow includes:

1. **Commit** any pending changes via `lisa:git-commit`
2. **Push and PR** via `lisa:git-submit-pr`
3. **Review loop** — handle CodeRabbit / human review comments via `lisa:pull-request-review`
4. **Merge** when CI is green
5. **Remote verification** — invoke the `lisa:monitor` skill against the target environment to confirm the deploy actually works (health endpoints, recent logs/errors, Validation Journey replay if defined)
6. **Evidence** — post results to the originating ticket via `lisa:jira-evidence` (or equivalent tracker adapter)

The rule contains the canonical step sequence. Change it there, propagate everywhere.

## Output

A merged PR, a successful deploy to the target environment, and posted evidence on the originating work item.
