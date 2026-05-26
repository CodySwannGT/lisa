---
name: queue-status
description: "Read-only operator surface for the current project's PRD and build backlog health. Resolves the configured PRD source and build tracker from the same Lisa contract used by intake and repair, summarizes lifecycle-role counts, distinguishes idle queues from setup problems, and highlights actionable blocked, in-review, claimed, or shipped work."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Queue Status: $ARGUMENTS

`/lisa:queue-status` is the operator-facing inspection surface for Lisa's live backlog state. It answers, for the **current repo only**, what Lisa's configured PRD queue and build queue currently look like, whether the queues appear healthy or stuck, and which items are most actionable next.

This command is **read-only** in v1. It does not create, claim, relabel, repair, transition, comment on, or otherwise mutate queue items. It complements `/lisa:intake`, `/lisa:repair-intake`, `/lisa:verify-prd`, `/lisa:automation-status`, and the underlying vendor trackers; it does not replace them.

## Confirmation policy

Do **not** ask for confirmation once invoked. This skill inspects queue state and reports what it finds. There are no write-side effects in the v1 surface.

## Scope

Inspect only the Lisa queues for the current project:

- the configured PRD source queue
- the configured build tracker queue

Resolve queue source, tracker, lifecycle roles, and queue arguments from the **same contract** Lisa already uses for `/lisa:intake` and `/lisa:repair-intake`. Do **not** invent a second source of truth for queue detection, lifecycle naming, or stack support.

Support a repo-scoped queue selector when requested:

- default: inspect both queues
- `queue=prd`: inspect only the PRD queue
- `queue=build`: inspect only the build queue

## What to report

For each inspected queue, report:

1. The queue source or tracker Lisa resolved.
2. Lifecycle counts using the repo's configured role names.
3. Whether the queue appears `IDLE`, `HEALTHY`, `ATTENTION_NEEDED`, or `MISCONFIGURED`.
4. Whether the lifecycle namespace appears adopted versus absent.
5. The oldest or most actionable blocked, in-review, claimed, shipped, or similar stuck items Lisa can surface without mutating work.
6. A concise remediation hint when attention is needed.

The report should stay terminal-first and immediately actionable: observable queue facts first, then the smallest useful next step.

## Runtime and vendor expectations

- Reuse the same config-resolution defaults and queue-routing rules that `intake` and `repair-intake` use.
- Work from the current repo's `.lisa.config.json` instead of hardcoding one vendor's lifecycle names.
- Support the vendor families already served by Lisa intake: GitHub, Linear, JIRA, Notion, and Confluence.
- If a queue cannot be resolved or its lifecycle namespace has not been adopted, report that explicitly as `MISCONFIGURED` rather than pretending the queue is empty.

## Verdicts and remediation

- `IDLE`: the queue resolved successfully and no actionable ready or stuck work is present.
- `HEALTHY`: the queue resolved successfully and the current backlog/state appears normal.
- `ATTENTION_NEEDED`: the queue resolved, but blocked, stalled, or accumulating work needs operator follow-up.
- `MISCONFIGURED`: Lisa could not resolve the queue, could not find the expected lifecycle namespace, or detected another setup/adoption problem.

Status-specific remediation guidance:

- `IDLE`: explain that the queue is currently quiet and no immediate operator action is required.
- `HEALTHY`: point operators to `/lisa:intake` or `/lisa:repair-intake` when they want Lisa to act on the reported state.
- `ATTENTION_NEEDED`: identify the most actionable blocked or stalled items and suggest the next Lisa or tracker-native command to investigate.
- `MISCONFIGURED`: show which queue contract is missing or unresolved and recommend fixing `.lisa.config.json`, adopting the lifecycle namespace, or rerunning the relevant setup flow.

## Rules

- Stay **read-only**. Never create, update, claim, relabel, repair, transition, or comment on queue items from this skill.
- Keep the report repo-scoped to the current project instead of aggregating unrelated repos or teams.
- Distinguish truly idle queues from lifecycle-namespace absence or unresolved config.
- Reuse `intake` and `repair-intake` contract semantics so queue health reporting does not drift from execution behavior.
- Keep observable queue facts separate from remediation guidance so operators can tell the current state from the recommended next step.
