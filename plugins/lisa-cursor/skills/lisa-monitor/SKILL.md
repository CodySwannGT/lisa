---
name: lisa-monitor
description: "Monitor application health AND audit observability completeness for the current repo, then file build-ready tickets for what it finds. Checks health endpoints, recent logs (CloudWatch / Sentry / browser console), error-rate spikes, performance hotspots, pending migrations, and Playwright smoke flows via the stack-specific ops-specialist (Expo, Rails) or stack-agnostic base probing (any stack, incl. NestJS / CDK). Audits the repo against an observability-completeness rubric scoped to its type (frontend / backend / infra) and flags instrumentation gaps (e.g. no distributed tracing, no DB/query analytics). For each high-signal anomaly and each in-scope missing dimension it files a single-repo, build-ready leaf ticket via tracker-write (idempotent, capped, repo-scoped) so the intake cron implements it — monitor files only, it never fixes. Manual (no cron); files by default, `--dry-run` previews. Conservative by default. Also invoked as the post-deploy step of lisa-verify, where it runs report-only (never files)."
allowed-tools: ["Skill", "Bash", "Read", "Grep", "Glob"]
---

# Monitor: $ARGUMENTS

Spot-check application health, **audit observability completeness**, and **file build-ready tickets** for the problems and instrumentation gaps it finds — all scoped to the current repo. Useful reactively (after a deploy, after a Sentry alert, before pushing a hot change), as a periodic manual observability sweep, and as the post-deploy verification step inside `lisa-verify`.

**Arguments:** `<environment>` (`dev` / `staging` / `prod`) `[--dry-run] [--report-only] [--all-gaps] [max_candidates=<n>]`.

- `--dry-run` — audit and report which tickets *would* be filed, but create nothing.
- `--report-only` — health/audit summary only; no filing and no would-file analysis. This is the mode `lisa-verify` passes for its post-deploy check, so monitor never files during a verify run.
- `--all-gaps` — also file `recommended`-tier gaps (session replay, product analytics, etc.), not just `core`. Does not change anomaly thresholds.
- `max_candidates=<n>` — cap tickets filed this run (default 20; config `monitor.maxCandidates`).

## Deprecated monitor threshold aliases

Before resolving anomaly thresholds, inspect the committed
`.lisa.config.json` and local `.lisa.config.local.json` separately with `jq`.
Use a literal, fixed-path projection that returns presence and value for only
these four exact paths; do not use `Read`, `cat`, interpolation, or a filter
that emits either entire config into agent context:

- `monitor.thresholds.minEvents24h`, then
  `monitor.thresholds.sentryMinEvents24h`.
- `monitor.thresholds.faultRatePct`, then
  `monitor.thresholds.xrayFaultRatePct`.

The provider-neutral keys are the current contract. The legacy
provider-prefixed keys are deprecated compatibility aliases and are used only
when the matching provider-neutral key is absent.

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

For a configured non-production DOM environment with mutation policy `full`, `ops-browser-uat` or the stack-agnostic fallback may invoke `lisa-kane-browser` after `lisa kane probe` succeeds. Use the normalized outcome and local evidence pack; a Kane tool/auth/upload/schema failure is `PRESENT (unverified)` or a tooling warning, never an application anomaly. Under `--report-only`, Kane remains report-only too and cannot file tickets directly.

## Ticket filing (standalone only)

After report, file what was found — **only when run standalone**, never under `--report-only`/`--dry-run` and never when nested inside `lisa-verify` (which passes `--report-only`):

- **Anomalies** (live signals over the conservative bar) → `Bug` leaves. **Gaps** (in-scope MISSING rubric dimensions) → `Task`/`Improvement` leaves.
- Every ticket is filed via the vendor-neutral `lisa-tracker-write` shim with `build_ready: true` (never a vendor write skill directly), as a **single-repo leaf** stamped `repo:<current>`, with a real three-audience description, Gherkin AC, Target Backend Environment, and a Validation Journey + typed `[EVIDENCE: <artifact-type>: <name>]` marker (e.g. `[EVIDENCE: log-snippet: alert-cleared]`) so it passes the `tracker-validate` gates.
- **Operator footer (required):** every filed ticket ends with the `rejection-detection` **operator footer** as a visible prose line — `To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.` — so the operator knows which close-reason silences the finding.
- **Idempotent + decline-aware:** embed the `<!-- lisa:monitor-finding: <fingerprint> -->` sentinel and follow the `observability-audit` rule's current fingerprint/idempotency contract for open-and-closed search, prior-decline suppression, recurrence evidence, completed-item regression handling, and tracker-read failure outcomes. Never duplicate a live or just-resolved finding.
- **Capped** at `max_candidates` (default 20), `core`/high-severity first; report how many were filed vs dropped.
- **`--dry-run`** previews would-file tickets and creates nothing. **`--all-gaps`** widens gap filing to `recommended` tiers.

`monitor` files only. The `intake` / `tracker-build-intake` cron picks the ready tickets up and implements them.

## Output

A single report: the health/anomaly summary (failures, warnings, no-issue confirmations) + the observability audit table (each in-scope dimension as `OK` / `WARN` / `MISSING` / `PRESENT (unverified)`) + the filing summary (tickets filed with refs + fingerprints, duplicates skipped, dropped count if the cap truncated; or would-file tickets under `--dry-run`). For post-deploy verification (when called from `lisa-verify`), the report-only summary becomes evidence on the originating work item.

## Run outcome

As the registered `monitor` automation loop, the **standalone** cron run conforms to the
`automation-runbook-contract` rule: it ends in **exactly one** of the six run outcomes and records it,
so a quiet monitoring run and a broken one never look identical.

| This cycle's exit path | Run outcome |
|---|---|
| Anomalies or in-scope gaps filed — one or more `Bug` / `Task` / `Improvement` leaves created or referenced | `candidate-proposed` |
| Clean sweep — health/audit ran end to end, nothing over the bar and no in-scope gaps — **or** every finding was suppressed by a prior decline (`rejection-detection` **Proposal rejection memory**): the summary MUST name the suppression count | `nothing-needed` |
| Provider/threshold resolution failure — threshold collection fails (a present-but-uninspectable config, an invalid configured threshold) or a signal provider is unreachable so the sweep could not run — **or** the open-and-closed rejection-memory search could not read the tracker: a memory check that could not run is a broken loop, never a silent `nothing-needed` | `recovery-required` |
| The runbook's **Retirement condition** tripped — the trailing quiet window is empty AND this sweep found nothing AND no connected observability surfaces are left — this row supersedes the `nothing-needed` row when it applies | `policy-obsolete` |
| A degradation that still let the sweep run (an optional `ops-specialist` overlay absent, Kane unavailable) | the outcome it actually reached above, with the summary **leading with the degradation** — degradation never mints a seventh token |

Only the **standalone** run records. The nested report-only modes do their own job and do not file or
record: `--report-only` (including the `lisa-verify` post-deploy call, whose summary is evidence on
the originating item) and `--dry-run` (a preview that creates nothing) are not registered-loop
invocations.

Before invoking the run-record CLI, evaluate the **Retirement condition** first. If it applies,
select `policy-obsolete` as the sole outcome and do not record a prior `nothing-needed` result;
otherwise select the ordinary outcome from the table.

Record **exactly one** outcome per standalone invocation through the run-record CLI, naming this
loop's runbook (the `--summary` is the operator-readable one-liner in the contract's exemplar voice —
plain, specific, actionable, e.g. `Health green; audit clean — nothing to propose.` for
`nothing-needed`; and for a `recovery-required` from an unreadable decline check, `Tracker
unreachable during the decline check — restore credentials; nothing was filed this run.`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" \
  --loop-id monitor --outcome candidate-proposed \
  --summary "Filed #1810 for the p99 latency spike; awaiting your flip to ready." \
  --runbook .lisa/automations/monitor.runbook.md [--ref <ticket-url>]...
```

If `${CLAUDE_PLUGIN_ROOT}` is unset, resolve the plugin scripts directory directly — the built copy
`plugins/lisa/scripts/automation-run-record.mjs` or the source
`plugins/src/base/scripts/automation-run-record.mjs`. If recording still fails, **degrade, never
abort** (per `automation-runbook-contract`): note the recording failure in the run output and finish
the cycle — a recording failure is a degradation to report, never a reason to block the loop.

**Retirement evaluation (every run).** Evaluate this loop's runbook **Retirement condition** on
every standalone run, exactly as the `automation-runbook-contract` rule's Retirement section defines
it — this skill conforms to that text and never restates or diverges from it. On top of the
contract's two conditions the runbook seeds a third **domain conjunct** — the project has no
connected observability surfaces left, so there is nothing to monitor — which only tightens the test
and never replaces it: a quiet month on a healthy project is good news, not a reason to stop
watching it. Evaluate all three. When all three hold, record `policy-obsolete` and file
**exactly ONE** marker-deduped teardown proposal through `lisa-tracker-write`
(per `tracked-work` + `integration-access-layer`):

- **Marker** `<!-- [lisa-automation-retire] key=monitor -->` plus a visible prose line; matched on
  the marker, never the title; searched **open AND closed** per `rejection-detection`'s **Proposal
  rejection memory**. Treat matches by close state: **open** suppresses another proposal;
  **Not planned** suppresses another proposal unless new evidence postdates the rejection;
  **Completed** means the prior approved action happened, so a later recurrence may be re-filed.
  When an existing proposal suppresses filing, **the run still records `policy-obsolete` and files
  nothing** — the outcome describes this run, while the ticket is filed exactly once.
- **Labels** `status:blocked` + `human-needed`, carrying the contract's decision-ready packet. The
  `human-needed` label marks the proposal human-owned: `lisa-repair-intake` recognizes it and never
  re-dispatches it as stalled work.
- **Evidence** the date-filtered search result, this run's summary, **the loop's current cadence**
  (the baseline an operator needs to choose a longer one), and a one-line summary of recent runs
  read from `.lisa/automations/runs/monitor.jsonl`. Fill the rest of the packet the same way every
  time: *Work already attempted* is the searches this run ran, and *Risk of inaction* is that the
  loop keeps consuming schedule slots and tokens for nothing.
- **How to answer** names the three operator responses: **approve** — run
  `/lisa:tear-down-automations monitor` and only that loop registration goes away; **decline** — close the proposal as
  **Not planned** (closing it as **Completed** leaves a later re-file open) and the loop simply
  continues; **re-cadence** — pick a longer cadence off that evidence and re-register with
  `/lisa:setup-automations` instead of tearing down.
- **Operator footer**, verbatim, as on every loop-filed proposal (`rejection-detection`):
  > To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.

The loop **keeps running at its normal cadence** until a human acts, and never deletes its own
registration.
