---
name: monitor
description: "Monitor application health across environments. Checks health endpoints, recent logs (CloudWatch / Sentry / browser console), error-rate spikes, performance hotspots, pending migrations, and runs Playwright smoke flows when relevant. Routes to the stack-specific ops-specialist agent (Expo, Rails, etc.). Also invoked as the post-deploy step of the lisa:verify skill."
allowed-tools: ["Skill", "Bash", "Read", "Grep"]
---

# Monitor: $ARGUMENTS

Spot-check application health in the named environment (`dev` / `staging` / `prod`). Useful both reactively (after a deploy, after a Sentry alert, before pushing a hot change) and as the post-deploy verification step inside `lisa:verify`.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation or subagent-delegation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude: use `TeamCreate`. If `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion / Sentry), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Hitting health endpoints, pulling logs, querying Sentry — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

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
