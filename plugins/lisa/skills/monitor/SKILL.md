---
name: monitor
description: "Monitor application health across environments. Checks health endpoints, recent logs (CloudWatch / Sentry / browser console), error-rate spikes, performance hotspots, pending migrations, and runs Playwright smoke flows when relevant. Routes to the stack-specific ops-specialist agent (Expo, Rails, etc.). Also invoked as the post-deploy step of the lisa:verify skill."
allowed-tools: ["Skill", "Bash", "Read", "Grep"]
---

# Monitor: $ARGUMENTS

Spot-check application health in the named environment (`dev` / `staging` / `prod`). Useful both reactively (after a deploy, after a Sentry alert, before pushing a hot change) and as the post-deploy verification step inside `lisa:verify`.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), the very first thing you do is create the team. Two tool calls only, in this exact order:

1. `ToolSearch` with `query: "select:TeamCreate"` — `TeamCreate` is a deferred tool whose schema must be loaded before it can be invoked. A cold call returns `InputValidationError` and tempts a fallback to direct `Agent` calls, which bypasses the team.
2. `TeamCreate` — actually create the team.

Until `TeamCreate` returns successfully, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion / Sentry), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Hitting health endpoints, pulling logs, querying Sentry — all of those are tasks for the team you are about to create, not for the lead session before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

## Flow

Execute the **Monitor** sub-flow as defined in the `intent-routing` rule (loaded via the lisa plugin). The Monitor sub-flow delegates to a stack-specific `ops-specialist` agent (Expo, Rails, etc.), which composes the underlying ops skills:

- `ops-verify-health` — health endpoints
- `ops-check-logs` — CloudWatch / browser console / device / Serverless logs
- `ops-monitor-errors` — Sentry issues, error-rate spikes, regressions
- `ops-performance` — slow queries, p99 latency, hotspots
- `ops-browser-uat` — Playwright smoke flows against the deployed env
- `ops-db-ops` — pending migrations, replication lag
- `ops-deploy` — deploy status / rollback readiness

The agent decides which subset to run based on the env, the situation, and any extra context provided. The rule contains the canonical decision logic.

## Output

A health summary with the relevant findings (failures, warnings, no-issue confirmations). For post-deploy verification (when called from `lisa:verify`), the summary becomes evidence on the originating work item.
