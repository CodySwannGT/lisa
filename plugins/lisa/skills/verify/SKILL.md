---
name: verify
description: "Ship and verify code. Commits any pending changes, opens or updates the PR, handles the review loop, merges when green, monitors the deploy, and runs remote verification (health checks, Validation Journey replay, Sentry/log inspection) in the target environment. Folds in the legacy /ship alias."
allowed-tools: ["Skill", "Bash", "Read", "Grep", "Glob"]
---

# Verify: $ARGUMENTS

Ship the current branch and prove it works in the target environment.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation or subagent-delegation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude: use `TeamCreate`. If `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Inspecting the branch, running quality gates, opening the PR — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Flow

Execute the **Verify** flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The flow includes:

1. **Pre-flight: codification gate** — confirm that every passing local empirical verification on this branch was codified as a regression test (the Implement flow's codify step). If any verification has no committed test and no allowed skip reason (PR / Documentation / Deploy / Investigate-Only), invoke `codify-verification` now and amend the PR before shipping. A change cannot ship until its verifications are guarded.
2. **Commit** any pending changes via `lisa:git-commit`
3. **Push and PR** via `lisa:git-submit-pr`
4. **Review loop** — handle CodeRabbit / human review comments via `lisa:pull-request-review`
5. **Merge** when CI is green
6. **Remote verification** — invoke the `lisa:monitor` skill against the target environment to confirm the deploy actually works (health endpoints, recent logs/errors, Validation Journey replay if defined). If remote verification surfaces a behavioral gap that the existing codified tests do not guard, invoke `codify-verification` to add coverage and open a follow-up PR.
7. **Evidence usage** — before posting, route the generated evidence artifact through `lisa:usage-accounting` so the comment body / PR evidence section / markdown proof carries a direct `verify` usage entry in the canonical `## Lisa Usage` section. If the originating work item or PRD parentage is known, prefer `record_and_rollup` so ancestor totals refresh in the same pass. If runtime usage is unavailable, still write `source: unavailable` with nullable token/cost fields instead of skipping the row.
8. **Evidence** — post results to the originating ticket via `lisa:tracker-evidence` (vendor-neutral; dispatches to `lisa:jira-evidence`, `lisa:github-evidence`, or `lisa:linear-evidence` per `.lisa.config.json` `tracker`), including the list of codified tests added on this branch. **If the work is UI-visible** (any verification step ran in a browser, or the change touches a user-facing surface), author `evidence/comment.md` per the **UI Evidence Checklist** in `lisa:tracker-evidence` — numbered live-session steps, one Playwright-MCP screenshot per step uploaded to the GitHub `pr-assets` release as plain URLs, and an explicit invitation to be corrected.

The rule contains the canonical step sequence. Change it there, propagate everywhere.

## Output

A merged PR, a successful deploy to the target environment, and posted evidence on the originating work item.
