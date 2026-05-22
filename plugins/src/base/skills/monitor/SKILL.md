---
name: monitor
description: "Monitor application health across environments. Checks health endpoints, recent logs (CloudWatch / Sentry / browser console), error-rate spikes, performance hotspots, pending migrations, and runs Playwright smoke flows when relevant. Routes to the stack-specific ops-specialist agent (Expo, Rails, etc.). Also invoked as the post-deploy step of the lisa:verify skill."
allowed-tools: ["Skill", "Bash", "Read", "Grep"]
---

# Monitor: $ARGUMENTS

Spot-check application health in the named environment (`dev` / `staging` / `prod`). Useful both reactively (after a deploy, after a Sentry alert, before pushing a hot change) and as the post-deploy verification step inside `lisa:verify`.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use `TeamCreate` if available. In Claude, if `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema. If `TeamCreate` is not available, use the current runtime's tool-discovery mechanism (for Codex, `tool_search`) to discover available multi-agent/team tools, then call the appropriate team creation tool. If no team creation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion / Sentry), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Hitting health endpoints, pulling logs, querying Sentry — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

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
