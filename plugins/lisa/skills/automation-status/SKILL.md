---
name: automation-status
description: "Read-only operator surface for the current project's Lisa automation fleet. Resolves the expected recurring jobs from the same setup-automations contract Lisa uses to create them, inspects the active runtime scheduler (Codex automations or Claude /schedule), compares live command/cadence/queue arguments against the expected contract, and reports grouped fleet health such as healthy, missing, unsupported, drifted, stale, or failing with remediation guidance."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Automation Status: $ARGUMENTS

`/lisa:automation-status` is the operator-facing inspection surface for Lisa's unattended job fleet. It answers, for the **current repo only**, whether the recurring Lisa automations that should exist actually exist, still match Lisa's setup contract, and appear healthy based on the runtime metadata available.

This command is **read-only** in v1. It does not create, update, resume, rerun, pause, or delete automations. It complements `/lisa:setup-automations`, `/lisa:tear-down-automations`, `/lisa:intake`, `/lisa:repair-intake`, `doctor`, and `monitor`; it does not replace them.

## Confirmation policy

Do **not** ask for confirmation once invoked. This skill inspects scheduler state and reports what it finds. There are no write-side effects in the v1 surface.

## Scope

Inspect only the Lisa automation fleet for the current project:

- `intake-repair`
- `intake-prd`
- `intake-tickets`
- `exploratory-bugs` when the current stack supports `exploratory-qa`
- `exploratory-prds`

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

Emit an overall grouped fleet verdict such as `HEALTHY`, `ATTENTION_NEEDED`, or `PARTIAL_SUPPORT`, plus the runtime surface inspected.

## Rules

- Stay **read-only**. Never create, update, delete, enable, disable, or rerun automations from this skill.
- Reuse `setup-automations` contract logic for expected fleet resolution, cadence, queue arguments, naming, and stack-specific support checks.
- Distinguish **unsupported** from **missing**. An exploratory job omitted because the current stack lacks `exploratory-qa` is not a failure.
- If the runtime cannot expose a field such as last-run timestamp or failure state, say that explicitly instead of implying health.
- Keep the output operational and repo-scoped so operators can tell whether Lisa's unattended surfaces are present, current, and healthy right now.
