---
name: lisa-monitor
description: "Monitor application health AND…"
allowed-tools: ["Skill", "Bash", "Read", "Grep", "Glob"]
---

# Monitor: $ARGUMENTS

Spot-check application health, **audit observability completeness**, and **file build-ready tickets** for the problems and instrumentation gaps it finds — all scoped to the current repo. Useful reactively (after a deploy, after a Sentry alert, before pushing a hot change), as a periodic manual observability sweep, and as the post-deploy verification step inside `lisa-verify`.

**Arguments:** `<environment>` (`dev` / `staging` / `prod`) `[--dry-run] [--report-only] [--all-gaps] [max_candidates=<n>]`.

- `--dry-run` — audit and report which tickets *would* be filed, but create nothing.
- `--report-only` — health/audit summary only; no filing and no would-file analysis. This is the mode `lisa-verify` passes for its post-deploy check, so monitor never files during a verify run.
- `--all-gaps` — also file `recommended`-tier gaps (session replay, product analytics, etc.), not just `core`. Does not change anomaly thresholds.
- `max_candidates=<n>` — cap tickets filed this run (default 20; config `monitor.maxCandidates`).

## Monitor threshold compatibility

Before resolving anomaly thresholds, inspect the committed
`.lisa.config.json` and local `.lisa.config.local.json` separately with `jq`.
Use a literal, fixed-path projection that returns presence and value for only
these four exact paths; do not use `Read`, `cat`, interpolation, or a filter
that emits either entire config into agent context:

- `monitor.thresholds.minEvents24h`, then
  `monitor.thresholds.sentryMinEvents24h`.
- `monitor.thresholds.faultRatePct`, then
  `monitor.thresholds.xrayFaultRatePct`.

Run this fixed filter once with literal final argument `.lisa.config.json` and
once with literal final argument `.lisa.config.local.json` when the respective
file exists:

```bash
jq 'def threshold($object; $name):
    if ($object | has($name)) then
      ($object[$name] | type) as $type |
      if $type == "number" then
        if ($object[$name] | isfinite and (isnan | not)) then
          {present: true, valid: true, type: "number", value: $object[$name]}
        else
          {present: true, valid: false, type: "non-finite-number"}
        end
      else
        {present: true, valid: false, type: $type}
      end
    else
      {present: false, valid: false, type: "missing"}
    end;
  (.monitor.thresholds | if type == "object" then . else {} end) as $t |
  {
    "monitor.thresholds.minEvents24h": threshold($t; "minEvents24h"),
    "monitor.thresholds.sentryMinEvents24h": threshold($t; "sentryMinEvents24h"),
    "monitor.thresholds.faultRatePct": threshold($t; "faultRatePct"),
    "monitor.thresholds.xrayFaultRatePct": threshold($t; "xrayFaultRatePct")
  }' .lisa.config.json
```

A nonzero `jq` result fails threshold collection; do not treat an uninspectable
present file as if it were absent.

For each exact path, keep the raw `jq` presence/value result from each file;
do not inject defaults during this merge. Local presence overrides committed
presence per path. After that merge, resolve the current key before the legacy
key, then use default `1` for `monitor.thresholds.minEvents24h` or default `5`
for `monitor.thresholds.faultRatePct`. Current key wins over legacy key even
when its configured value is invalid.

Every configured threshold must be a finite JSON number. If the selected path
is null, a string, a boolean, an object, an array, or otherwise non-finite,
fail threshold collection and report the exact path and source without echoing
the invalid value; never fall through to a legacy value or default. Never quote
or report either whole config. The fixed `jq` projection itself must redact
invalid configured content: it emits only presence, validity, and a fixed type
classification, and includes the numeric `value` field only for a finite number.
For a valid resolution, the monitor report must include the resolved value and
source. Report only a validated numeric resolved value and one fixed source enum:
`local-current`, `committed-current`, `local-legacy`, `committed-legacy`, or
`default`.

## Orchestration: agent team

You are "inside an agent team" only if you are yourself a spawned teammate or subagent — you were spawned into a team context, or your context names a team lead you report to. A lead/root session that has previously spawned subagents is still the lead and retains full authority to create this flow's team.

If you are NOT inside an agent team by that definition, the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude Code >= 2.1.178: there is no `TeamCreate` tool; the team forms automatically when you spawn the first teammate with `Agent`. That first spawn should be the bounded specialist needed to start this flow. On older Claude Code that still exposes `TeamCreate`, the explicit team-create path is also acceptable.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion / Sentry), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. The initial Claude `Agent` spawn described above is the only pre-team exception because it establishes the team. Hitting health endpoints, pulling logs, querying Sentry — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline.

## Flow

Execute the **Monitor** sub-flow as defined in the `intent-routing` rule (loaded via the lisa plugin): **discover → collect live signals → audit completeness → report → file (standalone only)**. The `observability-audit` rule owns the profile detection, the completeness rubric, the conservative anomaly thresholds, the gate-passing ticket templates, the fingerprint/idempotency contract, the cap, and the Verify report-only guard — follow it; do not restate it here.

**Live-signal collection** delegates to a stack-specific `ops-specialist` agent when the stack overlay ships one. The **Expo** ops-specialist composes the full set below:

- `ops-verify-health` — health endpoints
- `ops-check-logs` — CloudWatch / browser console / device / Serverless logs
- `ops-monitor-errors` — Sentry issues, error-rate spikes, regressions
- `ops-performance` — slow queries, p99 latency, hotspots
- `ops-browser-uat` — Playwright smoke flows against the deployed env
- `ops-db-ops` — pending migrations, replication lag
- `ops-deploy` — deploy status / rollback readiness

The **Rails** ops-specialist composes a different subset (`ops-run-local`, `ops-deploy`, `ops-check-logs`, `ops-verify-jobs`, `ops-verify-telemetry` — X-Ray/CloudWatch traces and metrics via `ops-verify-telemetry`). When no `ops-specialist` overlay is present (e.g. NestJS, CDK, or a generic TypeScript repo), fall back to **stack-agnostic base probing** — read manifests/config to discover what's wired, then probe live sources directly (Sentry CLI/REST, `aws logs` / `aws cloudwatch` / `aws xray`, the Playwright MCP for client-side console/network), exactly as the `observability-audit` "read-then-probe" detection prescribes. The agent decides which subset to run based on the env, the repo profile, and any extra context.

## Ticket filing (standalone only)

After report, file what was found — **only when run standalone**, never under `--report-only`/`--dry-run` and never when nested inside `lisa-verify` (which passes `--report-only`):

- **Anomalies** (live signals over the conservative bar) → `Bug` leaves. **Gaps** (in-scope MISSING rubric dimensions) → `Task`/`Improvement` leaves.
- Every ticket is filed via the vendor-neutral `lisa-tracker-write` shim with `build_ready: true` (never a vendor write skill directly), as a **single-repo leaf** stamped `repo:<current>`, with a real three-audience description, Gherkin AC, Target Backend Environment, and a Validation Journey + typed `[EVIDENCE: <artifact-type>: <name>]` marker (e.g. `[EVIDENCE: log-snippet: alert-cleared]`) so it passes the `tracker-validate` gates.
- **Idempotent:** embed the `<!-- lisa:monitor-finding: <fingerprint> -->` sentinel and search-before-create; never duplicate a live or just-resolved finding.
- **Capped** at `max_candidates` (default 20), `core`/high-severity first; report how many were filed vs dropped.
- **`--dry-run`** previews would-file tickets and creates nothing. **`--all-gaps`** widens gap filing to `recommended` tiers.

`monitor` files only. The `intake` / `tracker-build-intake` cron picks the ready tickets up and implements them.

## Output

A single report: the health/anomaly summary (failures, warnings, no-issue confirmations) + the observability audit table (each in-scope dimension as `OK` / `WARN` / `MISSING` / `PRESENT (unverified)`) + the filing summary (tickets filed with refs + fingerprints, duplicates skipped, dropped count if the cap truncated; or would-file tickets under `--dry-run`). For post-deploy verification (when called from `lisa-verify`), the report-only summary becomes evidence on the originating work item.
