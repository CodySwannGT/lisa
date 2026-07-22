---
name: lisa-automation-status
description: "Read-only operator surface for the current project's Lisa automation fleet. Resolves the expected recurring jobs from the same setup-automations contract Lisa uses to create them, inspects the active runtime scheduler (Codex automations or Claude /schedule), compares live command/cadence/queue arguments against the expected contract, and reports grouped fleet health such as healthy, missing, unsupported, drifted, stale, or failing with remediation guidance."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Automation Status: $ARGUMENTS

`/lisa:automation-status` is the operator-facing inspection surface for Lisa's unattended job fleet. It answers, for the **current repo only**, whether the recurring Lisa automations that should exist actually exist, still match Lisa's setup contract, and appear healthy based on the runtime metadata available.

This command is **read-only** in v1. It does not create, update, resume, rerun, pause, or delete automations. It complements `/lisa:setup-automations`, `/lisa:tear-down-automations`, `/lisa:intake`, `/lisa:repair-intake`, `doctor`, and `monitor`; it does not replace them.

## Confirmation policy

Do **not** ask for confirmation once invoked. This skill inspects scheduler state and reports what it finds. There are no write-side effects in the v1 surface.

## Scope

Inspect only the Lisa automation fleet for the current project. Derive that fleet from
`scripts/automation-status-expected-fleet.mjs` (`resolveExpectedAutomationFleet`), which resolves
exactly what `setup-automations` registers for this repo — including the stack-guarded
`exploratory-bugs` and the opt-in `learnings-audit` gardener. **Membership is registration, not a
roster** (`automation-runbook-contract`): carry no fixed list of loop names here, so a loop added to
or removed from the registration set flows through without editing this skill.

The gardener is opted into at registration time and has no config key, so **infer it from the
scheduler**: list the project's automations first, then call
`inferLearningsAuditRegistration({ automationPrefix, observedAutomationIds })` and pass the result
as `learningsAudit` when resolving the fleet. A `lisa-auto-<project>-learnings-audit` entry on the
scheduler means the project opted in, so the gardener is compared like any other loop; no such entry
means it is reported `UNSUPPORTED` (opted out), never `MISSING`. This skill stays read-only — it
infers, it never writes the flag anywhere.

Resolve the expected project identifier, fleet naming prefix, queue arguments, cadence, and stack-support rules from the same contract used by `setup-automations` and `tear-down-automations`. Do **not** invent a second source of truth for fleet naming or queue resolution.

## Runtime inspection

Branch on the active runtime and prefer the runtime's native automation listing surface:

- **Codex**: inspect Codex automations metadata first. Use backing-store files only as a fallback or to enrich timestamps when the runtime surface cannot provide enough status detail directly.
- **Claude**: inspect the `/schedule` listing surface and any exposed recency or failure metadata available there.
- **Other runtimes**: if no native recurring-task inspection exists, report that automation-status is unsupported in this runtime rather than guessing.

The report must stay repo-scoped: inspect only automations whose names belong to the current repo's Lisa fleet prefix, and do not absorb unrelated automations into the result.

## What to report

For each expected automation, report:

1. Whether it exists.
2. Whether it is expected or intentionally unsupported.
3. The configured command and cadence Lisa expects.
4. Any detected drift in name, cadence, command shape, or queue arguments.
5. Any available recent-run health signal such as stale last-run timing or repeated failure status.
6. A concise remediation hint when attention is needed.
7. Where the loop's checked-in runbook lives (`automation-runbook-contract`), or `not scaffolded — run /lisa:setup-automations` when it is absent.
8. How the last recorded run ended — its outcome, one-line summary, and timestamp — or `no recorded runs yet` when the loop has never recorded one.
9. A bounded run history: the five most recent outcomes newest first, plus a count of how many older records exist when the file holds more.

The last-run and history facts come from the durable run-outcome substrate recorded by each loop (the RBC-3 records under `.lisa/automations/runs/<loop-id>.jsonl`, read through `readAutomationRunRecords`). That directory is local scheduler state, not project knowledge — read it, never write it.

Emit an overall grouped fleet verdict such as `HEALTHY`, `ATTENTION_NEEDED`, or `PARTIAL_SUPPORT`, plus the runtime surface inspected. **Repeated recovery is a fleet-health signal the scheduler cannot see**: when a loop's last three or more consecutive recorded runs are all `recovery-required`, report that loop `FAILING` — and therefore the overall verdict `ATTENTION_NEEDED` — even when its scheduler entry itself looks healthy, and point the remediation at the recorded run summaries.

## Operator usage

Typical entrypoint:

```text
/lisa:automation-status
```

Use this command when an operator needs to answer one of these questions for the current repo:

- "Did Lisa set up every automation this project expects?"
- "Is the scheduler still pointing at the right cadence and queue arguments?"
- "Is the queue idle because there is no work, or because the automation is stale or failing?"

The report should be terminal-first and immediately actionable: observable scheduler facts first, then the smallest useful remediation step.

## Runtime differences

- **Codex**: prefer native automation metadata and use backing-store files only to fill gaps such as timestamps or failure recency. When Codex exposes health/memory signals, include them as observed facts rather than assumptions.
- **Claude**: use the `/schedule` listing as the primary runtime surface. Compare the live schedule name, cadence, and command shape against the Lisa contract, but degrade gracefully when `/schedule` does not expose equivalent recency or failure fields.
- **Other runtimes**: report automation-status as unsupported for that runtime instead of guessing from unrelated files or naming patterns.

## Verdicts and remediation

- `HEALTHY`: every expected automation exists and the inspected runtime metadata shows no actionable drift, staleness, or failure.
- `PARTIAL_SUPPORT`: the fleet is otherwise healthy, but at least one exploratory job is intentionally unsupported for this stack or runtime.
- `ATTENTION_NEEDED`: at least one automation is missing, drifted, stale, or failing.

Status-specific remediation guidance:

- `MISSING`: tell the operator which job is absent and recommend rerunning `/lisa:setup-automations` or recreating the missing job with the expected cadence and command.
- `DRIFTED`: show the expected versus observed cadence/command mismatch and recommend aligning the scheduler entry with Lisa's current setup contract, usually by rerunning `/lisa:setup-automations`.
- `STALE`: explain that the job exists but has not run recently enough for its cadence. Recommend inspecting the runtime's recent-run history or failure logs before changing queue state.
- `FAILING`: surface the failure signal directly and recommend checking the latest runtime error plus the affected queue command (`/lisa:intake`, `/lisa:repair-intake`, or exploratory job) after the scheduler issue is resolved. A loop also reports `FAILING` when its last three or more consecutive recorded runs are all `recovery-required` — even with a healthy scheduler entry — in which case cite the recorded run summaries and point the operator at the loop's runbook.
- `UNSUPPORTED`: explain why the job is intentionally absent and say that no remediation is required unless the project stack or runtime support changed.

Render the report in grouped sections using the shared `scripts/automation-status-report.mjs` contract:

```text
Overall verdict: <VERDICT>
Counts: <n HEALTHY>, <n MISSING>, <n UNSUPPORTED>, <n DRIFTED>, <n STALE>, <n FAILING>
Runtime inspected: <runtime surface>
Generated at: <ISO timestamp>

1. <group title>
- <STATUS> <automation-id>: <summary>
  Expected: <cadence> -> <command>
  Observed: <what the runtime exposed>
  Runbook: <.lisa/automations/<loop-id>.runbook.md, or "not scaffolded — run /lisa:setup-automations">
  Last run: <outcome> — <summary> (<ts>), or "no recorded runs yet"
  History: <outcome>, <outcome>, … (newest first); … and <N> older records
  Remediation: <next step when attention is needed>
```

The Runbook, Last run, and History lines are observable facts and sit between Observed and Remediation. Keep observable runtime facts separate from remediation guidance so operators can distinguish drift, unsupported jobs, and actual failures quickly.

## Rules

- Stay **read-only**. Never create, update, delete, enable, disable, or rerun automations from this skill.
- Reuse `setup-automations` contract logic for expected fleet resolution, cadence, queue arguments, naming, and stack-specific support checks.
- Distinguish **unsupported** from **missing**. An exploratory job omitted because the current stack lacks `exploratory-qa` is not a failure.
- If the runtime cannot expose a field such as last-run timestamp or failure state, say that explicitly instead of implying health.
- Keep the output operational and repo-scoped so operators can tell whether Lisa's unattended surfaces are present, current, and healthy right now.
