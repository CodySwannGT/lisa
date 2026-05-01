---
name: verify
description: "Ship and verify code. Commits any pending changes, opens or updates the PR, handles the review loop, merges when green, monitors the deploy, and runs remote verification (health checks, Validation Journey replay, Sentry/log inspection) in the target environment. Folds in the legacy /ship alias."
allowed-tools: ["Skill", "Bash", "Read", "Grep", "Glob"]
---

# Verify: $ARGUMENTS

Ship the current branch and prove it works in the target environment.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), the very first thing you do is create the team. Two tool calls only, in this exact order:

1. `ToolSearch` with `query: "select:TeamCreate"` — `TeamCreate` is a deferred tool whose schema must be loaded before it can be invoked. A cold call returns `InputValidationError` and tempts a fallback to direct `Agent` calls, which bypasses the team.
2. `TeamCreate` — actually create the team.

Until `TeamCreate` returns successfully, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Inspecting the branch, running quality gates, opening the PR — all of those are tasks for the team you are about to create, not for the lead session before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Flow

Execute the **Verify** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The flow includes:

1. **Pre-flight: codification gate** — confirm that every passing local empirical verification on this branch was codified as a regression test (the Implement flow's codify step). If any verification has no committed test and no allowed skip reason (PR / Documentation / Deploy / Investigate-Only), invoke `codify-verification` now and amend the PR before shipping. A change cannot ship until its verifications are guarded.
2. **Commit** any pending changes via `lisa:git-commit`
3. **Push and PR** via `lisa:git-submit-pr`
4. **Review loop** — handle CodeRabbit / human review comments via `lisa:pull-request-review`
5. **Merge** when CI is green
6. **Remote verification** — invoke the `lisa:monitor` skill against the target environment to confirm the deploy actually works (health endpoints, recent logs/errors, Validation Journey replay if defined). If remote verification surfaces a behavioral gap that the existing codified tests do not guard, invoke `codify-verification` to add coverage and open a follow-up PR.
7. **Evidence** — post results to the originating ticket via `lisa:tracker-evidence` (vendor-neutral; dispatches to `lisa:jira-evidence` or `lisa:github-evidence` per `.lisa.config.json` `tracker`), including the list of codified tests added on this branch.

The rule contains the canonical step sequence. Change it there, propagate everywhere.

## Output

A merged PR, a successful deploy to the target environment, and posted evidence on the originating work item.
